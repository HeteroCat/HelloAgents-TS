import { encoding_for_model, get_encoding, Tiktoken } from 'tiktoken';
import { Message } from '../core/message';

/**
 * TokenCounter - Token counter for local estimation.
 * 
 * Responsibilities:
 * - Local token estimation (no API calls)
 * - Caching mechanism (avoid repeated calculations)
 * - Incremental counting (for new messages)
 * - Fallback to character estimation if tiktoken is unavailable
 */
export class TokenCounter {
  model: string;
  private _encoding: Tiktoken | null = null;
  private _cache: Map<string, number> = new Map();

  /**
   * Initialize TokenCounter
   * 
   * @param model Model name (to select tiktoken encoder)
   */
  constructor(model: string = 'gpt-4') {
    this.model = model;
    this._encoding = this._getEncoding();
  }

  /**
   * Get tiktoken encoder
   * 
   * @returns Tiktoken instance, or null if failed
   */
  private _getEncoding(): Tiktoken | null {
    try {
      return encoding_for_model(this.model as any);
    } catch (e) {
      try {
        return get_encoding('cl100k_base');
      } catch (ee) {
        return null;
      }
    }
  }

  /**
   * Calculate tokens for a list of messages.
   * 
   * @param messages List of messages
   * @returns Total tokens
   */
  countMessages(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      total += this.countMessage(msg);
    }
    return total;
  }

  /**
   * Calculate tokens for a single message (with cache).
   * 
   * @param message Message object
   * @returns Total tokens
   */
  countMessage(message: Message): number {
    const cacheKey = `${message.role}:${message.content}`;
    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey)!;
    }

    let tokens = this._countText(message.content);
    // Overhead for role/message markers (approx 4 tokens)
    tokens += 4;
    
    this._cache.set(cacheKey, tokens);
    return tokens;
  }

  /**
   * Calculate tokens for text (no cache).
   * 
   * @param text Text content
   * @returns Total tokens
   */
  countText(text: string): number {
    return this._countText(text);
  }

  /**
   * Internal token counting logic.
   * 
   * @param text Text content
   * @returns Total tokens
   */
  private _countText(text: string): number {
    if (this._encoding) {
      try {
        const encoded = this._encoding.encode(text);
        return encoded.length;
      } catch (e) {
        // Fallback to char estimation
        return Math.floor(text.length / 4);
      }
    } else {
      // Fallback: ~4 chars per token
      return Math.floor(text.length / 4);
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this._cache.clear();
  }

  /**
   * Get cache size
   * 
   * @returns Cached message count
   */
  getCacheSize(): number {
    return this._cache.size;
  }

  /**
   * Get cache statistics
   * 
   * @returns Cache statistics record
   */
  getCacheStats(): Record<string, number> {
    let totalCachedTokens = 0;
    this._cache.forEach(val => { totalCachedTokens += val; });
    return {
      cachedMessages: this._cache.size,
      totalCachedTokens: totalCachedTokens
    };
  }
}
