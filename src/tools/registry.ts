import { Tool } from './base';
import { ToolResponse } from './response';
import { ToolErrorCode } from './errors';
import { CircuitBreaker } from './circuit-breaker';

/**
 * 工具注册表 - HelloAgents原生工具系统
 */

/**
 * HelloAgents工具注册表
 * 
 * 提供工具的注册、管理和执行功能。
 * 支持两种工具注册方式：
 * 1. Tool对象注册（推荐）
 * 2. 函数直接注册（简便）
 */
export class ToolRegistry {
    private _tools: Map<string, Tool> = new Map();
    private _functions: Map<string, { description: string, func: Function }> = new Map();

    /** 文件元数据缓存（用于乐观锁机制） */
    private readMetadataCache: Map<string, Record<string, any>> = new Map();

    /** 熔断器（默认启用） */
    circuitBreaker: CircuitBreaker;

    /**
     * 初始化注册表
     * 
     * @param circuitBreaker 熔断器实例
     */
    constructor(circuitBreaker?: CircuitBreaker) {
        this.circuitBreaker = circuitBreaker || new CircuitBreaker();
    }

    /**
     * 注册Tool对象
     * 
     * @param tool Tool实例
     * @param autoExpand 是否自动展开可展开的工具（默认true）
     */
    registerTool(tool: Tool, autoExpand: boolean = true): void {
        // 检查工具是否可展开
        if (autoExpand && tool.expandable) {
            const expandedTools = tool.getExpandedTools();
            if (expandedTools) {
                // 注册所有展开的子工具
                for (const subTool of expandedTools) {
                    if (this._tools.has(subTool.name)) {
                        console.log(`⚠️ 警告：工具 '${subTool.name}' 已存在，将被覆盖。`);
                    }
                    this._tools.set(subTool.name, subTool);
                }
                console.log(`✅ 工具 '${tool.name}' 已展开为 ${expandedTools.length} 个独立工具`);
                return;
            }
        }

        // 普通工具或不展开的工具
        if (this._tools.has(tool.name)) {
            console.log(`⚠️ 警告：工具 '${tool.name}' 已存在，将被覆盖。`);
        }

        this._tools.set(tool.name, tool);
        console.log(`✅ 工具 '${tool.name}' 已注册。`);
    }

    /**
     * 直接注册函数作为工具（简便方式）
     * 
     * @param func 工具函数
     * @param name 工具名称（可选，默认使用函数名）
     * @param description 工具描述（可选）
     */
    registerFunction(
        func: Function | string,
        name?: string | Function,
        description?: string
    ): void {
        let finalFunc: Function;
        let finalName: string;
        let finalDescription: string;

        // 兼容旧的调用方式：registerFunction(name, description, func)
        if (typeof func === 'string' && typeof name === 'string' && typeof arguments[2] === 'function') {
            finalName = func;
            finalDescription = name;
            finalFunc = arguments[2];
        } else {
            finalFunc = func as Function;
            finalName = (name as string) || (finalFunc as any).name || 'unknown';
            finalDescription = description || `执行 ${finalName}`;
        }

        if (this._functions.has(finalName)) {
            console.log(`⚠️ 警告：工具 '${finalName}' 已存在，将被覆盖。`);
        }

        this._functions.set(finalName, {
            description: finalDescription,
            func: finalFunc
        });
        console.log(`✅ 函数工具 '${finalName}' 已注册。`);
    }

    /**
     * 注销工具
     * 
     * @param name 工具名称
     */
    unregister(name: string): void {
        if (this._tools.has(name)) {
            this._tools.delete(name);
            console.log(`🗑️ 工具 '${name}' 已注销。`);
        } else if (this._functions.has(name)) {
            this._functions.delete(name);
            console.log(`🗑️ 工具 '${name}' 已注销。`);
        } else {
            console.log(`⚠️ 工具 '${name}' 不存在。`);
        }
    }

    /**
     * 获取Tool对象
     * 
     * @param name 工具名称
     */
    getTool(name: string): Tool | undefined {
        return this._tools.get(name);
    }

    /**
     * 获取工具函数
     * 
     * @param name 工具名称
     */
    getFunction(name: string): Function | undefined {
        const funcInfo = this._functions.get(name);
        return funcInfo ? funcInfo.func : undefined;
    }

    /**
     * 执行工具，返回 ToolResponse 对象（带熔断器保护）
     * 
     * @param name 工具名称
     * @param inputText 输入参数
     */
    async executeTool(name: string, inputText: any): Promise<ToolResponse> {
        // 检查熔断器
        if (this.circuitBreaker.isOpen(name)) {
            const status = this.circuitBreaker.getStatus(name);
            return ToolResponse.error(
                ToolErrorCode.CIRCUIT_OPEN,
                `工具 '${name}' 当前被禁用，由于连续失败。${status.recover_in_seconds} 秒后可用。`,
                undefined,
                {
                    tool_name: name,
                    circuit_status: status
                }
            );
        }

        let response: ToolResponse;

        // 优先查找Tool对象（新协议）
        if (this._tools.has(name)) {
            const tool = this._tools.get(name)!;
            try {
                // 解析参数（支持 JSON 字符串或对象）
                let parameters: Record<string, any>;
                if (typeof inputText === 'string') {
                    try {
                        parameters = JSON.parse(inputText);
                    } catch (e) {
                        // 如果不是 JSON，作为普通字符串处理
                        parameters = { input: inputText };
                    }
                } else if (typeof inputText === 'object' && inputText !== null) {
                    parameters = inputText;
                } else {
                    parameters = { input: String(inputText) };
                }

                // 使用 runWithTiming 自动添加时间统计
                response = await tool.runWithTiming(parameters);
            } catch (e) {
                response = ToolResponse.error(
                    ToolErrorCode.EXECUTION_ERROR,
                    `执行工具 '${name}' 时发生异常: ${e instanceof Error ? e.message : String(e)}`,
                    undefined,
                    { tool_name: name, input: inputText }
                );
            }
        }
        // 查找函数工具（自动包装为新协议）
        else if (this._functions.has(name)) {
            const funcInfo = this._functions.get(name)!;
            const startTime = Date.now();

            try {
                const result = await funcInfo.func(inputText);
                const elapsedMs = Date.now() - startTime;

                // 包装为 ToolResponse
                response = ToolResponse.success(
                    String(result),
                    { output: result },
                    { time_ms: elapsedMs },
                    { tool_name: name, input: inputText }
                );
            } catch (e) {
                const elapsedMs = Date.now() - startTime;
                response = ToolResponse.error(
                    ToolErrorCode.EXECUTION_ERROR,
                    `函数执行失败: ${e instanceof Error ? e.message : String(e)}`,
                    { time_ms: elapsedMs },
                    { tool_name: name, input: inputText }
                );
            }
        }
        // 工具不存在
        else {
            response = ToolResponse.error(
                ToolErrorCode.NOT_FOUND,
                `未找到名为 '${name}' 的工具`,
                undefined,
                { tool_name: name }
            );
        }

        // 记录熔断器结果
        this.circuitBreaker.recordResult(name, response);

        return response;
    }

    /**
     * 获取所有可用工具的格式化描述字符串
     */
    getToolsDescription(): string {
        const descriptions: string[] = [];

        // Tool对象描述
        for (const tool of this._tools.values()) {
            descriptions.push(`- ${tool.name}: ${tool.description}`);
        }

        // 函数工具描述
        for (const [name, info] of this._functions.entries()) {
            descriptions.push(`- ${name}: ${info.description}`);
        }

        return descriptions.length > 0 ? descriptions.join("\n") : "暂无可用工具";
    }

    /**
     * 列出所有工具名称
     */
    listTools(): string[] {
        return [
            ...Array.from(this._tools.keys()),
            ...Array.from(this._functions.keys())
        ];
    }

    /**
     * 获取所有Tool对象
     */
    getAllTools(): Tool[] {
        return Array.from(this._tools.values());
    }

    /**
     * 清空所有工具
     */
    clear(): void {
        this._tools.clear();
        this._functions.clear();
        console.log("🧹 所有工具已清空。");
    }

    // ==================== 乐观锁机制支持 ====================

    /**
     * 缓存 Read 工具获取的文件元数据
     * 
     * @param filePath 文件路径
     * @param metadata 文件元数据字典
     */
    cacheReadMetadata(filePath: string, metadata: Record<string, any>): void {
        this.readMetadataCache.set(filePath, metadata);
    }

    /**
     * 获取缓存的文件元数据
     * 
     * @param filePath 文件路径
     */
    getReadMetadata(filePath: string): Record<string, any> | undefined {
        return this.readMetadataCache.get(filePath);
    }

    /**
     * 清空文件元数据缓存
     * 
     * @param filePath 指定文件路径，如果为 undefined 则清空所有缓存
     */
    clearReadCache(filePath?: string): void {
        if (filePath) {
            this.readMetadataCache.delete(filePath);
        } else {
            this.readMetadataCache.clear();
        }
    }
}

/** 全局工具注册表单例 */
export const globalRegistry = new ToolRegistry();
