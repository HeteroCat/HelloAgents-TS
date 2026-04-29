# HelloAgents TypeScript

> TypeScript 版本的多智能体框架，移植自 [HelloAgents-OS](https://github.com/HeteroCat/HelloAgents-OS) Python 版。

## 安装

```bash
cd hello-agents-ts
npm install
npm run build
```

## 环境配置

创建 `.env` 文件：

```env
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL_ID=gpt-4o
```

当前**已完整实现并验证**的是 **OpenAI 兼容接口**。`AnthropicAdapter` / `GeminiAdapter` 的入口已保留，但尚未达到与 Python 原版同等的实现深度。

## 快速上手

### 最简示例

```ts
import { SimpleAgent, HelloAgentsLLM } from './src';

const llm = new HelloAgentsLLM();
const agent = new SimpleAgent('assistant', llm, '你是一个有用的 AI 助手');

const reply = await agent.run('你好');
console.log(reply);
```

### 带工具的 Agent

```ts
import {
  SimpleAgent,
  HelloAgentsLLM,
  Tool,
  ToolParameter,
  ToolResponse,
  ToolRegistry,
} from './src';

class WeatherTool extends Tool {
  name = 'get_weather';
  description = '查询天气';

  getParameters(): ToolParameter[] {
    return [{ name: 'city', type: 'string', description: '城市', required: true }];
  }

  run(params: Record<string, any>): ToolResponse {
    return ToolResponse.success(`${params.city}: 晴天 25°C`);
  }
}

const llm = new HelloAgentsLLM();
const registry = new ToolRegistry();
registry.registerTool(new WeatherTool());

const agent = new SimpleAgent('assistant', llm, null, null, registry);
const reply = await agent.run('北京天气怎么样？');
console.log(reply);
```

### ReAct Agent

```ts
import { ReActAgent, HelloAgentsLLM, ToolRegistry } from './src';

const llm = new HelloAgentsLLM();
const registry = new ToolRegistry();

const agent = new ReActAgent('react', llm, registry, null, null, 10);
const result = await agent.run('帮我分析这个问题');
console.log(result);
```

### 流式输出

```ts
const agent = new SimpleAgent('assistant', llm);
for await (const chunk of agent.streamRun('讲个故事')) {
  process.stdout.write(chunk);
}
```

## 四种 Agent 范式

| Agent | 描述 | 适用场景 |
|---|---|---|
| `SimpleAgent` | 直接对话 + Function Calling | 简单问答、工具调用 |
| `ReActAgent` | Thought -> Action -> Observation 循环 | 多步推理任务 |
| `ReflectionAgent` | 执行 -> 反思 -> 优化迭代 | 需要质量提升的内容生成 |
| `PlanSolveAgent` | 先规划、再执行 | 复杂多步骤任务 |

## 核心能力

### 工具系统
- `Tool`：工具基类
- `ToolRegistry`：工具注册与执行
- `ToolResponse`：标准响应协议（SUCCESS / PARTIAL / ERROR）
- `CircuitBreaker`：工具熔断器
- `ToolFilter`：工具权限过滤

### 上下文工程
- `HistoryManager`：历史消息管理与压缩
- `TokenCounter`：Token 计数
- `ObservationTruncator`：工具输出截断
- `ContextBuilder`：GSSC 上下文构建

### 其他能力
- `SessionStore`：会话保存与恢复
- `TraceLogger`：JSONL + HTML 执行追踪
- `TaskTool`：子代理任务委托
- `SkillLoader` / `SkillTool`：技能系统

## 示例

```bash
npx ts-node examples/01-quickstart.ts
npx ts-node examples/02-custom-tools.ts
npx ts-node examples/03-react-agent.ts
npx ts-node examples/04-all-agents.ts
npx ts-node examples/05-context-engineering.ts
```

## 验证

```bash
npm run build
npm run typecheck:examples
npm test
```

当前已经加入：
- 主源码编译验证
- 示例类型检查
- 基础 smoke tests

## 当前完成度说明

### 已完成
- Python 原版主要目录结构已迁移：`core`、`agents`、`tools`、`context`、`observability`、`skills`
- 四种 Agent 范式已提供 TypeScript 实现
- OpenAI 兼容 LLM 调用链已完成并通过构建验证
- 内置工具、上下文工程、会话持久化、TraceLogger 已迁移
- 提供 5 个 TypeScript 示例
- 提供基础 smoke tests 与示例类型检查脚本

### 尚未与 Python 原版完全等价的部分
- `AnthropicAdapter` 与 `GeminiAdapter` 仍是占位实现，不属于完全重构完成
- 尚未补齐 Python 原版对应的系统化自动化测试覆盖
- 原版若干高级能力虽然已有源码迁移，但端到端验证仍不足

因此，更准确的描述是：

> **`hello-agents-ts` 已完成高覆盖率、可构建、可运行的 TypeScript 移植，但尚未达到“对 Python 原版进行了彻底且完全等价重构”的标准。**

## 目录结构

```text
hello-agents-ts/
├── src/
│   ├── core/
│   ├── agents/
│   ├── tools/
│   │   └── builtin/
│   ├── context/
│   ├── observability/
│   ├── skills/
│   └── index.ts
├── examples/
├── tests/
├── package.json
└── tsconfig.json
```

## Python -> TypeScript 映射

| Python | TypeScript |
|---|---|
| `from hello_agents import ReActAgent` | `import { ReActAgent } from './src'` |
| `agent.run("问题")` | `await agent.run("问题")` |
| `for chunk in agent.stream_run(...)` | `for await (const chunk of agent.streamRun(...))` |
| Pydantic `BaseModel` | Plain TS class / interface |
| `@abstractmethod` | `abstract` keyword |
| `dict` | `Record<string, any>` |
| `Iterator` / `AsyncIterator` | `Generator` / `AsyncGenerator` |

## License

CC-BY-NC-SA-4.0
