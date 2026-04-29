import { Agent } from '../core/agent';
import { HelloAgentsLLM } from '../core/llm';
import { Config } from '../core/config';
import { Message } from '../core/message';
import { EventType, LifecycleHook } from '../core/lifecycle';
import { StreamEvent, StreamEventType } from '../core/streaming';
import { ToolRegistry } from '../tools/registry';

export const DEFAULT_REACT_SYSTEM_PROMPT = `你是一个具备推理和行动能力的 AI 助手。

## 工作流程
你可以通过调用工具来完成任务：

1. **Thought 工具**：用于记录你的推理过程和分析
   - 在需要思考时调用
   - 参数：reasoning（你的推理内容）

2. **业务工具**：用于获取信息或执行操作
   - 根据任务需求选择合适的工具
   - 可以多次调用不同工具

3. **Finish 工具**：用于返回最终答案
   - 当你有足够信息得出结论时调用
   - 参数：answer（最终答案）

## 重要提醒
- 主动使用 Thought 工具记录推理过程
- 可以多次调用工具获取信息
- 只有在确信有足够信息时才调用 Finish
`;

export class ReActAgent extends Agent {
  public maxSteps: number;
  private _builtinTools: Set<string>;

  constructor(
    name: string,
    llm: HelloAgentsLLM,
    toolRegistry: ToolRegistry | null = null,
    systemPrompt: string | null = null,
    config: Config | null = null,
    maxSteps: number = 5
  ) {
    super(name, llm, systemPrompt || DEFAULT_REACT_SYSTEM_PROMPT, config, toolRegistry || new ToolRegistry());
    this.maxSteps = maxSteps;
    this._builtinTools = new Set(["Thought", "Finish"]);
  }

  addTool(tool: any): void {
    if (this.toolRegistry) {
      this.toolRegistry.registerTool(tool);
    }
  }

  async run(inputText: string, options: Record<string, any> = {}): Promise<string> {
    const startTime = Date.now();
    try {
      const finalAnswer = await this._runImpl(inputText, startTime, options);
      return finalAnswer;
    } catch (e: any) {
      if (this.sessionStore) {
        try {
          this.saveSession("session-error");
        } catch (saveError) {
          console.error(`❌ 保存失败: ${saveError}`);
        }
      }
      throw e;
    }
  }

  private async _runImpl(inputText: string, sessionStartTime: number, options: Record<string, any>): Promise<string> {
    const messages = this._buildMessages(inputText);
    const toolSchemas = this._buildToolSchemas();

    let currentStep = 0;
    let totalTokens = 0;

    if (this.traceLogger) {
      this.traceLogger.logEvent("message_written", { role: "user", content: inputText });
    }

    console.log(`\n🤖 ${this.name} 开始处理问题: ${inputText}`);

    while (currentStep < this.maxSteps) {
      currentStep++;
      console.log(`\n--- 第 ${currentStep} 步 ---`);

      try {
        const response = await this.llm.invokeWithTools(messages, toolSchemas, "auto", options);
        const responseMessage = response.choices[0].message;

        if (response.usage) {
          totalTokens += response.usage.total_tokens;
        }

        if (this.traceLogger) {
          this.traceLogger.logEvent("model_output", {
            content: responseMessage.content || "",
            tool_calls: responseMessage.tool_calls?.length || 0,
            usage: response.usage
          }, currentStep);
        }

        const toolCalls = responseMessage.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
          const finalAnswer = responseMessage.content || "抱歉，我无法回答这个问题。";
          console.log(`💬 直接回复: ${finalAnswer}`);

          this.addMessage(new Message(inputText, "user"));
          this.addMessage(new Message(finalAnswer, "assistant"));

          if (this.traceLogger) {
            const duration = (Date.now() - sessionStartTime) / 1000;
            this.traceLogger.logEvent("session_end", {
              duration,
              total_steps: currentStep,
              final_answer: finalAnswer,
              status: "success"
            });
            this.traceLogger.finalize();
          }
          return finalAnswer;
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
          let args: Record<string, any>;

          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch (e: any) {
            messages.push({
              role: "tool",
              tool_call_id: toolCallId,
              content: `错误：参数格式不正确 - ${e.message}`
            } as any);
            continue;
          }

          if (this.traceLogger) {
            this.traceLogger.logEvent("tool_call", {
              tool_name: toolName,
              tool_call_id: toolCallId,
              args: args
            }, currentStep);
          }

          if (this._builtinTools.has(toolName)) {
            const result = this._handleBuiltinTool(toolName, args);
            console.log(`🔧 ${toolName}: ${result.content}`);

            if (this.traceLogger) {
              this.traceLogger.logEvent("tool_result", {
                tool_name: toolName,
                tool_call_id: toolCallId,
                status: "success",
                result: result.content
              }, currentStep);
            }

            if (toolName === "Finish" && result.finished) {
              const finalAnswer = result.finalAnswer;
              console.log(`🎉 最终答案: ${finalAnswer}`);

              this.addMessage(new Message(inputText, "user"));
              this.addMessage(new Message(finalAnswer, "assistant"));

              if (this.traceLogger) {
                const duration = (Date.now() - sessionStartTime) / 1000;
                this.traceLogger.logEvent("session_end", {
                  duration,
                  total_steps: currentStep,
                  final_answer: finalAnswer,
                  status: "success"
                });
                this.traceLogger.finalize();
              }
              return finalAnswer;
            }

            messages.push({
              role: "tool",
              tool_call_id: toolCallId,
              content: result.content
            } as any);
          } else {
            console.log(`🎬 调用工具: ${toolName}(${JSON.stringify(args)})`);
            const result = await this._executeToolCall(toolName, args);

            if (this.traceLogger) {
              this.traceLogger.logEvent("tool_result", {
                tool_name: toolName,
                tool_call_id: toolCallId,
                result: result
              }, currentStep);
            }

            console.log(result.startsWith("❌") ? result : `👀 观察: ${result}`);
            messages.push({
              role: "tool",
              tool_call_id: toolCallId,
              content: result
            } as any);
          }
        }
      } catch (e: any) {
        console.error(`❌ LLM 调用失败: ${e.message}`);
        if (this.traceLogger) {
          this.traceLogger.logEvent("error", {
            error_type: "LLM_ERROR",
            message: e.message
          }, currentStep);
        }
        break;
      }
    }

    const finalAnswer = "抱歉，我无法在限定步数内完成这个任务。";
    this.addMessage(new Message(inputText, "user"));
    this.addMessage(new Message(finalAnswer, "assistant"));
    return finalAnswer;
  }

  private _buildMessages(inputText: string): any[] {
    const messages: any[] = [];
    if (this.systemPrompt) {
      messages.push({ role: "system", content: this.systemPrompt });
    }
    messages.push({ role: "user", content: inputText });
    return messages;
  }

  _buildToolSchemas(): any[] {
    const schemas: any[] = [];

    // Builtin tools
    schemas.push({
      type: "function",
      function: {
        name: "Thought",
        description: "分析问题，制定策略，记录推理过程。在需要思考时调用此工具。",
        parameters: {
          type: "object",
          properties: {
            reasoning: { type: "string", description: "你的推理过程和分析" }
          },
          required: ["reasoning"]
        }
      }
    });

    schemas.push({
      type: "function",
      function: {
        name: "Finish",
        description: "当你有足够信息得出结论时，使用此工具返回最终答案。",
        parameters: {
          type: "object",
          properties: {
            answer: { type: "string", description: "最终答案" }
          },
          required: ["answer"]
        }
      }
    });

    if (this.toolRegistry) {
      schemas.push(...super._buildToolSchemas());
    }

    return schemas;
  }

  private _handleBuiltinTool(toolName: string, args: Record<string, any>): any {
    if (toolName === "Thought") {
      return {
        content: `推理: ${args.reasoning || ""}`,
        finished: false
      };
    } else if (toolName === "Finish") {
      const answer = args.answer || "";
      return {
        content: `最终答案: ${answer}`,
        finished: true,
        finalAnswer: answer
      };
    }
    return {
      content: `未知的内置工具: ${toolName}`,
      finished: false
    };
  }

  async arun(
    inputText: string,
    hooks: {
      onStart?: LifecycleHook;
      onStep?: LifecycleHook;
      onToolCall?: LifecycleHook;
      onFinish?: LifecycleHook;
      onError?: LifecycleHook;
    } = {},
    options: Record<string, any> = {}
  ): Promise<string> {
    const sessionStartTime = Date.now();
    await this._emitEvent(EventType.AGENT_START, hooks.onStart, { input_text: inputText });

    try {
      const messages = this._buildMessages(inputText);
      const toolSchemas = this._buildToolSchemas();

      let currentStep = 0;
      let totalTokens = 0;

      while (currentStep < this.maxSteps) {
        currentStep++;
        await this._emitEvent(EventType.STEP_START, hooks.onStep, { step: currentStep });

        const response = await this.llm.ainvokeWithTools(messages, toolSchemas, "auto", options);
        const responseMessage = response.choices[0].message;

        if (response.usage) totalTokens += response.usage.total_tokens;

        const toolCalls = responseMessage.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
          const finalAnswer = responseMessage.content || "抱歉，我无法回答这个问题。";
          this.addMessage(new Message(inputText, "user"));
          this.addMessage(new Message(finalAnswer, "assistant"));
          await this._emitEvent(EventType.AGENT_FINISH, hooks.onFinish, {
            result: finalAnswer,
            total_steps: currentStep,
            total_tokens: totalTokens
          });
          return finalAnswer;
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

        const toolResults = await this._executeToolsAsync(toolCalls, currentStep, hooks.onToolCall);

        for (const [toolName, toolCallId, result] of toolResults) {
          if (toolName === "Finish" && (result as any).finished) {
            const finalAnswer = (result as any).finalAnswer;
            this.addMessage(new Message(inputText, "user"));
            this.addMessage(new Message(finalAnswer, "assistant"));
            await this._emitEvent(EventType.AGENT_FINISH, hooks.onFinish, {
              result: finalAnswer,
              total_steps: currentStep,
              total_tokens: totalTokens
            });
            return finalAnswer;
          }
          messages.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: (result as any).content || JSON.stringify(result)
          } as any);
        }

        await this._emitEvent(EventType.STEP_FINISH, hooks.onStep, {
          step: currentStep,
          tool_calls: toolCalls.length
        });
      }

      const finalAnswer = "抱歉，我无法在限定步数内完成这个任务。";
      await this._emitEvent(EventType.AGENT_FINISH, hooks.onFinish, {
        result: finalAnswer,
        total_steps: currentStep,
        total_tokens: totalTokens,
        status: "timeout"
      });
      return finalAnswer;

    } catch (e: any) {
      await this._emitEvent(EventType.AGENT_ERROR, hooks.onError, {
        error: e.message,
        error_type: e.constructor.name
      });
      throw e;
    }
  }

  private async _executeToolsAsync(
    toolCalls: any[],
    currentStep: number,
    onToolCall?: LifecycleHook
  ): Promise<[string, string, any][]> {
    const builtinCalls = toolCalls.filter(tc => this._builtinTools.has(tc.function.name));
    const userCalls = toolCalls.filter(tc => !this._builtinTools.has(tc.function.name));

    const results: [string, string, any][] = [];

    // Builtin tools executed sequentially
    for (const tc of builtinCalls) {
      const toolName = tc.function.name;
      const toolCallId = tc.id;
      const args = JSON.parse(tc.function.arguments);
      
      await this._emitEvent(EventType.TOOL_CALL, onToolCall, {
        tool_name: toolName,
        tool_call_id: toolCallId,
        args,
        step: currentStep
      });

      const result = this._handleBuiltinTool(toolName, args);
      results.push([toolName, toolCallId, result]);
    }

    // User tools executed in parallel
    if (userCalls.length > 0) {
      const userResults = await Promise.all(userCalls.map(async (tc) => {
        const toolName = tc.function.name;
        const toolCallId = tc.id;
        const args = JSON.parse(tc.function.arguments);

        await this._emitEvent(EventType.TOOL_CALL, onToolCall, {
          tool_name: toolName,
          tool_call_id: toolCallId,
          args,
          step: currentStep
        });

        const resultText = await this._executeToolCall(toolName, args);
        return [toolName, toolCallId, { content: resultText }] as [string, string, any];
      }));
      results.push(...userResults);
    }

    return results;
  }

  async *arunStream(
    inputText: string,
    options: Record<string, any> = {}
  ): AsyncGenerator<StreamEvent, void, unknown> {
    yield StreamEvent.create(StreamEventType.AGENT_START, this.name, { input_text: inputText });

    try {
      const messages = this._buildMessages(inputText);
      const toolSchemas = this._buildToolSchemas();
      let currentStep = 0;

      while (currentStep < this.maxSteps) {
        currentStep++;
        yield StreamEvent.create(StreamEventType.STEP_START, this.name, {
          step: currentStep,
          max_steps: this.maxSteps
        });

        // Use invokeWithTools directly — streaming + tool calling
        // requires a single call to get both content and tool_calls
        const response = await this.llm.invokeWithTools(messages, toolSchemas, "auto", options);
        const responseMessage = response.choices[0].message;
        const toolCalls = responseMessage.tool_calls;

        // Emit the content as a chunk if present
        if (responseMessage.content) {
          yield StreamEvent.create(StreamEventType.LLM_CHUNK, this.name, {
            chunk: responseMessage.content,
            step: currentStep
          });
        }

        if (!toolCalls || toolCalls.length === 0) {
          const result = responseMessage.content || "";
          yield StreamEvent.create(StreamEventType.AGENT_FINISH, this.name, { result, total_steps: currentStep });
          this.addMessage(new Message(inputText, "user"));
          this.addMessage(new Message(result, "assistant"));
          return;
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

        const toolResults = await this._executeToolsAsync(toolCalls, currentStep);

        for (const [toolName, toolCallId, result] of toolResults) {
          yield StreamEvent.create(StreamEventType.TOOL_CALL_FINISH, this.name, {
            tool_name: toolName,
            tool_call_id: toolCallId,
            result: (result as any).content || result,
            step: currentStep
          });

          if (toolName === "Finish" && (result as any).finished) {
            const finalAnswer = (result as any).finalAnswer;
            yield StreamEvent.create(StreamEventType.AGENT_FINISH, this.name, { result: finalAnswer, total_steps: currentStep });
            this.addMessage(new Message(inputText, "user"));
            this.addMessage(new Message(finalAnswer, "assistant"));
            return;
          }

          messages.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: (result as any).content || JSON.stringify(result)
          } as any);
        }

        yield StreamEvent.create(StreamEventType.STEP_FINISH, this.name, { step: currentStep });
      }

      yield StreamEvent.create(StreamEventType.AGENT_FINISH, this.name, {
        result: "已达到最大步数限制",
        total_steps: currentStep
      });

    } catch (e: any) {
      yield StreamEvent.create(StreamEventType.ERROR, this.name, {
        error: e.message,
        error_type: e.constructor.name
      });
      throw e;
    }
  }
}
