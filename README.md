# hello-agents-ts

HelloAgents 的 TypeScript 版本：一个轻量级多智能体框架，提供统一 LLM 客户端、常见 Agent 范式、工具调用、上下文工程、会话持久化和执行追踪能力。

本包移植自 Python 项目 [HelloAgents](https://github.com/jjyaoao/HelloAgents)。当前版本优先提供一个可安装、可导入、可验证的 Node.js CommonJS SDK。

English documentation: [README.en.md](./README.en.md)

## 当前状态

已经实现并验证：

- CommonJS 包入口：`import { ... } from "hello-agents-ts"`
- OpenAI 兼容 LLM 适配器
- 四种 Agent 范式：`SimpleAgent`、`ReActAgent`、`ReflectionAgent`、`PlanSolveAgent`
- 工具系统：`Tool`、`ToolRegistry`、`ToolResponse`、熔断器和工具过滤器
- 内置工具：计算器、文件工具、子任务委托、todo、devlog、技能加载
- 上下文组件：历史管理、Token 计数、工具输出截断、上下文构建
- 会话持久化和执行追踪
- 构建、smoke tests、示例类型检查、打包后消费验证

已知限制：

- `AnthropicAdapter` 和 `GeminiAdapter` 目前仍是占位实现，尚未达到完整可用状态。
- 自动化测试覆盖还没有 Python 版本系统化。
- 当前 SDK 以 CommonJS 为主，尚未启用 ESM 双格式发布。

## 安装

```bash
npm install hello-agents-ts
```

如果是在本仓库内本地开发：

```bash
cd hello-agents-ts
npm install
npm run build
```

## 环境变量

创建 `.env` 文件，或在 shell 中设置以下环境变量：

```env
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL_ID=gpt-4o
LLM_TIMEOUT=60
```

`LLM_BASE_URL` 可以指向任意 OpenAI 兼容接口，例如 OpenAI、DeepSeek、Qwen 兼容网关、Kimi 兼容网关，或本地 OpenAI 兼容服务。

## 快速开始

```ts
import { HelloAgentsLLM, SimpleAgent } from "hello-agents-ts";

async function main() {
  const llm = new HelloAgentsLLM();
  const agent = new SimpleAgent(
    "assistant",
    llm,
    "你是一个回答简洁、可靠的 AI 助手。"
  );

  const reply = await agent.run("用一句话解释 TypeScript。");
  console.log(reply);
}

main().catch(console.error);
```

## 自定义工具

```ts
import {
  HelloAgentsLLM,
  SimpleAgent,
  Tool,
  ToolParameter,
  ToolRegistry,
  ToolResponse,
} from "hello-agents-ts";

class WeatherTool extends Tool {
  name = "get_weather";
  description = "查询指定城市的天气。";

  getParameters(): ToolParameter[] {
    return [
      {
        name: "city",
        type: "string",
        description: "城市名称",
        required: true,
      },
    ];
  }

  run(params: Record<string, any>): ToolResponse {
    return ToolResponse.success(`${params.city}: 晴天，25C`);
  }
}

async function main() {
  const llm = new HelloAgentsLLM();
  const tools = new ToolRegistry();
  tools.registerTool(new WeatherTool());

  const agent = new SimpleAgent(
    "tool-agent",
    llm,
    "在有帮助时使用工具。",
    null,
    tools,
    true
  );

  const reply = await agent.run("北京天气怎么样？");
  console.log(reply);
}

main().catch(console.error);
```

## Agent 范式

| Agent | 模式 | 适用场景 |
|---|---|---|
| `SimpleAgent` | 单轮响应，可选工具调用 | 对话、简单助手、直接工具使用 |
| `ReActAgent` | Thought -> Action -> Observation 循环 | 多步推理和工具工作流 |
| `ReflectionAgent` | 生成 -> 反思 -> 优化 | 写作、分析、需要质量提升的生成任务 |
| `PlanSolveAgent` | 先规划，再逐步执行 | 复杂任务拆解 |

示例：

```ts
import { HelloAgentsLLM, ReActAgent, ToolRegistry } from "hello-agents-ts";

const llm = new HelloAgentsLLM();
const tools = new ToolRegistry();
const agent = new ReActAgent("react", llm, tools, null, null, 10);

const result = await agent.run("请一步步分析这个问题。");
console.log(result);
```

## 核心导出

包根入口就是公开 API：

```ts
import {
  HelloAgentsLLM,
  Config,
  Message,
  SimpleAgent,
  ReActAgent,
  ReflectionAgent,
  PlanSolveAgent,
  Tool,
  ToolRegistry,
  ToolResponse,
  HistoryManager,
  TokenCounter,
  ObservationTruncator,
  SessionStore,
  TraceLogger,
  SkillLoader,
} from "hello-agents-ts";
```

应用代码不要从内部 `src/` 或 `dist/` 路径导入。

## 示例

仓库内提供了可运行的 TypeScript 示例：

```bash
npx ts-node examples/01-quickstart.ts
npx ts-node examples/02-custom-tools.ts
npx ts-node examples/03-react-agent.ts
npx ts-node examples/04-all-agents.ts
npx ts-node examples/05-context-engineering.ts
```

这些示例使用包名导入：`hello-agents-ts`。本地类型检查通过 `tsconfig.examples.json` 将包名映射到 `src/index.ts`。

## 验证

```bash
npm run build
npm test
npm run typecheck:examples
npm run test:package
npm run pack:dry-run
```

这些命令分别验证：

- `npm run build`：将 TypeScript 编译到 `dist/`
- `npm test`：构建并针对 `dist/` 运行 smoke tests
- `npm run typecheck:examples`：使用包名导入对所有示例做类型检查
- `npm run test:package`：打包 SDK，并验证 `require("hello-agents-ts")`
- `npm run pack:dry-run`：检查最终 npm 包内容

当前发布包只包含：

- `dist/`
- `README.md`
- `LICENSE`
- npm 打包时生成的 `package.json`

## 发布

发布前检查：

```bash
npm whoami
npm view hello-agents-ts name version
npm run prepack
npm run pack:dry-run
```

发布：

```bash
npm publish --access public
```

发布后确认：

```bash
npm view hello-agents-ts name version
```

## Python 到 TypeScript 映射

| Python | TypeScript |
|---|---|
| `from hello_agents import ReActAgent` | `import { ReActAgent } from "hello-agents-ts"` |
| `agent.run("问题")` | `await agent.run("问题")` |
| `for chunk in agent.stream_run(...)` | `for await (const chunk of agent.streamRun(...))` |
| Pydantic 模型 | TypeScript class / interface |
| `dict` | `Record<string, any>` |
| `Iterator` / `AsyncIterator` | `Generator` / `AsyncGenerator` |

## 开发说明

- 源码位于 `src/`。
- 编译产物生成到 `dist/`。
- 根导出文件是 `src/index.ts`。
- 包使用者应只使用根包导入。
- 需要真实 LLM 的示例必须提供有效的 `LLM_API_KEY`、`LLM_BASE_URL` 和 `LLM_MODEL_ID`。

## License

CC-BY-NC-SA-4.0
