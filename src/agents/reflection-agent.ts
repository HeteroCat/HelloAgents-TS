import { Agent } from '../core/agent';
import { HelloAgentsLLM } from '../core/llm';
import { Config } from '../core/config';
import { Message } from '../core/message';
import { ToolRegistry } from '../tools/registry';
import { StreamEvent, StreamEventType } from '../core/streaming';

class Memory {
  public records: { type: string; content: string }[] = [];

  addRecord(type: string, content: string): void {
    this.records.push({ type, content });
    console.log(`📝 记忆已更新，新增一条 '${type}' 记录。`);
  }

  getTrajectory(): string {
    return this.records.map(record => {
      if (record.type === 'execution') return `--- 上一轮尝试 ---\n${record.content}\n\n`;
      if (record.type === 'reflection') return `--- 评审员反馈 ---\n${record.content}\n\n`;
      return "";
    }).join("").trim();
  }

  getLastExecution(): string {
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].type === 'execution') return this.records[i].content;
    }
    return "";
  }
}

export class ReflectionAgent extends Agent {
  public maxIterations: number;
  public memory: Memory;
  public enableToolCalling: boolean;
  public maxToolIterations: number;

  constructor(
    name: string,
    llm: HelloAgentsLLM,
    systemPrompt: string | null = null,
    config: Config | null = null,
    maxIterations: number = 3,
    toolRegistry: ToolRegistry | null = null,
    enableToolCalling: boolean = true,
    maxToolIterations: number = 3
  ) {
    const defaultSystemPrompt = `你是一个具有自我反思能力的AI助手。你的工作流程是：
1. 首先尝试完成用户的任务
2. 然后反思你的回答，找出可能的问题或改进空间
3. 根据反思结果优化你的回答
4. 如果回答已经很好，在反思时回复"无需改进"

请始终保持批判性思维，追求更高质量的输出。`;

    super(name, llm, systemPrompt || defaultSystemPrompt, config, toolRegistry);
    this.maxIterations = maxIterations;
    this.memory = new Memory();
    this.enableToolCalling = enableToolCalling && toolRegistry !== null;
    this.maxToolIterations = maxToolIterations;
  }

  async run(inputText: string, options: Record<string, any> = {}): Promise<string> {
    console.log(`\n🤖 ${this.name} 开始处理任务: ${inputText}`);
    this.memory = new Memory();

    // 1. Initial attempt
    console.log("\n--- 正在进行初始尝试 ---");
    const initialResult = await this._executeTask(inputText, options);
    this.memory.addRecord("execution", initialResult);

    // 2. Reflect and Refine loop
    for (let i = 0; i < this.maxIterations; i++) {
      console.log(`\n--- 第 ${i + 1}/${this.maxIterations} 轮迭代 ---`);

      // a. Reflect
      console.log("\n-> 正在进行反思...");
      const lastResult = this.memory.getLastExecution();
      const feedback = await this._reflectOnResult(inputText, lastResult, options);
      this.memory.addRecord("reflection", feedback);

      // b. Check if finished
      if (feedback.includes("无需改进") || feedback.toLowerCase().includes("no need for improvement")) {
        console.log("\n✅ 反思认为结果已无需改进，任务完成。");
        break;
      }

      // c. Refine
      console.log("\n-> 正在进行优化...");
      const refinedResult = await this._refineResult(inputText, lastResult, feedback, options);
      this.memory.addRecord("execution", refinedResult);
    }

    const finalResult = this.memory.getLastExecution();
    console.log(`\n--- 任务完成 ---\n最终结果:\n${finalResult}`);

    this.addMessage(new Message(inputText, "user"));
    this.addMessage(new Message(finalResult, "assistant"));

    return finalResult;
  }

  private async _executeTask(task: string, options: Record<string, any>): Promise<string> {
    const messages = [
      { role: "system", content: this.systemPrompt || "" },
      { role: "user", content: `请完成以下任务：\n\n${task}` }
    ];
    return await this._getLlmResponse(messages, options);
  }

  private async _reflectOnResult(task: string, result: string, options: Record<string, any>): Promise<string> {
    const messages = [
      { role: "system", content: this.systemPrompt || "" },
      { role: "user", content: `请仔细审查以下回答，并找出可能的问题或改进空间：

# 原始任务:
${task}

# 当前回答:
${result}

请分析这个回答的质量，指出不足之处，并提出具体的改进建议。
如果回答已经很好，请回答"无需改进"。` }
    ];
    return await this._getLlmResponse(messages, options);
  }

  private async _refineResult(task: string, lastAttempt: string, feedback: string, options: Record<string, any>): Promise<string> {
    const messages = [
      { role: "system", content: this.systemPrompt || "" },
      { role: "user", content: `请根据反馈意见改进你的回答：

# 原始任务:
${task}

# 上一轮回答:
${lastAttempt}

# 反馈意见:
${feedback}

请提供一个改进后的回答。` }
    ];
    return await this._getLlmResponse(messages, options);
  }

  private async _getLlmResponse(messages: any[], options: Record<string, any>): Promise<string> {
    if (!this.enableToolCalling || !this.toolRegistry) {
      const response = await this.llm.ainvoke(messages, options);
      return response.content;
    }

    const toolSchemas = this._buildToolSchemas();
    let currentIteration = 0;

    while (currentIteration < this.maxToolIterations) {
      currentIteration++;

      try {
        const response = await this.llm.ainvokeWithTools(messages, toolSchemas, "auto", options);
        const responseMessage = response.choices[0].message;

        const toolCalls = responseMessage.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
          return responseMessage.content || "";
        }

        messages.push({
          role: "assistant",
          content: responseMessage.content,
          tool_calls: toolCalls.map((tc: any) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments
            }
          }))
        });

        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          const toolCallId = toolCall.id;
          const args = JSON.parse(toolCall.function.arguments);

          const result = await this._executeToolCall(toolName, args);
          messages.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: result
          } as any);
        }

      } catch (e: any) {
        console.error(`❌ LLM 调用失败: ${e.message}`);
        break;
      }
    }

    const response = await this.llm.ainvoke(messages, options);
    return response.content;
  }

  async *arunStream(
    inputText: string,
    options: Record<string, any> = {}
  ): AsyncGenerator<StreamEvent, void, unknown> {
    yield StreamEvent.create(StreamEventType.AGENT_START, this.name, { input_text: inputText });

    try {
      // 阶段 1：初始执行
      yield StreamEvent.create(StreamEventType.STEP_START, this.name, {
        phase: "initial_execution",
        description: "生成初始回答"
      });

      const messages = [{ role: "user", content: inputText }];
      if (this.systemPrompt) {
        messages.unshift({ role: "system", content: this.systemPrompt });
      }

      let initialResponse = "";
      for await (const chunk of this.llm.astreamInvoke(messages, options)) {
        initialResponse += chunk;
        yield StreamEvent.create(StreamEventType.LLM_CHUNK, this.name, {
          chunk,
          phase: "execution"
        });
      }

      yield StreamEvent.create(StreamEventType.STEP_FINISH, this.name, {
        phase: "initial_execution",
        result: initialResponse
      });

      // 阶段 2：反思与优化循环
      let currentResponse = initialResponse;

      for (let iteration = 0; iteration < this.maxIterations; iteration++) {
        // 反思阶段
        yield StreamEvent.create(StreamEventType.STEP_START, this.name, {
          phase: "reflection",
          iteration: iteration + 1,
          description: `第 ${iteration + 1} 次反思`
        });

        const reflectionPrompt = `请对以下回答进行反思：\n\n# 任务: ${inputText}\n\n# 回答: ${currentResponse}\n\n给出改进意见。`;
        let reflection = "";
        for await (const chunk of this.llm.astreamInvoke([{ role: "user", content: reflectionPrompt }], options)) {
          reflection += chunk;
          yield StreamEvent.create(StreamEventType.THINKING, this.name, {
            chunk,
            phase: "reflection",
            iteration: iteration + 1
          });
        }

        yield StreamEvent.create(StreamEventType.STEP_FINISH, this.name, {
          phase: "reflection",
          iteration: iteration + 1,
          reflection
        });

        if (reflection.includes("无需改进") || reflection.toLowerCase().includes("no need for improvement")) break;

        // 优化阶段
        yield StreamEvent.create(StreamEventType.STEP_START, this.name, {
          phase: "refinement",
          iteration: iteration + 1,
          description: `第 ${iteration + 1} 次优化`
        });

        const refinementPrompt = `根据反馈优化回答：\n\n# 反馈: ${reflection}\n\n# 原回答: ${currentResponse}\n\n给出优化后的回答。`;
        let refinedResponse = "";
        for await (const chunk of this.llm.astreamInvoke([{ role: "user", content: refinementPrompt }], options)) {
          refinedResponse += chunk;
          yield StreamEvent.create(StreamEventType.LLM_CHUNK, this.name, {
            chunk,
            phase: "refinement",
            iteration: iteration + 1
          });
        }

        yield StreamEvent.create(StreamEventType.STEP_FINISH, this.name, {
          phase: "refinement",
          iteration: iteration + 1,
          result: refinedResponse
        });

        currentResponse = refinedResponse;
      }

      yield StreamEvent.create(StreamEventType.AGENT_FINISH, this.name, {
        result: currentResponse,
        total_iterations: this.maxIterations
      });

      this.addMessage(new Message(inputText, "user"));
      this.addMessage(new Message(currentResponse, "assistant"));

    } catch (e: any) {
      yield StreamEvent.create(StreamEventType.ERROR, this.name, {
        error: e.message,
        error_type: e.constructor.name
      });
      throw e;
    }
  }
}
