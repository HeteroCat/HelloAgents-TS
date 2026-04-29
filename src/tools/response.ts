/**
 * 工具响应协议
 * 
 * 标准化的工具响应格式，提供结构化的状态、数据和错误信息。
 */

/**
 * 工具执行状态枚举
 */
export enum ToolStatus {
    /** 任务完全按预期执行 */
    SUCCESS = "success",
    /** 结果可用但存在折扣（截断、回退、部分失败） */
    PARTIAL = "partial",
    /** 无有效结果（致命错误） */
    ERROR = "error"
}

/**
 * 错误信息接口
 */
export interface ErrorInfo {
    code: string;
    message: string;
}

/**
 * 工具响应类
 * 
 * 标准化的工具响应格式，包含：
 * - status: 执行状态（success/partial/error）
 * - text: 给 LLM 阅读的格式化文本
 * - data: 结构化数据载荷
 * - errorInfo: 错误信息（仅 status=error 时）
 * - stats: 运行统计（时间、token等）
 * - context: 上下文信息（参数、环境等）
 */
export class ToolResponse {
    status: ToolStatus;
    text: string;
    data: Record<string, any>;
    errorInfo?: ErrorInfo;
    stats?: Record<string, any>;
    context?: Record<string, any>;

    constructor(
        status: ToolStatus,
        text: string,
        data: Record<string, any> = {},
        errorInfo?: ErrorInfo,
        stats?: Record<string, any>,
        context?: Record<string, any>
    ) {
        this.status = status;
        this.text = text;
        this.data = data;
        this.errorInfo = errorInfo;
        this.stats = stats;
        this.context = context;
    }

    /**
     * 转换为普通对象（用于序列化）
     */
    toDict(): Record<string, any> {
        const result: Record<string, any> = {
            status: this.status,
            text: this.text,
            data: this.data,
        };
        if (this.errorInfo) {
            result.error = this.errorInfo;
        }
        if (this.stats) {
            result.stats = this.stats;
        }
        if (this.context) {
            result.context = this.context;
        }
        return result;
    }

    /**
     * 转换为 JSON 字符串
     */
    toJson(): string {
        return JSON.stringify(this.toDict(), null, 2);
    }

    /**
     * 从字典对象创建 ToolResponse
     * 
     * @param data 字典对象
     */
    static fromDict(data: Record<string, any>): ToolResponse {
        const statusStr = data.status || ToolStatus.SUCCESS;
        const status = statusStr as ToolStatus;

        return new ToolResponse(
            status,
            data.text || "",
            data.data || {},
            data.error,
            data.stats,
            data.context
        );
    }

    /**
     * 从 JSON 字符串创建 ToolResponse
     * 
     * @param jsonStr JSON 字符串
     */
    static fromJson(jsonStr: string): ToolResponse {
        const data = JSON.parse(jsonStr);
        return ToolResponse.fromDict(data);
    }

    /**
     * 快速创建成功响应
     * 
     * @param text 给 LLM 阅读的文本
     * @param data 结构化数据
     * @param stats 运行统计
     * @param context 上下文信息
     */
    static success(
        text: string,
        data: Record<string, any> = {},
        stats?: Record<string, any>,
        context?: Record<string, any>
    ): ToolResponse {
        return new ToolResponse(ToolStatus.SUCCESS, text, data, undefined, stats, context);
    }

    /**
     * 快速创建部分成功响应
     * 
     * @param text 给 LLM 阅读的文本
     * @param data 结构化数据
     * @param stats 运行统计
     * @param context 上下文信息
     */
    static partial(
        text: string,
        data: Record<string, any> = {},
        stats?: Record<string, any>,
        context?: Record<string, any>
    ): ToolResponse {
        return new ToolResponse(ToolStatus.PARTIAL, text, data, undefined, stats, context);
    }

    /**
     * 快速创建错误响应
     * 
     * @param code 错误码（来自 ToolErrorCode）
     * @param message 错误消息
     * @param stats 运行统计
     * @param context 上下文信息
     */
    static error(
        code: string,
        message: string,
        stats?: Record<string, any>,
        context?: Record<string, any>
    ): ToolResponse {
        return new ToolResponse(
            ToolStatus.ERROR,
            message,
            {},
            { code, message },
            stats,
            context
        );
    }
}
