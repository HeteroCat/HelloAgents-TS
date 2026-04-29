/**
 * HelloAgents TypeScript - 所有 Agent 类型
 *
 * 演示四种 Agent 范式对比：
 * 1. SimpleAgent    - 简单对话 + Function Calling
 * 2. ReActAgent     - 推理 + 行动循环
 * 3. ReflectionAgent - 执行 → 反思 → 优化循环
 * 4. PlanSolveAgent - 先规划、后执行
 *
 * 运行方式:
 *   npx ts-node examples/04-all-agents.ts
 */

import {
  SimpleAgent,
  ReActAgent,
  ReflectionAgent,
  PlanSolveAgent,
  HelloAgentsLLM,
  createAgent,
} from '../src';

async function main() {
  const llm = new HelloAgentsLLM();
  const question = "请解释什么是微服务架构，以及它的优缺点";

  // --- 1. SimpleAgent ---
  console.log("=" .repeat(60));
  console.log("1. SimpleAgent - 直接回答");
  console.log("=" .repeat(60));

  const simple = new SimpleAgent("simple", llm);
  const r1 = await simple.run(question);
  console.log(`回复: ${r1.substring(0, 200)}...\n`);

  // --- 2. ReflectionAgent ---
  console.log("=" .repeat(60));
  console.log("2. ReflectionAgent - 自我反思优化");
  console.log("=" .repeat(60));

  const reflector = new ReflectionAgent("reflector", llm, null, null, 2);
  const r2 = await reflector.run(question);
  console.log(`回复: ${r2.substring(0, 200)}...\n`);

  // --- 3. PlanSolveAgent ---
  console.log("=".repeat(60));
  console.log("3. PlanSolveAgent - 规划后执行");
  console.log("=".repeat(60));

  const planner = new PlanSolveAgent("planner", llm);
  const r3 = await planner.run(question);
  console.log(`回复: ${r3.substring(0, 200)}...\n`);

  // --- 4. 使用工厂函数 ---
  console.log("=" .repeat(60));
  console.log("4. 使用 createAgent 工厂函数");
  console.log("=" .repeat(60));

  const agent = createAgent("simple", "factory-agent", llm);
  const r4 = await agent.run("你好，简单介绍一下你自己");
  console.log(`回复: ${r4}\n`);
}

main().catch(console.error);
