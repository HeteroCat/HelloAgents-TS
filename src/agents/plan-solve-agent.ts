import { Agent } from '../core/agent';
import { HelloAgentsLLM } from '../core/llm';
import { Config } from '../core/config';
import { Message } from '../core/message';
import { ToolRegistry } from '../tools/registry';
import { SimpleAgent } from './simple-agent';
import { StreamEvent, StreamEventType } from '../core/streaming';

class Planner {
  public llmClient: HelloAgentsLLM;
  public systemPrompt: string;

  constructor(llmClient: HelloAgentsLLM, systemPrompt: string | null = null) {
    this.llmClient = llmClient;
    this.systemPrompt = systemPrompt || `你是一个顶级的AI规划专家。你的任务是将用户提出的复杂问题分解成一个由多个简单步骤组成的行动计划。
请确保计划中的每个步骤都是一个独立的、可执行的子任务，并且严格按照逻辑顺序排列。`;
  }

  async plan(question: string, options: Record<string, any> = {}): Promise<string[]> {
    console.log("--- 正在生成计划 ---");

    const planTool = {
      type: "function",
      function: {
        name: "generate_plan",
        description: "生成解决问题的分步计划",
        parameters: {
          type: "object",
          properties: {
            steps: {
              type: "array",
              items: { type: "string" },
              description: "按顺序排列的执行步骤列表"
            }
          },
          required: ["steps"]
        }
      }
    };

    const messages = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: `请为以下问题生成详细的执行计划：\n\n${question}` }
    ];

    try {
      const response = await this.llmClient.invokeWithTools(
        messages,
        [planTool],
        { type: "function", function: { name: "generate_plan" } },
        options
      );

      const responseMessage = response.choices[0].message;
      if (responseMessage.tool_calls) {
        const toolCall = responseMessage.tool_calls[0];
        const args = JSON.parse(toolCall.function.arguments);
        const plan = args.steps || [];

        console.log(`✅ 计划已生成:`);
        plan.forEach((step: string, i: number) => console.log(`  ${i + 1}. ${step}`));
        return plan;
      } else {
        console.log("❌ 模型未返回计划工具调用");
        return [];
      }
    } catch (e: any) {
      console.error(`❌ 生成计划时发生错误: ${e.message}`);
      return [];
    }
  }
}

class Executor {
  public llmClient: HelloAgentsLLM;
  public systemPrompt: string;
  public toolRegistry: ToolRegistry | null;
  public enableToolCalling: boolean;
  public maxToolIterations: number;

  constructor(
    llmClient: HelloAgentsLLM,
    systemPrompt: string | null = null,
    toolRegistry: ToolRegistry | null = null,
    enableToolCalling: boolean = true,
    maxToolIterations: number = 3
  ) {
    this.llmClient = llmClient;
    this.systemPrompt = systemPrompt || `你是一位顶级的AI执行专家。你的任务是严格按照给定的计划，一步步地解决问题。
请专注于解决当前步骤，并输出该步骤的最终答案。`;
    this.toolRegistry = toolRegistry;
    this.enableToolCalling = enableToolCalling && toolRegistry !== null;
    this.maxToolIterations = maxToolIterations;
  }

  async execute(question: string, plan: string[], options: Record<string, any> = {}): Promise<string> {
    const history: { step: string; result: string }[] = [];
    let finalAnswer = "";

    console.log("\n--- 正在执行计划 ---");
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      console.log(`\n-> 正在执行步骤 ${i + 1}/${plan.length}: ${step}`);

      const context = `# 原始问题:
${question}

# 完整计划:
${this._formatPlan(plan)}

# 历史步骤与结果:
${history.length > 0 ? this._formatHistory(history) : "无"}

# 当前步骤:
${step}

请执行当前步骤并给出结果。`;

      const responseText = await this._executeStep(context, options);
      history.push({ step, result: responseText });
      finalAnswer = responseText;
      console.log(`✅ 步骤 ${i + 1} 已完成，结果: ${finalAnswer}`);
    }

    return finalAnswer;
  }

  private _formatPlan(plan: string[]): string {
    return plan.map((step, i) => `${i + 1}. ${step}`).join("\n");
  }

  private _formatHistory(history: { step: string; result: string }[]): string {
    return history.map((h, i) => `步骤 ${i + 1}: ${h.step}\n结果: ${h.result}`).join("\n\n");
  }

  private async _executeStep(context: string, options: Record<string, any>): Promise<string> {
    const messages: any[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: context }
    ];

    if (!this.enableToolCalling || !this.toolRegistry) {
      const response = await this.llmClient.ainvoke(messages, options);
      return response.content;
    }

    // Reuse SimpleAgent tool calling logic
    const tempAgent = new SimpleAgent("temp_executor", this.llmClient, null, null, this.toolRegistry);
    const toolSchemas = tempAgent._buildToolSchemas();

    let currentIteration = 0;
    while (currentIteration < this.maxToolIterations) {
      currentIteration++;
      try {
        const response = await this.llmClient.ainvokeWithTools(messages, toolSchemas, "auto", options);
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

          const result = await tempAgent._executeToolCall(toolName, args);
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

    const response = await this.llmClient.ainvoke(messages, options);
    return response.content;
  }
}

export class PlanSolveAgent extends Agent {
  public planner: Planner;
  public executor: Executor;

  constructor(
    name: string,
    llm: HelloAgentsLLM,
    systemPrompt: string | null = null,
    config: Config | null = null,
    plannerPrompt: string | null = null,
    executorPrompt: string | null = null,
    toolRegistry: ToolRegistry | null = null,
    enableToolCalling: boolean = true,
    maxToolIterations: number = 3
  ) {
    super(name, llm, systemPrompt, config, toolRegistry);
    this.planner = new Planner(this.llm, plannerPrompt);
    this.executor = new Executor(this.llm, executorPrompt, toolRegistry, enableToolCalling, maxToolIterations);
  }

  async run(inputText: string, options: Record<string, any> = {}): Promise<string> {
    console.log(`\n🤖 ${this.name} 开始处理问题: ${inputText}`);
    
    const plan = await this.planner.plan(inputText, options);
    if (!plan || plan.length === 0) {
      const finalAnswer = "无法生成有效的行动计划，任务终止。";
      this.addMessage(new Message(inputText, "user"));
      this.addMessage(new Message(finalAnswer, "assistant"));
      return finalAnswer;
    }

    const finalAnswer = await this.executor.execute(inputText, plan, options);
    this.addMessage(new Message(inputText, "user"));
    this.addMessage(new Message(finalAnswer, "assistant"));
    return finalAnswer;
  }

  async *arunStream(
    inputText: string,
    options: Record<string, any> = {}
  ): AsyncGenerator<StreamEvent, void, unknown> {
    yield StreamEvent.create(StreamEventType.AGENT_START, this.name, { input_text: inputText });

    try {
      // 阶段 1：规划
      yield StreamEvent.create(StreamEventType.STEP_START, this.name, {
        phase: "planning",
        description: "生成执行计划"
      });

      const plan = await this.planner.plan(inputText, options);
      if (!plan || plan.length === 0) {
        const errorMsg = "无法生成有效的行动计划，任务终止。";
        yield StreamEvent.create(StreamEventType.ERROR, this.name, { error: errorMsg, phase: "planning" });
        yield StreamEvent.create(StreamEventType.AGENT_FINISH, this.name, { result: errorMsg });
        return;
      }

      yield StreamEvent.create(StreamEventType.STEP_FINISH, this.name, {
        phase: "planning",
        plan: plan,
        total_steps: plan.length
      });

      // 阶段 2：执行
      const stepResults: string[] = [];
      for (let i = 0; i < plan.length; i++) {
        const stepDescription = plan[i];
        const stepNum = i + 1;

        yield StreamEvent.create(StreamEventType.STEP_START, this.name, {
          phase: "execution",
          step: stepNum,
          total_steps: plan.length,
          description: stepDescription
        });

        const prompt = `原始问题: ${inputText}\n\n计划:\n${plan.map((s, j) => `${j + 1}. ${s}`).join("\n")}\n\n当前步骤: ${stepDescription}`;
        let stepResult = "";
        for await (const chunk of this.llm.astreamInvoke([{ role: "user", content: prompt }], options)) {
          stepResult += chunk;
          yield StreamEvent.create(StreamEventType.LLM_CHUNK, this.name, {
            chunk,
            phase: "execution",
            step: stepNum
          });
        }
        stepResults.push(stepResult);
        yield StreamEvent.create(StreamEventType.STEP_FINISH, this.name, {
          phase: "execution",
          step: stepNum,
          result: stepResult
        });
      }

      // Final Answer
      yield StreamEvent.create(StreamEventType.STEP_START, this.name, {
        phase: "final_answer",
        description: "生成最终答案"
      });

      const finalPrompt = `原始问题: ${inputText}\n\n执行结果:\n${plan.map((s, i) => `${i + 1}. ${s} -> ${stepResults[i]}`).join("\n")}\n\n请给出最终答案。`;
      let finalAnswer = "";
      for await (const chunk of this.llm.astreamInvoke([{ role: "user", content: finalPrompt }], options)) {
        finalAnswer += chunk;
        yield StreamEvent.create(StreamEventType.LLM_CHUNK, this.name, {
          chunk,
          phase: "final_answer"
        });
      }

      yield StreamEvent.create(StreamEventType.AGENT_FINISH, this.name, {
        result: finalAnswer,
        total_steps: plan.length
      });

      this.addMessage(new Message(inputText, "user"));
      this.addMessage(new Message(finalAnswer, "assistant"));

    } catch (e: any) {
      yield StreamEvent.create(StreamEventType.ERROR, this.name, {
        error: e.message,
        error_type: e.constructor.name
      });
      throw e;
    }
  }
}
