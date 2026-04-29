import { ToolResponse, ToolStatus } from './response';

/**
 * 熔断器机制 - 防止工具连续失败导致的死循环
 */

/**
 * 工具熔断器
 * 
 * 特性：
 * - 连续失败自动禁用工具
 * - 超时自动恢复
 * - 基于 ToolResponse 协议判断错误
 * 
 * 状态机：
 * Closed (正常) → Open (熔断) → Closed (恢复)
 */
export class CircuitBreaker {
    /** 连续失败多少次后熔断 */
    failureThreshold: number;
    /** 熔断后恢复时间（秒） */
    recoveryTimeout: number;
    /** 是否启用熔断器 */
    enabled: boolean;

    // 失败计数（每个工具）
    private failureCounts: Map<string, number> = new Map();

    // 熔断开启时间（毫秒时间戳）
    private openTimestamps: Map<string, number> = new Map();

    /**
     * 初始化熔断器
     * 
     * @param failureThreshold 连续失败阈值
     * @param recoveryTimeout 恢复超时（秒）
     * @param enabled 是否启用
     */
    constructor(
        failureThreshold: number = 3,
        recoveryTimeout: number = 300,
        enabled: boolean = true
    ) {
        this.failureThreshold = failureThreshold;
        this.recoveryTimeout = recoveryTimeout;
        this.enabled = enabled;
    }

    /**
     * 检查工具是否被熔断
     * 
     * @param toolName 工具名称
     * @returns true 如果工具被禁用，否则 false
     */
    isOpen(toolName: string): boolean {
        if (!this.enabled) {
            return false;
        }

        const openTime = this.openTimestamps.get(toolName);
        if (openTime === undefined) {
            return false;
        }

        // 检查是否可以恢复
        const elapsedSeconds = (Date.now() - openTime) / 1000;
        if (elapsedSeconds > this.recoveryTimeout) {
            // 自动恢复
            this.close(toolName);
            return false;
        }

        return true;
    }

    /**
     * 记录工具执行结果
     * 
     * @param toolName 工具名称
     * @param response 工具响应对象
     */
    recordResult(toolName: string, response: ToolResponse): void {
        if (!this.enabled) {
            return;
        }

        // 判断是否是错误
        const isError = response.status === ToolStatus.ERROR;

        if (isError) {
            this.onFailure(toolName);
        } else {
            this.onSuccess(toolName);
        }
    }

    private onFailure(toolName: string): void {
        const currentCount = (this.failureCounts.get(toolName) || 0) + 1;
        this.failureCounts.set(toolName, currentCount);

        // 检查是否达到阈值
        if (currentCount >= this.failureThreshold) {
            this.openTimestamps.set(toolName, Date.now());
            console.log(`🔴 Circuit Breaker: 工具 '${toolName}' 已熔断（连续 ${currentCount} 次失败）`);
        }
    }

    private onSuccess(toolName: string): void {
        // 重置失败计数
        this.failureCounts.set(toolName, 0);
    }

    /**
     * 手动开启熔断
     * 
     * @param toolName 工具名称
     */
    open(toolName: string): void {
        if (!this.enabled) {
            return;
        }
        this.openTimestamps.set(toolName, Date.now());
        console.log(`🔴 Circuit Breaker: 工具 '${toolName}' 已手动熔断`);
    }

    /**
     * 关闭熔断，恢复工具
     * 
     * @param toolName 工具名称
     */
    close(toolName: string): void {
        this.failureCounts.set(toolName, 0);
        this.openTimestamps.delete(toolName);
        console.log(`🟢 Circuit Breaker: 工具 '${toolName}' 已恢复`);
    }

    /**
     * 获取工具的熔断状态
     * 
     * @param toolName 工具名称
     * @returns 状态对象
     */
    getStatus(toolName: string): Record<string, any> {
        const isOpen = this.openTimestamps.has(toolName);
        const failureCount = this.failureCounts.get(toolName) || 0;

        if (isOpen) {
            const openTime = this.openTimestamps.get(toolName)!;
            const timeSinceOpenSeconds = (Date.now() - openTime) / 1000;
            const timeToRecover = Math.max(0, this.recoveryTimeout - timeSinceOpenSeconds);

            return {
                state: "open",
                failure_count: failureCount,
                open_since: openTime,
                recover_in_seconds: Math.floor(timeToRecover)
            };
        } else {
            return {
                state: "closed",
                failure_count: failureCount
            };
        }
    }

    /**
     * 获取所有工具的熔断状态
     * 
     * @returns 工具名称到状态对象的映射
     */
    getAllStatus(): Record<string, any> {
        // 收集所有已知的工具名
        const allTools = new Set([
            ...Array.from(this.failureCounts.keys()),
            ...Array.from(this.openTimestamps.keys())
        ]);

        const result: Record<string, any> = {};
        for (const toolName of allTools) {
            result[toolName] = this.getStatus(toolName);
        }
        return result;
    }
}
