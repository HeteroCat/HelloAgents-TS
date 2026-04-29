import { encoding_for_model, get_encoding, Tiktoken } from 'tiktoken';
import { Message } from '../core/message';

/**
 * ContextPacket - Information packet for context building.
 */
export interface ContextPacket {
  content: string;
  timestamp: Date;
  metadata: Record<string, any>;
  tokenCount: number;
  relevanceScore: number;
}

/**
 * ContextConfig - Configuration for context building.
 */
export interface ContextConfig {
  maxTokens: number;
  reserveRatio: number;
  minRelevance: number;
  enableMmr: boolean;
  mmrLambda: number;
  systemPromptTemplate: string;
  enableCompression: boolean;
}

/**
 * Helper function to create a context packet with automatic token count.
 */
export function createContextPacket(
  content: string,
  options: { timestamp?: Date; metadata?: Record<string, any>; tokenCount?: number; relevanceScore?: number } = {}
): ContextPacket {
  return {
    content,
    timestamp: options.timestamp || new Date(),
    metadata: options.metadata || {},
    tokenCount: options.tokenCount !== undefined ? options.tokenCount : countTokens(content),
    relevanceScore: options.relevanceScore || 0.0
  };
}

/**
 * ContextBuilder - GSSC (Gather-Select-Structure-Compress) pipeline for context building.
 * 
 * Flow:
 * 1. Gather: Collect candidate info from multiple sources.
 * 2. Select: Filter based on relevance, priority, and diversity.
 * 3. Structure: Organize into structured templates.
 * 4. Compress: Compress/normalize within token budget.
 */
export class ContextBuilder {
  config: ContextConfig;

  constructor(config: Partial<ContextConfig> = {}) {
    this.config = {
      maxTokens: 8000,
      reserveRatio: 0.15,
      minRelevance: 0.3,
      enableMmr: true,
      mmrLambda: 0.7,
      systemPromptTemplate: '',
      enableCompression: true,
      ...config
    };
  }

  /**
   * Get available token budget (after subtracting reserve).
   */
  getAvailableTokens(): number {
    return Math.floor(this.config.maxTokens * (1 - this.config.reserveRatio));
  }

  /**
   * Build complete context.
   * 
   * @param userQuery User query string
   * @param conversationHistory List of conversation messages
   * @param systemInstructions System instructions
   * @param additionalPackets Extra information packets
   * @returns Structured context string
   */
  build(
    userQuery: string,
    conversationHistory: Message[] = [],
    systemInstructions: string | null = null,
    additionalPackets: ContextPacket[] = []
  ): string {
    // 1. Gather: Collect candidates
    const packets = this._gather(userQuery, conversationHistory, systemInstructions, additionalPackets);

    // 2. Select: Filter and sort
    const selectedPackets = this._select(packets, userQuery);

    // 3. Structure: Organize into structure
    const structuredContext = this._structure(selectedPackets, userQuery);

    // 4. Compress: Compression and normalization if budget exceeded
    const finalContext = this._compress(structuredContext);

    return finalContext;
  }

  /**
   * Gather candidate information packets.
   */
  private _gather(
    userQuery: string,
    conversationHistory: Message[],
    systemInstructions: string | null,
    additionalPackets: ContextPacket[]
  ): ContextPacket[] {
    const packets: ContextPacket[] = [];

    // P0: System instructions (strong constraint)
    if (systemInstructions) {
      packets.push(createContextPacket(systemInstructions, { metadata: { type: 'instructions' } }));
    }

    // P3: Conversation history (auxiliary)
    if (conversationHistory.length > 0) {
      // Keep last 10 messages
      const recentHistory = conversationHistory.slice(-10);
      const historyText = recentHistory.map(msg => `[${msg.role}] ${msg.content}`).join('\n');
      packets.push(createContextPacket(historyText, { 
        metadata: { type: 'history', count: recentHistory.length } 
      }));
    }

    // Add additional packets
    packets.push(...additionalPackets);

    return packets;
  }

  /**
   * Select packets based on relevance and budget.
   */
  private _select(packets: ContextPacket[], userQuery: string): ContextPacket[] {
    // 1) Calculate relevance (keyword overlap)
    const queryTokens = new Set(userQuery.toLowerCase().split(/\s+/).filter(t => t.length > 0));
    
    for (const packet of packets) {
      const contentTokens = new Set(packet.content.toLowerCase().split(/\s+/));
      if (queryTokens.size > 0) {
        let overlapCount = 0;
        queryTokens.forEach(t => { if (contentTokens.has(t)) overlapCount++; });
        packet.relevanceScore = overlapCount / queryTokens.size;
      } else {
        packet.relevanceScore = 0.0;
      }
    }

    // 2) Recency score (exponential decay)
    const now = new Date().getTime();
    const getRecencyScore = (ts: Date) => {
      const deltaSeconds = Math.max((now - ts.getTime()) / 1000, 0);
      const tau = 3600; // 1-hour time scale
      return Math.exp(-deltaSeconds / tau);
    };

    // 3) Combined score: 0.7 * relevance + 0.3 * recency
    const scoredPackets: { score: number, packet: ContextPacket }[] = packets.map(p => {
      const rec = getRecencyScore(p.timestamp);
      const score = 0.7 * p.relevanceScore + 0.3 * rec;
      return { score, packet: p };
    });

    // 4) Separate system instructions (guaranteed to be included)
    const systemPackets = scoredPackets.filter(sp => sp.packet.metadata.type === 'instructions').map(sp => sp.packet);
    const others = scoredPackets
      .filter(sp => sp.packet.metadata.type !== 'instructions')
      .sort((a, b) => b.score - a.score)
      .map(sp => sp.packet);

    // 5) Filter by minRelevance (for non-system packets)
    const filtered = others.filter(p => p.relevanceScore >= this.config.minRelevance);

    // 6) Fill by budget
    const availableTokens = this.getAvailableTokens();
    const selected: ContextPacket[] = [];
    let usedTokens = 0;

    // Add system packets first
    for (const p of systemPackets) {
      if (usedTokens + p.tokenCount <= availableTokens) {
        selected.push(p);
        usedTokens += p.tokenCount;
      }
    }

    // Then add others by score
    for (const p of filtered) {
      if (usedTokens + p.tokenCount > availableTokens) continue;
      selected.push(p);
      usedTokens += p.tokenCount;
    }

    return selected;
  }

  /**
   * Structure selected packets into a final template.
   */
  private _structure(selectedPackets: ContextPacket[], userQuery: string): string {
    const sections: string[] = [];

    // [Role & Policies]
    const p0Packets = selectedPackets.filter(p => p.metadata.type === 'instructions');
    if (p0Packets.length > 0) {
      sections.push(`[Role & Policies]\n${p0Packets.map(p => p.content).join('\n')}`);
    }

    // [Task]
    sections.push(`[Task]\n用户问题：${userQuery}`);

    // [State]
    const p1Packets = selectedPackets.filter(p => p.metadata.type === 'task_state');
    if (p1Packets.length > 0) {
      sections.push(`[State]\n关键进展与未决问题：\n${p1Packets.map(p => p.content).join('\n')}`);
    }

    // [Evidence]
    const evidenceTypes = new Set(['related_memory', 'knowledge_base', 'retrieval', 'tool_result']);
    const p2Packets = selectedPackets.filter(p => evidenceTypes.has(p.metadata.type));
    if (p2Packets.length > 0) {
      let evidenceText = '[Evidence]\n事实与引用：\n';
      p2Packets.forEach(p => {
        evidenceText += `\n${p.content}\n`;
      });
      sections.push(evidenceText);
    }

    // [Context]
    const p3Packets = selectedPackets.filter(p => p.metadata.type === 'history');
    if (p3Packets.length > 0) {
      sections.push(`[Context]\n对话历史与背景：\n${p3Packets.map(p => p.content).join('\n')}`);
    }

    // [Output]
    const outputSection = `[Output]
请按以下格式回答：
1. 结论（简洁明确）
2. 依据（列出支撑证据及来源）
3. 风险与假设（如有）
4. 下一步行动建议（如适用）`;
    sections.push(outputSection);

    return sections.join('\n\n');
  }

  /**
   * Compress context if it exceeds budget.
   */
  private _compress(context: string): string {
    if (!this.config.enableCompression) return context;

    const currentTokens = countTokens(context);
    const availableTokens = this.getAvailableTokens();

    if (currentTokens <= availableTokens) return context;

    console.warn(`⚠️ Context over budget (${currentTokens} > ${availableTokens}), truncating.`);

    const lines = context.split('\n');
    const compressedLines: string[] = [];
    let usedTokens = 0;

    for (const line of lines) {
      const lineTokens = countTokens(line);
      if (usedTokens + lineTokens > availableTokens) break;
      compressedLines.push(line);
      usedTokens += lineTokens;
    }

    return compressedLines.join('\n');
  }
}

/**
 * Global helper for token counting with tiktoken and fallback.
 */
export function countTokens(text: string): number {
  try {
    const encoding = get_encoding('cl100k_base');
    const tokens = encoding.encode(text);
    // Be sure to free the encoding if needed (in some tiktoken bindings it's necessary)
    // encoding.free(); // if using wasm tiktoken in browser/some node environments
    return tokens.length;
  } catch (e) {
    // Fallback: ~4 chars per token
    return Math.floor(text.length / 4);
  }
}
