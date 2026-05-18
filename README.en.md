# hello-agents-ts

TypeScript version of HelloAgents: a lightweight multi-agent framework with a unified LLM client, agent patterns, tool calling, context engineering, session persistence, and execution traces.

This package is a TypeScript port of the Python [HelloAgents](https://github.com/jjyaoao/HelloAgents) project. The current release is focused on a usable CommonJS SDK for Node.js projects.

## Status

Implemented and verified:

- CommonJS package entry: `import { ... } from "hello-agents-ts"`
- OpenAI-compatible LLM adapter
- Four agent patterns: `SimpleAgent`, `ReActAgent`, `ReflectionAgent`, `PlanSolveAgent`
- Tool system with `Tool`, `ToolRegistry`, `ToolResponse`, circuit breaker, and tool filters
- Built-in tools: calculator, file tools, task delegation, todo, devlog, skill loading
- Context components: history manager, token counter, observation truncator, context builder
- Session persistence and trace logging
- Build, smoke tests, example typechecks, and package-consumption verification

Known limitations:

- `AnthropicAdapter` and `GeminiAdapter` are present as placeholders, but are not feature-complete.
- Test coverage is still lighter than the Python version.
- The SDK is currently CommonJS-first. ESM dual publishing is not enabled yet.

## Installation

```bash
npm install hello-agents-ts
```

For local development from this repository:

```bash
cd hello-agents-ts
npm install
npm run build
```

## Environment

Create a `.env` file or set these environment variables:

```env
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL_ID=gpt-4o
LLM_TIMEOUT=60
```

`LLM_BASE_URL` can point to any OpenAI-compatible endpoint, such as OpenAI, DeepSeek, Qwen-compatible gateways, Kimi-compatible gateways, or local OpenAI-compatible services.

## Quick Start

```ts
import { HelloAgentsLLM, SimpleAgent } from "hello-agents-ts";

async function main() {
  const llm = new HelloAgentsLLM();
  const agent = new SimpleAgent(
    "assistant",
    llm,
    "You are a concise and helpful assistant."
  );

  const reply = await agent.run("Explain TypeScript in one sentence.");
  console.log(reply);
}

main().catch(console.error);
```

## Custom Tools

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
  description = "Get weather for a city.";

  getParameters(): ToolParameter[] {
    return [
      {
        name: "city",
        type: "string",
        description: "City name",
        required: true,
      },
    ];
  }

  run(params: Record<string, any>): ToolResponse {
    return ToolResponse.success(`${params.city}: sunny, 25C`);
  }
}

async function main() {
  const llm = new HelloAgentsLLM();
  const tools = new ToolRegistry();
  tools.registerTool(new WeatherTool());

  const agent = new SimpleAgent(
    "tool-agent",
    llm,
    "Use tools when useful.",
    null,
    tools,
    true
  );

  const reply = await agent.run("What is the weather in Beijing?");
  console.log(reply);
}

main().catch(console.error);
```

## Agent Patterns

| Agent | Pattern | Typical Use |
|---|---|---|
| `SimpleAgent` | Single-pass response with optional tool calling | Chat, simple assistants, direct tool use |
| `ReActAgent` | Thought -> Action -> Observation loop | Multi-step reasoning and tool workflows |
| `ReflectionAgent` | Generate -> critique -> refine | Higher-quality writing or analysis |
| `PlanSolveAgent` | Plan first, then execute steps | Complex task decomposition |

Example:

```ts
import { HelloAgentsLLM, ReActAgent, ToolRegistry } from "hello-agents-ts";

const llm = new HelloAgentsLLM();
const tools = new ToolRegistry();
const agent = new ReActAgent("react", llm, tools, null, null, 10);

const result = await agent.run("Analyze this problem step by step.");
console.log(result);
```

## Core Exports

The package root is the public API:

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

Avoid importing from internal `src/` or `dist/` paths in application code.

## Examples

The repository includes runnable TypeScript examples:

```bash
npx ts-node examples/01-quickstart.ts
npx ts-node examples/02-custom-tools.ts
npx ts-node examples/03-react-agent.ts
npx ts-node examples/04-all-agents.ts
npx ts-node examples/05-context-engineering.ts
```

These examples use the package name import (`hello-agents-ts`). Local typechecking maps that package name to `src/index.ts` through `tsconfig.examples.json`.

## Verification

```bash
npm run build
npm test
npm run typecheck:examples
npm run test:package
npm run pack:dry-run
```

What these commands verify:

- `npm run build`: compiles TypeScript into `dist/`
- `npm test`: builds and runs smoke tests against `dist/`
- `npm run typecheck:examples`: typechecks all examples with package-name imports
- `npm run test:package`: packs the SDK and verifies `require("hello-agents-ts")`
- `npm run pack:dry-run`: shows the final npm package contents

The package is configured to publish only:

- `dist/`
- `README.md`
- `LICENSE`
- `package.json` generated by npm packaging

## Publishing

Before publishing:

```bash
npm whoami
npm view hello-agents-ts name version
npm run prepack
npm run pack:dry-run
```

Publish:

```bash
npm publish --access public
```

After publishing:

```bash
npm view hello-agents-ts name version
```

## Python to TypeScript Mapping

| Python | TypeScript |
|---|---|
| `from hello_agents import ReActAgent` | `import { ReActAgent } from "hello-agents-ts"` |
| `agent.run("question")` | `await agent.run("question")` |
| `for chunk in agent.stream_run(...)` | `for await (const chunk of agent.streamRun(...))` |
| Pydantic models | TypeScript classes and interfaces |
| `dict` | `Record<string, any>` |
| `Iterator` / `AsyncIterator` | `Generator` / `AsyncGenerator` |

## Development Notes

- Source files live in `src/`.
- Compiled package files are generated in `dist/`.
- The root export file is `src/index.ts`.
- Package consumers should use only the root package import.
- Network-backed LLM examples require valid `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL_ID`.

## License

CC-BY-NC-SA-4.0
