import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Tool, ToolParameter } from '../base';
import { ToolResponse } from '../response';
import { ToolErrorCode } from '../errors';

/**
 * 支持的日志类别
 */
export const CATEGORIES: Record<string, string> = {
    "decision": "架构/技术选型决策",
    "progress": "阶段性进展记录",
    "issue": "遇到的问题",
    "solution": "问题解决方案",
    "refactor": "重构决策",
    "test": "测试相关记录",
    "performance": "性能优化记录"
};

/**
 * 单条开发日志
 */
export interface DevLogEntry {
    id: string;
    timestamp: string;
    category: string;
    content: string;
    metadata: Record<string, any>;
}

/**
 * 开发日志存储引擎
 */
export class DevLogStore {
    sessionId: string;
    agentName: string;
    createdAt: string;
    updatedAt: string;
    entries: DevLogEntry[];

    constructor(sessionId: string, agentName: string) {
        const now = new Date().toISOString();
        this.sessionId = sessionId;
        this.agentName = agentName;
        this.createdAt = now;
        this.updatedAt = now;
        this.entries = [];
    }

    append(entry: DevLogEntry) {
        this.entries.push(entry);
        this.updatedAt = new Date().toISOString();
    }

    filterEntries(category?: string, tags?: string[], limit?: number): DevLogEntry[] {
        let filtered = this.entries;

        if (category) {
            filtered = filtered.filter(e => e.category === category);
        }

        if (tags && tags.length > 0) {
            filtered = filtered.filter(e => {
                const entryTags = e.metadata.tags || [];
                return tags.some(tag => entryTags.includes(tag));
            });
        }

        if (limit && limit > 0) {
            filtered = filtered.slice(-limit);
        }

        return filtered;
    }

    getStats(): Record<string, any> {
        const stats: Record<string, any> = {
            total_entries: this.entries.length,
            by_category: {} as Record<string, number>
        };

        for (const entry of this.entries) {
            const cat = entry.category;
            stats.by_category[cat] = (stats.by_category[cat] || 0) + 1;
        }

        return stats;
    }

    generateSummary(limit: number = 10): string {
        if (this.entries.length === 0) {
            return "📝 暂无开发日志";
        }

        const stats = this.getStats();
        const total = stats.total_entries;
        const recent = this.entries.slice(-limit);

        const summaryParts = [`📝 共 ${total} 条日志`];

        // 按类别统计
        const catSummary = Object.entries(stats.by_category)
            .map(([cat, count]) => `${cat}(${count})`)
            .join(', ');
        summaryParts.push(`分类: ${catSummary}`);

        // 最近日志
        if (recent.length > 0) {
            const recentSummary = recent.slice(-3).map(e => {
                const truncated = e.content.length > 30 ? e.content.substring(0, 30) + "..." : e.content;
                return `[${e.category}] ${truncated}`;
            }).join('; ');
            summaryParts.push(`最近: ${recentSummary}`);
        }

        return summaryParts.join('. ');
    }

    toDict(): Record<string, any> {
        return {
            session_id: this.sessionId,
            agent_name: this.agentName,
            created_at: this.createdAt,
            updated_at: this.updatedAt,
            entries: this.entries,
            stats: this.getStats()
        };
    }

    static fromDict(data: any): DevLogStore {
        const store = new DevLogStore(data.session_id, data.agent_name);
        store.createdAt = data.created_at;
        store.updatedAt = data.updated_at;
        store.entries = data.entries || [];
        return store;
    }
}

/**
 * DevLogTool - 开发日志工具
 */
export class DevLogTool extends Tool {
    private sessionId: string;
    private agentName: string;
    private projectRoot: string;
    private persistenceDir: string;
    private store: DevLogStore;

    constructor(
        sessionId: string,
        agentName: string = "Agent",
        projectRoot: string = ".",
        persistenceDir: string = "memory/devlogs"
    ) {
        super(
            "DevLog",
            `记录开发过程中的关键决策和问题。

支持的类别：
${Object.entries(CATEGORIES).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

操作：
- append: 追加日志（需要 category, content, metadata）
- read: 读取日志（可选 category, tags, limit）
- summary: 生成摘要
- clear: 清空日志

示例：
{
  "action": "append",
  "category": "decision",
  "content": "选择使用 Redis 作为缓存层",
  "metadata": {"tags": ["architecture", "cache"]}
}`
        );
        this.sessionId = sessionId;
        this.agentName = agentName;
        this.projectRoot = path.resolve(projectRoot);
        this.persistenceDir = path.join(this.projectRoot, persistenceDir);

        if (!fs.existsSync(this.persistenceDir)) {
            fs.mkdirSync(this.persistenceDir, { recursive: true });
        }

        this.store = new DevLogStore(sessionId, agentName);
        this.loadIfExists();
    }

    getParameters(): ToolParameter[] {
        return [
            {
                name: "action",
                type: "string",
                description: "操作类型：append（追加）、read（读取）、summary（摘要）、clear（清空）",
                required: true
            },
            {
                name: "category",
                type: "string",
                description: `日志类别（append 时必填）：${Object.keys(CATEGORIES).join(', ')}`,
                required: false
            },
            {
                name: "content",
                type: "string",
                description: "日志内容（append 时必填）",
                required: false
            },
            {
                name: "metadata",
                type: "object",
                description: "元数据（可选），如 {\"tags\": [\"cache\"], \"step\": 3, \"related_tool\": \"WriteTool\"}",
                required: false
            },
            {
                name: "filter",
                type: "object",
                description: "过滤条件（read 时可选），如 {\"category\": \"decision\", \"tags\": [\"architecture\"], \"limit\": 10}",
                required: false
            }
        ];
    }

    async run(parameters: Record<string, any>): Promise<ToolResponse> {
        try {
            const action = parameters.action;

            switch (action) {
                case "append":
                    return this.handleAppend(parameters);
                case "read":
                    return this.handleRead(parameters);
                case "summary":
                    return this.handleSummary();
                case "clear":
                    return this.handleClear();
                default:
                    return ToolResponse.error(ToolErrorCode.INVALID_PARAM, `未知操作：${action}`);
            }
        } catch (e) {
            return ToolResponse.error(ToolErrorCode.INTERNAL_ERROR, `DevLog 操作失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private handleAppend(parameters: Record<string, any>): ToolResponse {
        const category = parameters.category;
        const content = parameters.content;

        if (!category) return ToolResponse.error(ToolErrorCode.INVALID_PARAM, "追加日志时必须指定 category");
        if (!CATEGORIES[category]) return ToolResponse.error(ToolErrorCode.INVALID_PARAM, `无效的类别：${category}`);
        if (!content) return ToolResponse.error(ToolErrorCode.INVALID_PARAM, "追加日志时必须指定 content");

        const entry: DevLogEntry = {
            id: `log-${crypto.randomBytes(4).toString('hex')}`,
            timestamp: new Date().toISOString(),
            category,
            content,
            metadata: parameters.metadata || {}
        };

        this.store.append(entry);
        this.persist();

        return ToolResponse.success(
            `✅ 日志已记录 [${category}]: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`,
            {
                log_id: entry.id,
                timestamp: entry.timestamp,
                category: entry.category
            },
            this.store.getStats()
        );
    }

    private handleRead(parameters: Record<string, any>): ToolResponse {
        const filter = parameters.filter || {};
        const entries = this.store.filterEntries(filter.category, filter.tags, filter.limit);

        if (entries.length === 0) {
            return ToolResponse.success("📝 未找到匹配的日志", { entries: [] }, { matched: 0 });
        }

        let text = `📝 找到 ${entries.length} 条日志：\n\n`;
        for (const entry of entries) {
            text += `[${entry.category}] ${entry.timestamp}\n`;
            text += `  ${entry.content}\n`;
            if (Object.keys(entry.metadata).length > 0) {
                text += `  元数据: ${JSON.stringify(entry.metadata)}\n`;
            }
            text += `\n`;
        }

        return ToolResponse.success(text, { entries: entries }, { matched: entries.length });
    }

    private handleSummary(): ToolResponse {
        const summary = this.store.generateSummary();
        return ToolResponse.success(summary, this.store.getStats());
    }

    private handleClear(): ToolResponse {
        const oldCount = this.store.entries.length;
        this.store.entries = [];
        this.store.updatedAt = new Date().toISOString();
        this.persist();

        return ToolResponse.success(`✅ 已清空 ${oldCount} 条日志`, { cleared_count: oldCount });
    }

    private persist() {
        const filename = `devlog-${this.sessionId}.json`;
        const filePath = path.join(this.persistenceDir, filename);

        const tempPath = filePath + '.tmp';
        fs.writeFileSync(tempPath, JSON.stringify(this.store.toDict(), null, 2), 'utf-8');
        fs.renameSync(tempPath, filePath);
    }

    private loadIfExists() {
        const filename = `devlog-${this.sessionId}.json`;
        const filePath = path.join(this.persistenceDir, filename);

        if (fs.existsSync(filePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                this.store = DevLogStore.fromDict(data);
            } catch (e) {
                // ignore loading error
            }
        }
    }
}
