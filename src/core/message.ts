export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'summary';

export interface MessageDict {
  role: MessageRole;
  content: string;
  timestamp?: string | null;
  metadata?: Record<string, any> | null;
}

/**
 * Message class
 */
export class Message {
  content: string;
  role: MessageRole;
  timestamp: Date;
  metadata: Record<string, any>;

  constructor(content: string, role: MessageRole, options: { timestamp?: Date; metadata?: Record<string, any> } = {}) {
    this.content = content;
    this.role = role;
    this.timestamp = options.timestamp || new Date();
    this.metadata = options.metadata || {};
  }

  /**
   * Convert to dictionary format (OpenAI API format)
   */
  toDict(): MessageDict {
    return {
      role: this.role,
      content: this.content,
      timestamp: this.timestamp ? this.timestamp.toISOString() : null,
      metadata: this.metadata,
    };
  }

  /**
   * Create a Message object from a dictionary
   */
  static fromDict(data: MessageDict): Message {
    let timestamp: Date | undefined;
    if (data.timestamp) {
      timestamp = new Date(data.timestamp);
    }

    return new Message(data.content, data.role, {
      timestamp,
      metadata: data.metadata || {},
    });
  }

  /**
   * Format as text (for context building)
   */
  toText(): string {
    return `[${this.role}] ${this.content}`;
  }

  /**
   * String representation
   */
  toString(): string {
    return `[${this.role}] ${this.content}`;
  }
}
