import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

/**
 * 技能数据类
 */
export interface Skill {
    name: string;
    description: string;
    body: string;
    path: string;
    dir: string;
}

/**
 * 技能加载器
 * 
 * 实现渐进式披露机制：
 * - Layer 1: Metadata（启动时加载）
 * - Layer 2: SKILL.md body（按需加载）
 * - Layer 3: Resources（可选，按需）
 */
export class SkillLoader {
    private skillsDir: string;
    private skillsCache: Record<string, Skill> = {};
    private metadataCache: Record<string, any> = {};

    constructor(skillsDir: string) {
        this.skillsDir = path.resolve(skillsDir);
        if (!fs.existsSync(this.skillsDir)) {
            fs.mkdirSync(this.skillsDir, { recursive: true });
        }
        this.scanSkills();
    }

    /**
     * 扫描 skills/ 目录，加载元数据
     */
    private scanSkills() {
        if (!fs.existsSync(this.skillsDir)) return;

        const skillDirs = fs.readdirSync(this.skillsDir);
        for (const dirName of skillDirs) {
            const skillDir = path.join(this.skillsDir, dirName);
            if (!fs.statSync(skillDir).isDirectory()) continue;

            const skillMd = path.join(skillDir, "SKILL.md");
            if (!fs.existsSync(skillMd)) continue;

            // 只读取 frontmatter（元数据）
            const metadata = this.parseFrontmatterOnly(skillMd);
            if (!metadata) continue;

            const name = metadata.name || dirName;
            this.metadataCache[name] = {
                name: name,
                description: metadata.description || "",
                path: skillMd,
                dir: skillDir
            };
        }
    }

    private parseFrontmatterOnly(filePath: string): any {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
            if (!match) return null;

            const yamlStr = match[1];
            const metadata = yaml.parse(yamlStr);

            if (!metadata || !metadata.name || !metadata.description) return null;
            return metadata;
        } catch (e) {
            return null;
        }
    }

    /**
     * 获取所有技能的元数据描述（用于系统提示词）
     */
    getDescriptions(): string {
        const entries = Object.entries(this.metadataCache);
        if (entries.length === 0) {
            return "（暂无可用技能）";
        }

        return entries
            .map(([name, skill]) => `- ${name}: ${skill.description}`)
            .join('\n');
    }

    /**
     * 按需加载完整技能
     */
    getSkill(name: string): Skill | null {
        if (this.skillsCache[name]) return this.skillsCache[name];

        const metadata = this.metadataCache[name];
        if (!metadata) return null;

        try {
            const content = fs.readFileSync(metadata.path, 'utf-8');
            const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
            if (!match) return null;

            const frontmatter = match[1];
            const body = match[2];

            const parsedMetadata = yaml.parse(frontmatter);

            const skill: Skill = {
                name: parsedMetadata.name || name,
                description: parsedMetadata.description || "",
                body: body.trim(),
                path: metadata.path,
                dir: metadata.dir
            };

            this.skillsCache[name] = skill;
            return skill;
        } catch (e) {
            return null;
        }
    }

    listSkills(): string[] {
        return Object.keys(this.metadataCache);
    }

    reload() {
        this.skillsCache = {};
        this.metadataCache = {};
        this.scanSkills();
    }
}
