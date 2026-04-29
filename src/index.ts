/**
 * HelloAgents - Flexible, extensible multi-agent framework
 *
 * Built on OpenAI native API, providing a clean and efficient agent development experience.
 * TypeScript version of the HelloAgents-OS framework.
 */

// Core components
export {
  HelloAgentsLLM,
  Config,
  Message,
  HelloAgentsException,
  LLMException,
  AgentException,
  ConfigException,
  ToolException,
  Agent,
} from './core';

export type {
  MessageRole,
  LLMResponse,
  StreamStats,
} from './core';

// Lifecycle & streaming
export {
  EventType,
  AgentEvent,
  ExecutionContext,
  StreamEventType,
  StreamEvent,
  StreamBuffer,
  SessionStore,
} from './core';

export type { LifecycleHook } from './core';

// Agent implementations
export {
  SimpleAgent,
  ReActAgent,
  ReflectionAgent,
  PlanSolveAgent,
  createAgent,
  defaultSubagentFactory,
} from './agents';

// Tool system
export {
  Tool,
  ToolRegistry,
  ToolResponse,
  ToolStatus,
  ToolErrorCode,
  CircuitBreaker,
  globalRegistry,
} from './tools';

export type { ToolParameter } from './tools';

// Tool filters
export {
  ToolFilter,
  ReadOnlyFilter,
  FullAccessFilter,
  CustomFilter,
} from './tools';

// Builtin tools
export {
  CalculatorTool,
  ReadTool,
  WriteTool,
  EditTool,
  MultiEditTool,
  TodoWriteTool,
  DevLogTool,
  TaskTool,
  SkillTool,
} from './tools/builtin';

// Context engineering
export {
  HistoryManager,
  TokenCounter,
  ObservationTruncator,
  ContextBuilder,
} from './context';

// Observability
export { TraceLogger } from './observability';

// Skills
export { SkillLoader } from './skills';
export type { Skill } from './skills';
