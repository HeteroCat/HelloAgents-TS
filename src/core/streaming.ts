/**
 * 流式输出支持 - SSE (Server-Sent Events) 实现
 */

export enum StreamEventType {
  AGENT_START = "agent_start",
  AGENT_FINISH = "agent_finish",
  STEP_START = "step_start",
  STEP_FINISH = "step_finish",
  TOOL_CALL_START = "tool_call_start",
  TOOL_CALL_FINISH = "tool_call_finish",
  LLM_CHUNK = "llm_chunk", // LLM 流式输出的文本块
  THINKING = "thinking", // Agent 思考过程
  ERROR = "error",
}

export class StreamEvent {
  /**
   * 流式事件
   */
  constructor(
    public type: StreamEventType,
    public timestamp: number,
    public agentName: string,
    public data: Record<string, any>
  ) {}

  /**
   * 创建事件
   */
  static create(
    eventType: StreamEventType,
    agentName: string,
    data: Record<string, any> = {}
  ): StreamEvent {
    return new StreamEvent(eventType, Date.now() / 1000, agentName, data);
  }

  /**
   * 转换为 SSE 格式
   */
  toSse(): string {
    const eventDict = this.toDict();

    // SSE 格式要求
    const lines = [
      `event: ${this.type}`,
      `data: ${JSON.stringify(eventDict)}`,
      "", // 空行表示事件结束
    ];
    return lines.join("\n") + "\n";
  }

  /**
   * 转换为对象
   */
  toDict(): Record<string, any> {
    return {
      type: this.type,
      timestamp: this.timestamp,
      agent_name: this.agentName,
      data: this.data,
    };
  }
}

export class StreamBuffer {
  /**
   * 流式输出缓冲区
   *
   * 用于收集和管理流式事件
   */
  private events: StreamEvent[] = [];

  constructor(public maxBufferSize: number = 100) {}

  /**
   * 添加事件到缓冲区
   */
  add(event: StreamEvent): void {
    this.events.push(event);

    // 简单的背压控制：超过最大缓冲区大小时丢弃旧事件
    if (this.events.length > this.maxBufferSize) {
      this.events.shift();
    }
  }

  /**
   * 获取所有事件
   */
  getAll(): StreamEvent[] {
    return [...this.events];
  }

  /**
   * 清空缓冲区
   */
  clear(): void {
    this.events = [];
  }

  /**
   * 按类型过滤事件
   */
  filterByType(eventType: StreamEventType): StreamEvent[] {
    return this.events.filter((e) => e.type === eventType);
  }
}

/**
 * 将事件流转换为 SSE 格式
 */
export async function* streamToSse(
  eventStream: AsyncIterable<StreamEvent>,
  includeTypes?: StreamEventType[]
): AsyncGenerator<string> {
  for await (const event of eventStream) {
    // 过滤事件类型
    if (includeTypes && !includeTypes.includes(event.type)) {
      continue;
    }

    // 转换为 SSE 格式
    yield event.toSse();
  }
}

/**
 * 将事件流转换为 JSON Lines 格式
 */
export async function* streamToJson(
  eventStream: AsyncIterable<StreamEvent>,
  includeTypes?: StreamEventType[]
): AsyncGenerator<string> {
  for await (const event of eventStream) {
    // 过滤事件类型
    if (includeTypes && !includeTypes.includes(event.type)) {
      continue;
    }

    // 转换为 JSON
    yield JSON.stringify(event.toDict()) + "\n";
  }
}
