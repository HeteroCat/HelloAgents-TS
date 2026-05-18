/**
 * HelloAgents TypeScript - 上下文工程
 *
 * 演示上下文管理能力：
 * 1. TokenCounter - Token 计数与缓存
 * 2. HistoryManager - 历史压缩
 * 3. ObservationTruncator - 工具输出截断
 *
 * 运行方式:
 *   npx ts-node examples/05-context-engineering.ts
 */

import {
  Message,
  TokenCounter,
  HistoryManager,
  ObservationTruncator,
} from 'hello-agents-ts';

function main() {
  // --- 1. Token 计数 ---
  console.log("=== Token 计数器 ===");
  const counter = new TokenCounter("gpt-4o");

  const text1 = "Hello, how are you?";
  const text2 = "这是一段中文文本，用来测试 Token 计数。";

  console.log(`"${text1}" → ${counter.countText(text1)} tokens`);
  console.log(`"${text2}" → ${counter.countText(text2)} tokens`);

  const messages = [
    new Message("你是一个有用的助手", "system"),
    new Message("请帮我计算 1+1", "user"),
    new Message("1+1=2", "assistant"),
  ];
  console.log(`3条消息总计: ${counter.countMessages(messages)} tokens`);
  console.log(`缓存命中统计: ${JSON.stringify(counter.getCacheStats())}`);

  // --- 2. 历史管理 ---
  console.log("\n=== 历史管理器 ===");
  const history = new HistoryManager(2, 0.7); // 保留最近2轮

  // 模拟多轮对话
  for (let i = 1; i <= 5; i++) {
    history.append(new Message(`第${i}个问题`, "user"));
    history.append(new Message(`第${i}个回答`, "assistant"));
  }

  console.log(`当前消息数: ${history.getHistory().length}`);
  console.log(`估计轮数: ${history.estimateRounds()}`);
  console.log(`轮次边界: ${JSON.stringify(history.findRoundBoundaries())}`);

  // 压缩历史
  history.compress("前3轮对话的摘要：讨论了1-3号问题。");
  console.log(`压缩后消息数: ${history.getHistory().length}`);
  console.log(`首条消息角色: ${history.getHistory()[0].role}`);
  console.log(`首条消息内容: ${history.getHistory()[0].content}`);

  // --- 3. 工具输出截断 ---
  console.log("\n=== 观测截断器 ===");
  const truncator = new ObservationTruncator(5, 1000, "tail");

  // 模拟一个很长的工具输出
  const longOutput = Array.from({ length: 100 }, (_, i) =>
    `第 ${i + 1} 行：这是工具返回的数据内容，包含重要的分析结果。`
  ).join("\n");

  const result = truncator.truncate("search_tool", longOutput);
  console.log(`原始行数: 100`);
  console.log(`是否截断: ${result.truncated}`);
  console.log(`预览内容:\n${result.preview}`);
  console.log(`完整输出路径: ${result.fullOutputPath || "(未保存)"}`);
  if (result.stats) {
    console.log(`统计: 原始${result.stats.originalLines}行 → ${result.stats.truncatedLines}行`);
  }
}

main();
