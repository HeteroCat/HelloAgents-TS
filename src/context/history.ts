import { Message, MessageDict } from '../core/message';

/**
 * HistoryManager - History management for conversation messages.
 * 
 * Responsibilities:
 * - Append messages (append-only, cache-friendly)
 * - History compression (summary + retain recent rounds)
 * - Session serialization/deserialization
 * - Round boundary detection
 */
export class HistoryManager {
  private _history: Message[] = [];
  minRetainRounds: number;
  compressionThreshold: number;

  /**
   * Initialize HistoryManager
   * 
   * @param minRetainRounds Minimum complete rounds to keep during compression
   * @param compressionThreshold Compression threshold (reserved for future use)
   */
  constructor(minRetainRounds: number = 10, compressionThreshold: number = 0.8) {
    this.minRetainRounds = minRetainRounds;
    this.compressionThreshold = compressionThreshold;
  }

  /**
   * Append a message (append-only)
   * 
   * @param message Message to append
   */
  append(message: Message): void {
    this._history.push(message);
  }

  /**
   * Get a copy of the history
   * 
   * @returns A copy of the history messages
   */
  getHistory(): Message[] {
    return [...this._history];
  }

  /**
   * Clear the history
   */
  clear(): void {
    this._history = [];
  }

  /**
   * Estimate the number of complete rounds.
   * A round is defined as 1 user message followed by any number of assistant/tool/summary messages.
   * 
   * @returns Number of complete rounds
   */
  estimateRounds(): number {
    let rounds = 0;
    let i = 0;
    while (i < this._history.length) {
      if (this._history[i].role === 'user') {
        rounds++;
        i++;
        while (i < this._history.length && this._history[i].role !== 'user') {
          i++;
        }
      } else {
        i++;
      }
    }
    return rounds;
  }

  /**
   * Find start indices of each round.
   * 
   * @returns List of starting indices, e.g., [0, 3, 7, 10]
   */
  findRoundBoundaries(): number[] {
    const boundaries: number[] = [];
    this._history.forEach((msg, index) => {
      if (msg.role === 'user') {
        boundaries.push(index);
      }
    });
    return boundaries;
  }

  /**
   * Compress history.
   * Replaces old history with a summary message and keeps the recent N complete rounds.
   * 
   * @param summary History summary text
   */
  compress(summary: string): void {
    const rounds = this.estimateRounds();
    if (rounds <= this.minRetainRounds) {
      return;
    }

    const boundaries = this.findRoundBoundaries();
    
    // Calculate start position for keeping (keep the most recent minRetainRounds)
    if (boundaries.length > this.minRetainRounds) {
      const keepFromIndex = boundaries[boundaries.length - this.minRetainRounds];
      
      // Generate summary message
      const summaryMsg = new Message(
        `## Archived Session Summary\n${summary}`,
        'summary',
        {
          metadata: { compressed_at: new Date().toISOString() }
        }
      );
      
      // Replace history: summary + kept recent rounds
      this._history = [summaryMsg, ...this._history.slice(keepFromIndex)];
    }
  }

  /**
   * Serialize to dictionary (for session saving)
   * 
   * @returns Dictionary containing history and metadata
   */
  toDict(): Record<string, any> {
    return {
      history: this._history.map(msg => msg.toDict()),
      created_at: new Date().toISOString(),
      rounds: this.estimateRounds()
    };
  }

  /**
   * Load from dictionary (for session restoration)
   * 
   * @param data Serialized history data
   */
  loadFromDict(data: Record<string, any>): void {
    const historyData = data.history || [];
    this._history = (historyData as MessageDict[]).map(msgData => Message.fromDict(msgData));
  }
}
