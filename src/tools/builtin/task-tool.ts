import { Tool, ToolParameter } from '../base';
import { ToolResponse } from '../response';
import { ToolErrorCode } from '../errors';

/**
 * TaskTool - 子代理调用工具
 * 
 * 允许主 Agent 启动子代理处理子任务，实现上下文隔离。
 */
export class TaskTool extends Tool {
    private agentFactory: (agentType: string) => any;
    private toolRegistry: any;
    private config: any;

    constructor(
        agentFactory: (agentType: string) => any,
        toolRegistry?: any,
        config?: any
    ) {
        super(
            "Task",
            "启动子代理处理特定的子任务，使用隔离的上下文。适用于：探索代码库、规划任务、实现功能等需要独立上下文的场景。"
        );
        this.agentFactory = agentFactory;
        this.toolRegistry = toolRegistry;
        this.config = config || {};
    }

    getParameters(): ToolParameter[] {
        return [
            {
                name: "task",
                type: "string",
                description: "子任务的详细描述，告诉子代理具体要做什么",
                required: true
            },
            {
                name: "agent_type",
                type: "string",
                description: "子代理类型：react（推理行动）、reflection（反思）、plan（规划）、simple（简单对话）",
                required: false,
                default: "react"
            },
            {
                name: "tool_filter",
                type: "string",
                description: "工具过滤策略：readonly（只读工具）、full（完全访问）、none（无过滤）",
                required: false,
                default: "none"
            },
            {
                name: "max_steps",
                type: "integer",
                description: "最大步数限制（覆盖默认配置）",
                required: false
            }
        ];
    }

    async run(parameters: Record<string, any>): Promise<ToolResponse> {
        const startTime = Date.now();

        // 1. 解析参数
        const task = parameters.task || "";
        const agentType = (parameters.agent_type || "react").toLowerCase();
        const toolFilterType = (parameters.tool_filter || "none").toLowerCase();
        const maxSteps = parameters.max_steps;

        if (!task) {
            return ToolResponse.error(
                ToolErrorCode.INVALID_PARAM,
                "参数 'task' 不能为空"
            );
        }

        try {
            // 2. 创建子代理实例
            const subagent = this.agentFactory(agentType);
            
            // 3. 运行子代理（隔离模式）
            console.log(`\n[SubAgent-${agentType}] 开始执行: ${task.substring(0, 50)}...`);

            const result = await subagent.runAsSubagent({
                task: task,
                toolFilter: this.createToolFilter(toolFilterType),
                returnSummary: true,
                maxStepsOverride: maxSteps
            });

            const elapsedMs = Date.now() - startTime;

            // 4. 返回标准 ToolResponse
            if (result.success) {
                console.log(`[SubAgent-${agentType}] 完成 (${result.metadata.steps} 步, ${result.metadata.duration_seconds}秒)`);

                return ToolResponse.success(
                    `[SubAgent-${agentType}] 任务完成\n\n${result.summary}`,
                    {
                        agent_type: agentType,
                        task: task,
                        ...result.metadata
                    }
                );
            } else {
                console.log(`[SubAgent-${agentType}] 未完成: ${result.metadata.error || '未知错误'}`);

                return ToolResponse.partial(
                    `[SubAgent-${agentType}] 任务未完全完成\n\n${result.summary}`,
                    {
                        agent_type: agentType,
                        task: task,
                        ...result.metadata
                    }
                );
            }
        } catch (e) {
            const errorMsg = `子代理执行失败: ${e instanceof Error ? e.message : String(e)}`;
            console.error(errorMsg);
            return ToolResponse.error(
                ToolErrorCode.EXECUTION_ERROR,
                errorMsg
            );
        }
    }

    private createToolFilter(filterType: string): any {
        // 这里只是一个占位实现，具体过滤器逻辑应该在 ToolFilter 类中
        if (filterType === "readonly") {
            return { type: "readonly" };
        } else if (filterType === "full") {
            return { type: "full" };
        } else {
            return null;
        }
    }
}
