/**
 * HelloAgents configuration class
 */
export class Config {
  // LLM configuration
  defaultModel: string = "gpt-3.5-turbo";
  defaultProvider: string = "openai";
  temperature: number = 0.7;
  maxTokens?: number;

  // System configuration
  debug: boolean = false;
  logLevel: string = "INFO";

  // History management configuration (backwards compatibility)
  maxHistoryLength: number = 100;

  // Context engineering configuration
  contextWindow: number = 128000; // Context window size (tokens)
  compressionThreshold: number = 0.8; // Compression threshold (0.8 = 80% to trigger compression)
  minRetainRounds: number = 10; // Minimum complete rounds to retain when compressing
  enableSmartCompression: boolean = false; // Whether to enable smart summary (requires extra LLM call)

  // Smart summary configuration
  summaryLlmProvider: string = "deepseek"; // Dedicated LLM provider for summary
  summaryLlmModel: string = "deepseek-chat"; // Dedicated LLM model for summary
  summaryMaxTokens: number = 800; // Maximum token count for summary
  summaryTemperature: number = 0.3; // Summary generation temperature (more deterministic)

  // Tool output truncation configuration
  toolOutputMaxLines: number = 2000; // Maximum lines for tool output
  toolOutputMaxBytes: number = 51200; // Maximum bytes for tool output (50KB)
  toolOutputDir: string = "tool-output"; // Full output save directory
  toolOutputTruncateDirection: string = "head"; // Truncation direction: head/tail/head_tail

  // Observability configuration
  traceEnabled: boolean = true; // Whether to enable Trace recording
  traceDir: string = "memory/traces"; // Trace file save directory
  traceSanitize: boolean = true; // Whether to desensitize sensitive information
  traceHtmlIncludeRawResponse: boolean = false; // Whether HTML includes raw response

  // Skills configuration
  skillsEnabled: boolean = true; // Whether to enable Skills system
  skillsDir: string = "skills"; // Skills directory path
  skillsAutoRegister: boolean = true; // Whether to auto-register SkillTool

  // Circuit breaker configuration
  circuitEnabled: boolean = true; // Whether to enable circuit breaker
  circuitFailureThreshold: number = 3; // Number of consecutive failures before opening circuit
  circuitRecoveryTimeout: number = 300; // Recovery time after circuit opening (seconds)

  // Session persistence configuration
  sessionEnabled: boolean = true; // Whether to enable session persistence
  sessionDir: string = "memory/sessions"; // Session file save directory
  autoSaveEnabled: boolean = false; // Whether to enable auto-save
  autoSaveInterval: number = 10; // Auto-save interval (every N messages)

  // Subagent mechanism configuration
  subagentEnabled: boolean = true; // Whether to enable subagent mechanism
  subagentMaxSteps: number = 15; // Default max steps for subagent
  subagentUseLightLlm: boolean = false; // Whether to use light model (default off, avoid breaking existing behavior)
  subagentLightLlmProvider: string = "deepseek"; // Light model provider
  subagentLightLlmModel: string = "deepseek-chat"; // Light model name

  // TodoWrite progress management configuration
  todowriteEnabled: boolean = true; // Whether to enable TodoWrite tool
  todowritePersistenceDir: string = "memory/todos"; // Task list persistence directory

  // DevLog development log configuration
  devlogEnabled: boolean = true; // Whether to enable DevLog tool
  devlogPersistenceDir: string = "memory/devlogs"; // Development log persistence directory

  // Async lifecycle configuration
  asyncEnabled: boolean = true; // Whether to enable async execution
  maxConcurrentTools: number = 3; // Maximum concurrent tools
  hookTimeoutSeconds: number = 5.0; // Lifecycle hook timeout (seconds)
  llmAsyncTimeout: number = 120; // LLM async call timeout (seconds)
  toolAsyncTimeout: number = 30; // Tool async call timeout (seconds)

  // Streaming output configuration
  streamEnabled: boolean = true; // Whether to enable streaming output
  streamBufferSize: number = 100; // Stream buffer size
  streamIncludeThinking: boolean = true; // Whether to include thinking process
  streamIncludeToolCalls: boolean = true; // Whether to include tool calls

  constructor(partialConfig: Partial<Config> = {}) {
    Object.assign(this, partialConfig);
  }

  /**
   * Create configuration from environment variables
   */
  static fromEnv(): Config {
    return new Config({
      debug: process.env.DEBUG?.toLowerCase() === "true",
      logLevel: process.env.LOG_LEVEL || "INFO",
      temperature: process.env.TEMPERATURE ? parseFloat(process.env.TEMPERATURE) : 0.7,
      maxTokens: process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS) : undefined,
    });
  }

  /**
   * Convert to dictionary
   */
  toDict(): Record<string, any> {
    return { ...this };
  }
}
