/**
 * HelloAgents TypeScript - ReAct Agent
 *
 * 演示 ReAct (Reasoning + Acting) 模式：
 * - 使用 Thought 工具进行推理
 * - 调用业务工具获取信息
 * - 使用 Finish 工具输出最终答案
 *
 * 运行方式:
 *   npx ts-node examples/03-react-agent.ts
 */

import {
  ReActAgent,
  HelloAgentsLLM,
  Tool,
  ToolParameter,
  ToolResponse,
  ToolRegistry,
} from '../src';

// --- 模拟搜索工具 ---
class SearchTool extends Tool {
  name = "search";
  description = "搜索互联网获取信息";

  getParameters(): ToolParameter[] {
    return [
      { name: "query", type: "string", description: "搜索关键词", required: true },
    ];
  }

  run(params: Record<string, any>): ToolResponse {
    const query = params.query || "";
    const mockResults: Record<string, string> = {
      "TypeScript": "TypeScript 是由微软开发的开源编程语言，是 JavaScript 的超集，于2012年首次发布。最新版本 5.x 支持装饰器、satisfies 操作符等新特性。",
      "Node.js": "Node.js 是基于 Chrome V8 引擎的 JavaScript 运行时，于2009年由 Ryan Dahl 创建。最新 LTS 版本为 v20。",
    };

    for (const [key, result] of Object.entries(mockResults)) {
      if (query.toLowerCase().includes(key.toLowerCase())) {
        return ToolResponse.success(result);
      }
    }
    return ToolResponse.success(`关于"${query}"的搜索结果：这是一个广泛的话题，有多种相关资料。`);
  }
}

// --- 模拟计算工具 ---
class MathTool extends Tool {
  name = "calculate";
  description = "执行数学计算";

  getParameters(): ToolParameter[] {
    return [
      { name: "expression", type: "string", description: "数学表达式", required: true },
    ];
  }

  run(params: Record<string, any>): ToolResponse {
    try {
      const expr = params.expression || "";
      // Simple safe evaluation for basic math
      const result = Function(`"use strict"; return (${expr.replace(/[^0-9+\-*/().%\s]/g, '')})`)();
      return ToolResponse.success(`${expr} = ${result}`, { expression: expr, result });
    } catch {
      return ToolResponse.error("EXECUTION_ERROR", "无法计算该表达式");
    }
  }
}

async function main() {
  const llm = new HelloAgentsLLM();

  // 创建工具注册表
  const registry = new ToolRegistry();
  registry.registerTool(new SearchTool());
  registry.registerTool(new MathTool());

  // 创建 ReAct Agent
  const agent = new ReActAgent(
    "react-assistant",
    llm,
    registry,        // toolRegistry
    null,            // systemPrompt (uses default ReAct prompt)
    null,            // config
    10               // maxSteps
  );

  // 运行一个需要推理的任务
  console.log("=== ReAct Agent 示例 ===\n");
  const result = await agent.run("TypeScript 是什么时候发布的？到现在已经多少年了？");
  console.log(`\n最终结果: ${result}`);

  // 使用生命周期钩子的异步版本
  console.log("\n\n=== 带生命周期钩子 ===\n");
  const result2 = await agent.arun(
    "Node.js 是谁创建的？",
    {
      onStart: async (event) => {
        console.log(`🚀 Agent 启动: ${JSON.stringify(event.data)}`);
      },
      onStep: async (event) => {
        console.log(`📍 步骤事件: ${JSON.stringify(event.data)}`);
      },
      onFinish: async (event) => {
        console.log(`✅ Agent 完成: ${JSON.stringify(event.data)}`);
      },
    }
  );
  console.log(`\n最终结果: ${result2}`);
}

main().catch(console.error);
