import { LLMResponse, StreamStats } from './llm-response';
import { HelloAgentsException } from './exceptions';
import OpenAI from 'openai';

/**
 * Base LLM adapter abstract class
 */
export abstract class BaseLLMAdapter {
  apiKey: string;
  baseUrl?: string;
  timeout: number;
  model: string;
  lastStats?: StreamStats;

  constructor(apiKey: string, baseUrl: string | undefined, timeout: number, model: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeout = timeout;
    this.model = model;
  }

  /**
   * Create client instance
   */
  abstract createClient(): any;

  /**
   * Non-streaming call
   */
  abstract invoke(messages: any[], kwargs?: Record<string, any>): Promise<LLMResponse>;

  /**
   * Streaming call, returns generator
   */
  abstract streamInvoke(messages: any[], kwargs?: Record<string, any>): AsyncGenerator<string>;

  /**
   * Tool call (Function Calling)
   */
  abstract invokeWithTools(messages: any[], tools: any[], kwargs?: Record<string, any>): Promise<any>;

  /**
   * Determine if it is a thinking model
   */
  protected _isThinkingModel(modelName: string): boolean {
    const thinkingKeywords = ["reasoner", "o1", "o3", "thinking"];
    const modelLower = modelName.toLowerCase();
    return thinkingKeywords.some(keyword => modelLower.includes(keyword));
  }
}

/**
 * OpenAI compatible interface adapter (default)
 */
export class OpenAIAdapter extends BaseLLMAdapter {
  private _client: OpenAI | null = null;

  createClient(): OpenAI {
    return new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
      timeout: this.timeout * 1000, // OpenAI SDK uses ms
    });
  }

  private get client(): OpenAI {
    if (!this._client) {
      this._client = this.createClient();
    }
    return this._client;
  }

  async invoke(messages: any[], kwargs: Record<string, any> = {}): Promise<LLMResponse> {
    const startTime = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages,
        ...kwargs
      });

      const latencyMs = Date.now() - startTime;
      const choice = response.choices[0];
      const content = choice.message.content || "";
      let reasoningContent: string | null = null;

      if (this._isThinkingModel(this.model)) {
        if ((choice.message as any).reasoning_content) {
          reasoningContent = (choice.message as any).reasoning_content;
        } else if ((choice as any).reasoning_content) {
          reasoningContent = (choice as any).reasoning_content;
        }
      }

      const usage: Record<string, number> = response.usage ? {
        prompt_tokens: response.usage.prompt_tokens ?? 0,
        completion_tokens: response.usage.completion_tokens ?? 0,
        total_tokens: response.usage.total_tokens ?? 0,
      } : {};

      return {
        content,
        model: this.model,
        usage,
        latencyMs,
        reasoningContent
      };
    } catch (e: any) {
      throw new HelloAgentsException(`OpenAI API call failed: ${e.message}`);
    }
  }

  async *streamInvoke(messages: any[], kwargs: Record<string, any> = {}): AsyncGenerator<string> {
    const startTime = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages,
        stream: true,
        ...kwargs
      });

      let reasoningContent = "";
      let usage: Record<string, number> = {};

      for await (const chunk of response) {
        if (chunk.choices && chunk.choices.length > 0) {
          const delta = chunk.choices[0].delta;
          if (delta.content) {
            yield delta.content;
          }

          if (this._isThinkingModel(this.model)) {
            if ((delta as any).reasoning_content) {
              reasoningContent += (delta as any).reasoning_content;
            }
          }
        }

        if (chunk.usage) {
          usage = {
            prompt_tokens: chunk.usage.prompt_tokens,
            completion_tokens: chunk.usage.completion_tokens,
            total_tokens: chunk.usage.total_tokens,
          };
        }
      }

      const latencyMs = Date.now() - startTime;
      this.lastStats = {
        model: this.model,
        usage,
        latencyMs,
        reasoningContent: reasoningContent || null
      };
    } catch (e: any) {
      throw new HelloAgentsException(`OpenAI API stream call failed: ${e.message}`);
    }
  }

  async invokeWithTools(messages: any[], tools: any[], kwargs: Record<string, any> = {}): Promise<any> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages,
        tools: tools,
        ...kwargs
      });
      return response;
    } catch (e: any) {
      throw new HelloAgentsException(`OpenAI Function Calling call failed: ${e.message}`);
    }
  }
}

/**
 * Anthropic Claude adapter stub
 */
export class AnthropicAdapter extends BaseLLMAdapter {
  createClient(): any {
    throw new HelloAgentsException("Anthropic adapter is not implemented. Please install '@anthropic-ai/sdk' and implement this adapter.");
  }
  async invoke(): Promise<LLMResponse> {
    throw new Error("Method not implemented.");
  }
  async *streamInvoke(): AsyncGenerator<string> {
    throw new Error("Method not implemented.");
  }
  async invokeWithTools(): Promise<any> {
    throw new Error("Method not implemented.");
  }
}

/**
 * Google Gemini adapter stub
 */
export class GeminiAdapter extends BaseLLMAdapter {
  createClient(): any {
    throw new HelloAgentsException("Gemini adapter is not implemented. Please install '@google/generative-ai' and implement this adapter.");
  }
  async invoke(): Promise<LLMResponse> {
    throw new Error("Method not implemented.");
  }
  async *streamInvoke(): AsyncGenerator<string> {
    throw new Error("Method not implemented.");
  }
  async invokeWithTools(): Promise<any> {
    throw new Error("Method not implemented.");
  }
}

/**
 * Factory function to create adapter based on baseUrl
 */
export function createAdapter(apiKey: string, baseUrl: string | undefined, timeout: number, model: string): BaseLLMAdapter {
  if (baseUrl) {
    const baseUrlLower = baseUrl.toLowerCase();
    if (baseUrlLower.includes("anthropic.com")) {
      return new AnthropicAdapter(apiKey, baseUrl, timeout, model);
    }
    if (baseUrlLower.includes("googleapis.com") || baseUrlLower.includes("generativelanguage")) {
      return new GeminiAdapter(apiKey, baseUrl, timeout, model);
    }
  }
  return new OpenAIAdapter(apiKey, baseUrl, timeout, model);
}
