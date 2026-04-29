import { Tool, ToolParameter } from '../base';
import { ToolResponse } from '../response';
import { ToolErrorCode } from '../errors';
import { SkillLoader } from '../../skills/loader';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SkillTool - 技能工具
 * 
 * 允许 Agent 按需加载领域知识。
 */
export class SkillTool extends Tool {
    private skillLoader: SkillLoader;

    constructor(skillLoader: SkillLoader) {
        // 生成动态描述
        const descriptions = skillLoader.getDescriptions();

        super(
            "Skill",
            `加载技能获取专业知识。

可用技能：
${descriptions}

何时使用：
- 任务明确匹配某个技能描述时，立即使用
- 开始领域特定工作之前
- 需要模型不具备的专业知识时

注意：加载技能后，请严格遵循技能说明来完成用户任务。`
        );
        this.skillLoader = skillLoader;
    }

    getParameters(): ToolParameter[] {
        return [
            {
                name: "skill",
                type: "string",
                description: "要加载的技能名称",
                required: true
            },
            {
                name: "args",
                type: "string",
                description: "可选参数，将替换 SKILL.md 中的 $ARGUMENTS 占位符",
                required: false,
                default: ""
            }
        ];
    }

    async run(parameters: Record<string, any>): Promise<ToolResponse> {
        const skillName = parameters.skill || "";
        const args = parameters.args || "";

        if (!skillName) {
            return ToolResponse.error(
                ToolErrorCode.INVALID_PARAM,
                "必须指定技能名称"
            );
        }

        try {
            // 按需加载技能
            const skill = this.skillLoader.getSkill(skillName);

            if (!skill) {
                const available = this.skillLoader.listSkills().join(", ");
                return ToolResponse.error(
                    ToolErrorCode.NOT_FOUND,
                    `技能 '${skillName}' 不存在。可用技能：${available}`,
                    undefined,
                    { available_skills: this.skillLoader.listSkills() }
                );
            }

            // 替换 $ARGUMENTS 占位符
            const content = skill.body.replace(/\$ARGUMENTS/g, args);

            // 列出可用资源
            const resourcesHint = this.getResourcesHint(skill);

            // 构造完整技能内容
            const fullContent = `<skill-loaded name="${skillName}">
${content}
${resourcesHint}
</skill-loaded>

✅ 技能已加载：${skill.name}
📝 描述：${skill.description}

请严格遵循上述技能说明来完成用户任务。`;

            return ToolResponse.success(
                fullContent,
                {
                    name: skill.name,
                    description: skill.description,
                    loaded: true,
                    token_estimate: fullContent.length,
                    has_resources: !!resourcesHint
                }
            );

        } catch (e) {
            return ToolResponse.error(
                ToolErrorCode.INTERNAL_ERROR,
                `加载技能失败：${e instanceof Error ? e.message : String(e)}`
            );
        }
    }

    private getResourcesHint(skill: any): string {
        const resources: string[] = [];

        const labels: Record<string, string> = {
            "scripts": "脚本",
            "references": "参考文档",
            "assets": "资源",
            "examples": "示例"
        };

        for (const [folder, label] of Object.entries(labels)) {
            const folderPath = path.join(skill.dir, folder);
            if (fs.existsSync(folderPath)) {
                const files = fs.readdirSync(folderPath);
                if (files.length > 0) {
                    let fileList = files.slice(0, 5).join(", ");
                    if (files.length > 5) {
                        fileList += ` 等 ${files.length} 个文件`;
                    }
                    resources.push(`  - ${label}：${fileList}`);
                }
            }
        }

        if (resources.length === 0) {
            return "";
        }

        return "\n\n**可用资源**：\n" + resources.join("\n");
    }
}
