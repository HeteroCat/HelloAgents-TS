import dotenv from 'dotenv';
dotenv.config();

import { HelloAgentsException } from './exceptions';
import { LLMResponse, StreamStats } from './llm-response';
import { createAdapter, BaseLLMAdapter } from './llm-adapters';

/**
 * HelloAgents unified LLM client
 */
export class HelloAgentsLLM {
  model: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  timeout: number;
  temperature: number;
  maxTokens?: number;
  kwargs: Record<string, any>;
  lastCallStats?: StreamStats;
  provider: string;
  private _adapter: BaseLLMAdapter;

  constructor(options: {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
    [key: string]: any;
  } = {}) {
    // Load config
    this.model = options.model || process.env.LLM_MODEL_ID || "";
    this.apiKey = options.apiKey || process.env.LLM_API_KEY || "";
    this.baseUrl = options.baseUrl || process.env.LLM_BASE_URL || "";
    this.timeout = options.timeout || parseInt(process.env.LLM_TIMEOUT || "60");

    this.temperature = options.temperature ?? 0.7;
    this.maxTokens = options.maxTokens;
    const { model, apiKey, baseUrl, temperature, maxTokens, timeout, ...rest } = options;
    this.kwargs = rest;

    // Validate necessary parameters
    if (!this.model) {
      throw new HelloAgentsException("Must provide model name (model parameter or LLM_MODEL_ID environment variable)");
    }
    if (!this.apiKey) {
      throw new HelloAgentsException("Must provide API key (apiKey parameter or LLM_API_KEY environment variable)");
    }
    if (!this.baseUrl) {
      throw new HelloAgentsException("Must provide service address (baseUrl parameter or LLM_BASE_URL environment variable)");
    }

    this.modelId = this.model;
    this.provider = this._detectProvider(this.baseUrl);

    // Create adapter (automatic detection)
    this._adapter = createAdapter(this.apiKey, this.baseUrl, this.timeout, this.model);
  }

  private _detectProvider(baseUrl: string): string {
    const baseUrlLower = (baseUrl || '').toLowerCase();
    if (baseUrlLower.includes('anthropic.com')) return 'anthropic';
    if (baseUrlLower.includes('googleapis.com') || baseUrlLower.includes('generativelanguage')) return 'gemini';
    return 'openai';
  }

  /**
   * Main call method, defaults to streaming
   */
  async *think(messages: any[], temperature?: number): AsyncGenerator<string> {
    console.log(`🧠 Calling ${this.model} model...`);

    const kwargs: Record<string, any> = {
      temperature: temperature ?? this.temperature,
    };
    if (this.maxTokens) {
      kwargs.max_tokens = this.maxTokens;
    }

    try {
      console.log("✅ LLM response success:");
      for await (const chunk of this._adapter.streamInvoke(messages, kwargs)) {
        process.stdout.write(chunk);
        yield chunk;
      }
      process.stdout.write("\n");

      // Save stats
      if (this._adapter.lastStats) {
        this.lastCallStats = this._adapter.lastStats;
      }
    } catch (e: any) {
      console.error(`❌ Error calling LLM API: ${e.message}`);
      throw e;
    }
  }

  /**
   * Non-streaming call
   */
  async invoke(messages: any[], kwargs: Record<string, any> = {}): Promise<LLMResponse> {
    const callKwargs: Record<string, any> = {
      temperature: kwargs.temperature ?? this.temperature,
      ...kwargs,
    };
    if (this.maxTokens && !callKwargs.max_tokens) {
      callKwargs.max_tokens = this.maxTokens;
    }

    return await this._adapter.invoke(messages, callKwargs);
  }

  /**
   * Streaming call (alias for think)
   */
  async *streamInvoke(messages: any[], kwargs: Record<string, any> = {}): AsyncGenerator<string> {
    const temperature = kwargs.temperature;
    const callKwargs: Record<string, any> = { ...kwargs };
    if (this.maxTokens && !callKwargs.max_tokens) {
      callKwargs.max_tokens = this.maxTokens;
    }

    for await (const chunk of this._adapter.streamInvoke(messages, { temperature, ...callKwargs })) {
      yield chunk;
    }

    // Save stats
    if (this._adapter.lastStats) {
      this.lastCallStats = this._adapter.lastStats;
    }
  }

  /**
   * Tool call (Function Calling)
   */
  async invokeWithTools(messages: any[], tools: any[], toolChoice: any = "auto", kwargs: Record<string, any> = {}): Promise<any> {
    const callKwargs: Record<string, any> = {
      temperature: kwargs.temperature ?? this.temperature,
      tool_choice: toolChoice,
      ...kwargs,
    };
    if (this.maxTokens && !callKwargs.max_tokens) {
      callKwargs.max_tokens = this.maxTokens;
    }

    return await this._adapter.invokeWithTools(messages, tools, callKwargs);
  }

  /**
   * Async non-streaming call (TS is naturally async)
   */
  async ainvoke(messages: any[], kwargs: Record<string, any> = {}): Promise<LLMResponse> {
    return await this.invoke(messages, kwargs);
  }

  /**
   * Async streaming call (TS is naturally async)
   */
  async *astreamInvoke(messages: any[], kwargs: Record<string, any> = {}): AsyncGenerator<string> {
    for await (const chunk of this.streamInvoke(messages, kwargs)) {
      yield chunk;
    }
  }

  /**
   * Async tool call (TS is naturally async)
   */
  async ainvokeWithTools(messages: any[], tools: any[], toolChoice: any = "auto", kwargs: Record<string, any> = {}): Promise<any> {
    return await this.invokeWithTools(messages, tools, toolChoice, kwargs);
  }
}
