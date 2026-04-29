import { Agent } from '../core/agent';
import { HelloAgentsLLM } from '../core/llm';
import { Config } from '../core/config';
import { Message } from '../core/message';
import { StreamEvent, StreamEventType } from '../core/streaming';
import { ToolRegistry } from '../tools/registry';

export class SimpleAgent extends Agent {
  public enableToolCalling: boolean;
  public maxToolIterations: number;

  constructor(
    name: string,
    llm: HelloAgentsLLM,
    systemPrompt: string | null = null,
    config: Config | null = null,
    toolRegistry: ToolRegistry | null = null,
    enableToolCalling: boolean = true,
    maxToolIterations: number = 3
  ) {
    super(name, llm, systemPrompt, config, toolRegistry);
    this.enableToolCalling = enableToolCalling && toolRegistry !== null;
    this.maxToolIterations = maxToolIterations;
  }

  async run(inputText: string, options: Record<string, any> = {}): Promise<string> {
    const startTime = Date.now();
    
    if (this.traceLogger) {
      this.traceLogger.logEvent("message_written", { role: "user", content: inputText });
    }

    const messages = this._buildMessages(inputText);

    if (!this.enableToolCalling || !this.toolRegistry) {
      const response = await this.llm.invoke(messages, options);
      const responseText = response.content;

      this.addMessage(new Message(inputText, "user"));
      this.addMessage(new Message(responseText, "assistant"));

      if (this.traceLogger) {
        const duration = (Date.now() - startTime) / 1000;
        this.traceLogger.logEvent("session_end", {
          duration,
          final_answer: responseText,
          status: "success",
          usage: response.usage,
          latency_ms: response.latencyMs
        });
        this.traceLogger.finalize();
      }

      return responseText;
    }

    // Tool calling mode
    const toolSchemas = this._buildToolSchemas();
    let currentIteration = 0;
    let finalResponse = "";

    while (currentIteration < this.maxToolIterations) {
      currentIteration++;

      try {
        const response = await this.llm.invokeWithTools(messages, toolSchemas, "auto", options);
        const responseMessage = response.choices[0].message;

        if (this.traceLogger) {
          this.traceLogger.logEvent("model_output", {
            content: responseMessage.content,
            tool_calls: responseMessage.tool_calls?.length || 0,
            usage: response.usage
          }, currentIteration);
        }

        const toolCalls = responseMessage.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
          finalResponse = responseMessage.content || "抱歉，我无法回答这个问题。";
          break;
        }

        // Add assistant message with tool calls to history
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

        // Execute tool calls
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
            }, currentIteration);
          }

          const result = await this._executeToolCall(toolName, args);

          if (this.traceLogger) {
            this.traceLogger.logEvent("tool_result", {
              tool_name: toolName,
              tool_call_id: toolCallId,
              result: result
            }, currentIteration);
          }

          messages.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: result
          } as any);
        }

      } catch (e: any) {
        if (this.traceLogger) {
          this.traceLogger.logEvent("error", {
            error_type: "LLM_ERROR",
            message: e.message
          }, currentIteration);
        }
        break;
      }
    }

    if (currentIteration >= this.maxToolIterations && !finalResponse) {
      const response = await this.llm.invoke(messages, options);
      finalResponse = response.content;
    }

    this.addMessage(new Message(inputText, "user"));
    this.addMessage(new Message(finalResponse, "assistant"));

    if (this.traceLogger) {
      const duration = (Date.now() - startTime) / 1000;
      this.traceLogger.logEvent("session_end", {
        duration,
        total_steps: currentIteration,
        final_answer: finalResponse,
        status: "success"
      });
      this.traceLogger.finalize();
    }

    return finalResponse;
  }

  private _buildMessages(inputText: string): any[] {
    const messages: any[] = [];
    if (this.systemPrompt) {
      messages.push({ role: "system", content: this.systemPrompt });
    }
    for (const msg of this.getHistory()) {
      // Map custom 'summary' role to 'system' for OpenAI API compatibility
      const role = msg.role === "summary" ? "system" : msg.role;
      messages.push({ role, content: msg.content });
    }
    messages.push({ role: "user", content: inputText });
    return messages;
  }

  async *streamRun(inputText: string, options: Record<string, any> = {}): AsyncGenerator<string> {
    const messages = this._buildMessages(inputText);
    let fullResponse = "";
    
    for await (const chunk of this.llm.streamInvoke(messages, options)) {
      fullResponse += chunk;
      yield chunk;
    }

    this.addMessage(new Message(inputText, "user"));
    this.addMessage(new Message(fullResponse, "assistant"));
  }

  async *arunStream(
    inputText: string,
    options: Record<string, any> = {}
  ): AsyncGenerator<StreamEvent, void, unknown> {
    yield StreamEvent.create(StreamEventType.AGENT_START, this.name, { input_text: inputText });

    try {
      const messages = this._buildMessages(inputText);
      let fullResponse = "";

      for await (const chunk of this.llm.astreamInvoke(messages, options)) {
        fullResponse += chunk;
        yield StreamEvent.create(StreamEventType.LLM_CHUNK, this.name, {
          chunk,
        });
      }

      yield StreamEvent.create(StreamEventType.AGENT_FINISH, this.name, {
        result: fullResponse,
      });

      this.addMessage(new Message(inputText, "user"));
      this.addMessage(new Message(fullResponse, "assistant"));
    } catch (e: any) {
      yield StreamEvent.create(StreamEventType.ERROR, this.name, {
        error: e.message,
        error_type: e.constructor.name,
      });
      throw e;
    }
  }

  addTool(tool: any, autoExpand: boolean = true): void {
    if (!this.toolRegistry) {
      this.toolRegistry = new ToolRegistry();
      this.enableToolCalling = true;
    }
    this.toolRegistry.registerTool(tool, autoExpand);
  }

  removeTool(toolName: string): boolean {
    if (this.toolRegistry) {
      this.toolRegistry.unregister(toolName);
      return true;
    }
    return false;
  }

  listTools(): string[] {
    return this.toolRegistry ? this.toolRegistry.listTools() : [];
  }

  hasTools(): boolean {
    return this.enableToolCalling && this.toolRegistry !== null;
  }
}
