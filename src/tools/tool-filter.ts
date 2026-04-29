/**
 * 工具过滤器
 * 
 * 用于子代理机制，控制不同类型的 Agent 可以访问哪些工具。
 */

/**
 * 工具过滤器基类
 * 
 * 用于在子代理运行时限制可用工具集合。
 */
export abstract class ToolFilter {
    /**
     * 过滤工具列表
     * 
     * @param allTools 所有可用工具名称列表
     * @returns 过滤后的工具名称列表
     */
    abstract filter(allTools: string[]): string[];

    /**
     * 检查单个工具是否允许
     * 
     * @param toolName 工具名称
     * @returns 是否允许使用该工具
     */
    abstract isAllowed(toolName: string): boolean;
}

/**
 * 只读工具过滤器
 * 
 * 只允许使用只读工具，适用于：
 * - explore（探索代码库）
 * - plan（规划任务）
 * - summary（归纳信息）
 */
export class ReadOnlyFilter extends ToolFilter {
    /** 只读工具默认白名单 */
    static readonly READONLY_TOOLS: Set<string> = new Set([
        "Read", "ReadTool",
        "LS", "LSTool",
        "Glob", "GlobTool",
        "Grep", "GrepTool",
        "Skill", "SkillTool",
    ]);

    private allowedTools: Set<string>;

    /**
     * 初始化只读过滤器
     * 
     * @param additionalAllowed 额外允许的工具名称列表
     */
    constructor(additionalAllowed: string[] = []) {
        super();
        this.allowedTools = new Set(ReadOnlyFilter.READONLY_TOOLS);
        for (const tool of additionalAllowed) {
            this.allowedTools.add(tool);
        }
    }

    /**
     * 只保留只读工具
     * 
     * @param allTools 所有工具
     */
    filter(allTools: string[]): string[] {
        return allTools.filter(tool => this.isAllowed(tool));
    }

    /**
     * 检查是否为只读工具
     * 
     * @param toolName 工具名称
     */
    isAllowed(toolName: string): boolean {
        return this.allowedTools.has(toolName);
    }
}

/**
 * 完全访问过滤器
 * 
 * 允许使用所有工具（除了明确禁止的危险工具），适用于：
 * - code（代码实现）
 */
export class FullAccessFilter extends ToolFilter {
    /** 危险工具黑名单 */
    static readonly DENIED_TOOLS: Set<string> = new Set([
        "Bash", "BashTool",
        "Terminal", "TerminalTool",
        "Execute", "ExecuteTool",
    ]);

    private deniedTools: Set<string>;

    /**
     * 初始化完全访问过滤器
     * 
     * @param additionalDenied 额外禁止的工具名称列表
     */
    constructor(additionalDenied: string[] = []) {
        super();
        this.deniedTools = new Set(FullAccessFilter.DENIED_TOOLS);
        for (const tool of additionalDenied) {
            this.deniedTools.add(tool);
        }
    }

    /**
     * 排除危险工具
     * 
     * @param allTools 所有工具
     */
    filter(allTools: string[]): string[] {
        return allTools.filter(tool => this.isAllowed(tool));
    }

    /**
     * 检查是否允许（不在黑名单中）
     * 
     * @param toolName 工具名称
     */
    isAllowed(toolName: string): boolean {
        return !this.deniedTools.has(toolName);
    }
}

/**
 * 自定义工具过滤器
 * 
 * 用户可以明确指定允许或禁止的工具列表。
 */
export class CustomFilter extends ToolFilter {
    private allowed: Set<string>;
    private denied: Set<string>;
    private mode: "whitelist" | "blacklist";

    /**
     * 初始化自定义过滤器
     * 
     * @param options 配置选项
     */
    constructor(options: {
        allowed?: string[],
        denied?: string[],
        mode?: "whitelist" | "blacklist"
    } = {}) {
        super();
        this.allowed = new Set(options.allowed || []);
        this.denied = new Set(options.denied || []);
        this.mode = options.mode || "whitelist";

        if (this.mode !== "whitelist" && this.mode !== "blacklist") {
            throw new Error(`Invalid mode: ${this.mode}. Must be 'whitelist' or 'blacklist'`);
        }
    }

    /**
     * 根据模式过滤工具
     * 
     * @param allTools 所有工具
     */
    filter(allTools: string[]): string[] {
        return allTools.filter(tool => this.isAllowed(tool));
    }

    /**
     * 检查是否允许
     * 
     * @param toolName 工具名称
     */
    isAllowed(toolName: string): boolean {
        if (this.mode === "whitelist") {
            return this.allowed.has(toolName);
        } else { // blacklist
            return !this.denied.has(toolName);
        }
    }
}
