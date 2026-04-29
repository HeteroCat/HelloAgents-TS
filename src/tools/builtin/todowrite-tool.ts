import * as fs from 'fs';
import * as path from 'path';
import { Tool, ToolParameter } from '../base';
import { ToolResponse } from '../response';
import { ToolErrorCode } from '../errors';

/**
 * 待办事项
 */
export interface TodoItem {
    content: string; // 任务内容
    status: string; // "pending" | "in_progress" | "completed"
    created_at: string; // 创建时间
    updated_at: string; // 更新时间
}

/**
 * 待办列表
 */
export class TodoList {
    summary: string; // 总体摘要
    todos: TodoItem[];

    constructor(summary: string, todos: TodoItem[] = []) {
        this.summary = summary;
        this.todos = todos;
    }

    getInProgress(): TodoItem | null {
        return this.todos.find(todo => todo.status === "in_progress") || null;
    }

    getPending(limit: number = 5): TodoItem[] {
        return this.todos
            .filter(todo => todo.status === "pending")
            .slice(0, limit);
    }

    getCompleted(): TodoItem[] {
        return this.todos.filter(todo => todo.status === "completed");
    }

    getStats(): Record<string, number> {
        const total = this.todos.length;
        const completed = this.todos.filter(t => t.status === "completed").length;
        const inProgress = this.todos.filter(t => t.status === "in_progress").length;
        const pending = total - completed - inProgress;

        return {
            total,
            completed,
            in_progress: inProgress,
            pending
        };
    }
}

/**
 * TodoWrite 进度管理工具
 * 
 * 提供任务列表管理能力，强制单线程专注，避免任务切换。
 */
export class TodoWriteTool extends Tool {
    private projectRoot: string;
    private persistenceDir: string;
    private currentTodos: TodoList;

    constructor(
        projectRoot: string = ".",
        persistenceDir: string = "memory/todos"
    ) {
        super(
            "TodoWrite",
            `管理任务列表，保持单线程专注。

特性：
- 每次提交完整列表（声明式）
- 最多 1 个任务标记为 in_progress
- 自动生成 Recap 保持上下文精简
- 自动保存到 memory/todos/

使用场景：
- 开始复杂任务时创建任务列表
- 跟踪进度，避免遗漏
- 多轮对话中保持状态

参数：
- summary: 总体任务描述（可选）
- todos: 待办事项列表（JSON 数组）
- action: 操作类型（create/update/clear，默认 create）`
        );
        this.projectRoot = path.resolve(projectRoot);
        this.persistenceDir = path.join(this.projectRoot, persistenceDir);

        if (!fs.existsSync(this.persistenceDir)) {
            fs.mkdirSync(this.persistenceDir, { recursive: true });
        }

        this.currentTodos = new TodoList("");
    }

    getParameters(): ToolParameter[] {
        return [
            {
                name: "summary",
                type: "string",
                description: "总体任务描述（简短，1-2 句话）",
                required: false,
                default: ""
            },
            {
                name: "todos",
                type: "array",
                description: `待办事项列表（JSON 数组）

格式：[
  {"content": "任务1", "status": "pending"},
  {"content": "任务2", "status": "in_progress"},
  {"content": "任务3", "status": "completed"}
]

规则：
- status 只能是：pending, in_progress, completed
- 最多 1 个任务可以标记为 in_progress
- 每次提交完整列表（声明式）`,
                required: false,
                default: []
            },
            {
                name: "action",
                type: "string",
                description: "操作类型：create|update|clear（默认 create）",
                required: false,
                default: "create"
            }
        ];
    }

    async run(parameters: Record<string, any>): Promise<ToolResponse> {
        const action = parameters.action || "create";

        try {
            if (action === "clear") {
                this.currentTodos = new TodoList("");
                return ToolResponse.success("✅ 任务列表已清空", {
                    action,
                    summary: "",
                    stats: { total: 0, completed: 0, in_progress: 0, pending: 0 }
                });
            }

            let todosData = parameters.todos || [];

            // 验证约束
            const validation = this.validateTodos(todosData);
            if (!validation.valid) {
                return ToolResponse.error(
                    ToolErrorCode.INVALID_PARAM,
                    validation.message
                );
            }

            // 创建 TodoItem 对象
            const now = new Date().toISOString();
            const todos: TodoItem[] = todosData.map((item: any) => ({
                content: item.content,
                status: item.status,
                created_at: item.created_at || now,
                updated_at: now
            }));

            // 更新当前列表
            const summary = parameters.summary || "";
            this.currentTodos = new TodoList(summary, todos);

            // 生成 Recap
            const recap = this.generateRecap();

            // 持久化
            this.persistTodos();

            return ToolResponse.success(recap, {
                action,
                summary: this.currentTodos.summary,
                stats: this.currentTodos.getStats()
            });
        } catch (e) {
            return ToolResponse.error(
                ToolErrorCode.INTERNAL_ERROR,
                `处理任务列表失败：${e instanceof Error ? e.message : String(e)}`
            );
        }
    }

    private validateTodos(todosData: any): { valid: boolean; message: string } {
        if (!Array.isArray(todosData)) {
            return { valid: false, message: "todos 必须是数组" };
        }

        const inProgressCount = todosData.filter(t => t.status === "in_progress").length;
        if (inProgressCount > 1) {
            return {
                valid: false,
                message: `最多只能有 1 个 in_progress 任务，当前有 ${inProgressCount} 个`
            };
        }

        for (let i = 0; i < todosData.length; i++) {
            const todo = todosData[i];
            if (typeof todo !== 'object' || todo === null) {
                return { valid: false, message: `第 ${i + 1} 个任务必须是对象` };
            }

            const content = todo.content || "";
            const status = todo.status || "";

            if (!content.trim()) {
                return { valid: false, message: `第 ${i + 1} 个任务的 content 不能为空` };
            }

            if (!["pending", "in_progress", "completed"].includes(status)) {
                return {
                    valid: false,
                    message: `第 ${i + 1} 个任务的 status 必须是 pending/in_progress/completed`
                };
            }
        }

        return { valid: true, message: "" };
    }

    private generateRecap(): string {
        const stats = this.currentTodos.getStats();

        if (stats.total === 0) {
            return "📋 [0/0] 无活动任务";
        }

        const recapParts = [`📋 [${stats.completed}/${stats.total}]`];

        const inProgress = this.currentTodos.getInProgress();
        if (inProgress) {
            recapParts.push(`进行中: ${inProgress.content}`);
        }

        const pending = this.currentTodos.getPending(3);
        if (pending.length > 0) {
            const pendingTexts = pending.map(t => t.content);
            recapParts.push(`待处理: ${pendingTexts.join('; ')}`);
        }

        if (stats.pending > 3) {
            recapParts.push(`还有 ${stats.pending - 3} 个...`);
        }

        if (stats.completed === stats.total && stats.total > 0) {
            return `✅ [${stats.completed}/${stats.total}] 所有任务已完成！`;
        }

        return recapParts.join('. ');
    }

    private persistTodos() {
        const timestamp = new Date().toISOString().replace(/[:T]/g, '_').substring(0, 19);
        const filename = `todoList-${timestamp}.json`;
        const filePath = path.join(this.persistenceDir, filename);

        const data = {
            summary: this.currentTodos.summary,
            todos: this.currentTodos.todos,
            created_at: new Date().toISOString(),
            stats: this.currentTodos.getStats()
        };

        // 原子写入
        const tempPath = filePath + '.tmp';
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tempPath, filePath);
    }
}
