/**
 * HelloAgents TypeScript - 快速开始
 *
 * 演示最基本的 Agent 使用方式：
 * 1. 初始化 LLM 客户端
 * 2. 创建 SimpleAgent
 * 3. 发送消息并获取回复
 *
 * 运行方式:
 *   npx ts-node examples/01-quickstart.ts
 *
 * 环境变量（.env）:
 *   LLM_API_KEY=your-api-key
 *   LLM_BASE_URL=https://api.openai.com/v1  (可选)
 *   LLM_MODEL_ID=gpt-4o                     (可选)
 */

import { SimpleAgent, HelloAgentsLLM } from '../src';

async function main() {
  // 1. 初始化 LLM（自动从环境变量读取配置）
  const llm = new HelloAgentsLLM();

  // 2. 创建 Agent
  const agent = new SimpleAgent(
    "my-assistant",  // Agent 名称
    llm,             // LLM 客户端
    "你是一个友好的AI助手，请用简洁的中文回答问题。" // 系统提示词
  );

  // 3. 单轮对话
  console.log("=== 单轮对话 ===");
  const response = await agent.run("请用一句话介绍TypeScript");
  console.log(`回复: ${response}\n`);

  // 4. 多轮对话（Agent 自动维护历史）
  console.log("=== 多轮对话 ===");
  const r1 = await agent.run("我叫小明");
  console.log(`回复1: ${r1}`);

  const r2 = await agent.run("我叫什么名字？");
  console.log(`回复2: ${r2}`);

  // 5. 流式输出
  console.log("\n=== 流式输出 ===");
  process.stdout.write("回复: ");
  for await (const chunk of agent.streamRun("用三句话介绍Node.js")) {
    process.stdout.write(chunk);
  }
  console.log("\n");
}

main().catch(console.error);
