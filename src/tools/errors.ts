/**
 * 工具错误码定义
 * 
 * 标准化的工具错误码，用于统一错误处理和追踪。
 */

/**
 * 工具错误码枚举
 * 
 * 定义了所有工具可能返回的标准错误码，便于：
 * - Agent 层统一处理错误
 * - 熔断器机制识别失败类型
 * - 可观测性系统追踪错误
 * - 用户友好的错误提示
 */
export class ToolErrorCode {
    // 资源相关错误
    /** 资源不存在（文件、工具等） */
    static readonly NOT_FOUND = "NOT_FOUND";
    /** 访问被拒绝 */
    static readonly ACCESS_DENIED = "ACCESS_DENIED";
    /** 权限不足 */
    static readonly PERMISSION_DENIED = "PERMISSION_DENIED";
    /** 期望文件但得到目录 */
    static readonly IS_DIRECTORY = "IS_DIRECTORY";
    /** 二进制文件无法处理 */
    static readonly BINARY_FILE = "BINARY_FILE";
    
    // 参数相关错误
    /** 参数无效或缺失 */
    static readonly INVALID_PARAM = "INVALID_PARAM";
    /** 格式错误 */
    static readonly INVALID_FORMAT = "INVALID_FORMAT";
    
    // 执行相关错误
    /** 执行过程中发生错误 */
    static readonly EXECUTION_ERROR = "EXECUTION_ERROR";
    /** 执行超时 */
    static readonly TIMEOUT = "TIMEOUT";
    /** 内部错误 */
    static readonly INTERNAL_ERROR = "INTERNAL_ERROR";
    
    // 状态相关错误
    /** 冲突（如乐观锁冲突） */
    static readonly CONFLICT = "CONFLICT";
    /** 熔断器开启，拒绝执行 */
    static readonly CIRCUIT_OPEN = "CIRCUIT_OPEN";
    
    // 网络相关错误
    /** 网络请求失败 */
    static readonly NETWORK_ERROR = "NETWORK_ERROR";
    /** API 调用失败 */
    static readonly API_ERROR = "API_ERROR";
    /** 速率限制 */
    static readonly RATE_LIMIT = "RATE_LIMIT";

    /**
     * 获取所有错误码
     */
    static getAllCodes(): string[] {
        return Object.entries(this)
            .filter(([key, value]) => typeof value === 'string' && key === key.toUpperCase())
            .map(([_, value]) => value as string);
    }

    /**
     * 检查是否是有效的错误码
     * 
     * @param code 错误码
     */
    static isValidCode(code: string): boolean {
        return this.getAllCodes().includes(code);
    }
}
