/**
 * Unified LLM response interface
 *
 * Includes response content, reasoning process (thinking model), token usage stats, latency, etc.
 */
export interface LLMResponse {
  /** Reply content */
  content: string;

  /** Name of the model actually used */
  model: string;

  /** Token usage statistics: {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150} */
  usage: Record<string, number>;

  /** Call latency (milliseconds) */
  latencyMs: number;

  /** Reasoning process (only thinking models like o1, deepseek-reasoner have this field) */
  reasoningContent?: string | null;
}

/**
 * Streaming call stats
 */
export interface StreamStats {
  /** Name of the model actually used */
  model: string;

  /** Token usage statistics */
  usage: Record<string, number>;

  /** Call latency (milliseconds) */
  latencyMs: number;

  /** Reasoning process (only thinking models) */
  reasoningContent?: string | null;
}

/**
 * Convert LLMResponse to string (returns content)
 */
export function llmResponseToString(response: LLMResponse): string {
  return response.content;
}

/**
 * Convert LLMResponse to dictionary for logging
 */
export function llmResponseToDict(response: LLMResponse): Record<string, any> {
  const result: Record<string, any> = {
    content: response.content,
    model: response.model,
    usage: response.usage,
    latencyMs: response.latencyMs,
  };
  if (response.reasoningContent) {
    result.reasoningContent = response.reasoningContent;
  }
  return result;
}

/**
 * Convert StreamStats to dictionary
 */
export function streamStatsToDict(stats: StreamStats): Record<string, any> {
  const result: Record<string, any> = {
    model: stats.model,
    usage: stats.usage,
    latencyMs: stats.latencyMs,
  };
  if (stats.reasoningContent) {
    result.reasoningContent = stats.reasoningContent;
  }
  return result;
}
