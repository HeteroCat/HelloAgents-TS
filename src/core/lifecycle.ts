/**
 * Agent 异步生命周期事件系统
 */

export enum EventType {
  // Agent 级别事件
  AGENT_START = "agent_start", // Agent 开始执行
  AGENT_FINISH = "agent_finish", // Agent 执行完成
  AGENT_ERROR = "agent_error", // Agent 执行错误

  // 步骤级别事件
  STEP_START = "step_start", // 推理步骤开始
  STEP_FINISH = "step_finish", // 推理步骤完成

  // LLM 调用事件
  LLM_START = "llm_start", // LLM 调用开始
  LLM_CHUNK = "llm_chunk", // LLM 流式输出片段
  LLM_FINISH = "llm_finish", // LLM 调用完成

  // 工具调用事件
  TOOL_CALL = "tool_call", // 工具调用开始
  TOOL_RESULT = "tool_result", // 工具调用结果
  TOOL_ERROR = "tool_error", // 工具调用错误

  // 特殊事件
  THINKING = "thinking", // 推理过程（o1/deepseek-reasoner）
  REFLECTION = "reflection", // 反思过程
  PLAN = "plan", // 计划生成
}

export class AgentEvent {
  /**
   * Agent 生命周期事件
   *
   * 所有事件的基础数据结构，包含：
   * - type: 事件类型
   * - timestamp: 时间戳
   * - agentName: Agent 名称
   * - data: 事件数据（灵活扩展）
   */
  constructor(
    public type: EventType,
    public timestamp: number,
    public agentName: string,
    public data: Record<string, any> = {}
  ) {}

  /**
   * 创建事件的便捷方法
   */
  static create(
    eventType: EventType,
    agentName: string,
    data: Record<string, any> = {}
  ): AgentEvent {
    return new AgentEvent(eventType, Date.now() / 1000, agentName, data);
  }

  /**
   * 转换为对象（用于序列化）
   */
  toDict(): Record<string, any> {
    return {
      type: this.type,
      timestamp: this.timestamp,
      agent_name: this.agentName,
      data: this.data,
    };
  }

  /**
   * 字符串表示
   */
  toString(): string {
    return `[${this.type}] ${this.agentName} @ ${this.timestamp.toFixed(
      2
    )}: ${JSON.stringify(this.data)}`;
  }
}

// 类型别名：生命周期钩子
export type LifecycleHook =
  | ((event: AgentEvent) => Promise<void>)
  | null
  | undefined;

export class ExecutionContext {
  /**
   * Agent 执行上下文
   *
   * 在异步执行过程中传递的上下文信息，包含：
   * - 输入文本
   * - 当前步骤
   * - 累计 token 数
   * - 自定义元数据
   */
  public currentStep: number = 0;
  public totalTokens: number = 0;

  constructor(
    public inputText: string,
    public metadata: Record<string, any> = {}
  ) {}

  /**
   * 步骤计数器 +1
   */
  incrementStep(): void {
    this.currentStep += 1;
  }

  /**
   * 累加 token 数
   */
  addTokens(tokens: number): void {
    this.totalTokens += tokens;
  }

  /**
   * 设置元数据
   */
  setMetadata(key: string, value: any): void {
    this.metadata[key] = value;
  }

  /**
   * 获取元数据
   */
  getMetadata(key: string, defaultValue: any = null): any {
    return this.metadata[key] !== undefined ? this.metadata[key] : defaultValue;
  }
}
