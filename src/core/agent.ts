import * as crypto from 'crypto';
import { Message, MessageDict, MessageRole } from './message';
import { HelloAgentsLLM } from './llm';
import { Config } from './config';
import { AgentEvent, EventType, LifecycleHook } from './lifecycle';
import { StreamEvent, StreamEventType } from './streaming';
import { ToolRegistry } from '../tools/registry';
import { ToolStatus } from '../tools/response';
import { ToolFilter } from '../tools/tool-filter';
import { HistoryManager } from '../context/history';
import { TokenCounter } from '../context/token-counter';
import { ObservationTruncator } from '../context/truncator';
import { TraceLogger } from '../observability/trace-logger';
import { SkillLoader } from '../skills/loader';
import { SessionStore } from './session-store';

/**
 * Agent Base Class
 */
export abstract class Agent {
  public name: string;
  public llm: HelloAgentsLLM;
  public systemPrompt: string | null;
  public config: Config;
  public toolRegistry: ToolRegistry | null;

  public historyManager: HistoryManager;
  public truncator: ObservationTruncator;
  public tokenCounter: TokenCounter;
  public traceLogger: TraceLogger | null = null;
  public skillLoader: SkillLoader | null = null;
  public sessionStore: SessionStore | null = null;

  protected _historyTokenCount: number = 0;
  protected _sessionMetadata: Record<string, any>;
  protected _startTime: Date;
  protected _summaryLlm: HelloAgentsLLM | null = null;

  constructor(
    name: string,
    llm: HelloAgentsLLM,
    systemPrompt: string | null = null,
    config: Config | null = null,
    toolRegistry: ToolRegistry | null = null
  ) {
    this.name = name;
    this.llm = llm;
    this.systemPrompt = systemPrompt;
    this.config = config || new Config();
    this.toolRegistry = toolRegistry;

    // Initialize context engineering components
    this.historyManager = new HistoryManager(
      this.config.minRetainRounds,
      this.config.compressionThreshold
    );

    this.truncator = new ObservationTruncator(
      this.config.toolOutputMaxLines,
      this.config.toolOutputMaxBytes,
      this.config.toolOutputTruncateDirection as any,
      this.config.toolOutputDir
    );

    // Initialize Token Counter
    this.tokenCounter = new TokenCounter(this.llm.model);

    // Initialize Observability
    if (this.config.traceEnabled) {
      this.traceLogger = new TraceLogger(
        this.config.traceDir,
        this.config.traceSanitize,
        this.config.traceHtmlIncludeRawResponse
      );
      this.traceLogger.logEvent("session_start", {
        agent_name: this.name,
        agent_type: this.constructor.name,
        config: this.config.toDict(),
      });
    }

    // Initialize Skills
    if (this.config.skillsEnabled) {
      this.skillLoader = new SkillLoader(this.config.skillsDir);
      // Auto-register SkillTool logic would go here if implemented
    }

    // Initialize Session Persistence
    if (this.config.sessionEnabled) {
      this.sessionStore = new SessionStore(this.config.sessionDir);
    }

    this._sessionMetadata = {
      created_at: new Date().toISOString(),
      total_tokens: 0,
      total_steps: 0,
      duration_seconds: 0,
    };
    this._startTime = new Date();
  }

  /**
   * Backwards compatibility: Proxy _history to HistoryManager
   */
  get _history(): Message[] {
    return this.historyManager.getHistory();
  }

  set _history(value: Message[]) {
    this.historyManager.clear();
    for (const msg of value) {
      this.historyManager.append(msg);
    }
  }

  /**
   * Run Agent (Synchronous version, but in TS it's recommended to use arun)
   */
  abstract run(inputText: string, options?: Record<string, any>): string | Promise<string>;

  /**
   * Async Execution with Lifecycle Hooks
   */
  async arun(
    inputText: string,
    hooks: {
      onStart?: LifecycleHook;
      onStep?: LifecycleHook;
      onFinish?: LifecycleHook;
      onError?: LifecycleHook;
    } = {},
    options: Record<string, any> = {}
  ): Promise<string> {
    await this._emitEvent(EventType.AGENT_START, hooks.onStart, { input_text: inputText });

    try {
      // Default implementation: just call the potentially async run()
      const result = await this.run(inputText, options);

      await this._emitEvent(EventType.AGENT_FINISH, hooks.onFinish, { result });
      return result;
    } catch (e: any) {
      await this._emitEvent(EventType.AGENT_ERROR, hooks.onError, {
        error: e.message,
        error_type: e.constructor.name,
      });
      throw e;
    }
  }

  /**
   * Streaming Execution
   */
  async *arunStream(
    inputText: string,
    options: Record<string, any> = {}
  ): AsyncGenerator<AgentEvent | StreamEvent, void, unknown> {
    yield AgentEvent.create(EventType.AGENT_START, this.name, { input_text: inputText });

    try {
      // Subclasses should override this for real streaming
      const result = await this.arun(inputText, {}, options);
      yield AgentEvent.create(EventType.AGENT_FINISH, this.name, { result });
    } catch (e: any) {
      yield AgentEvent.create(EventType.AGENT_ERROR, this.name, {
        error: e.message,
        error_type: e.constructor.name,
      });
      throw e;
    }
  }

  protected async _emitEvent(
    eventType: EventType,
    hook: LifecycleHook,
    data: Record<string, any> = {}
  ): Promise<void> {
    const event = AgentEvent.create(eventType, this.name, data);

    if (hook) {
      try {
        const timeout = this.config.hookTimeoutSeconds * 1000;
        await Promise.race([
          hook(event),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Hook timeout")), timeout)
          ),
        ]);
      } catch (e: any) {
        if (this.traceLogger) {
          this.traceLogger.logEvent("hook_error", {
            event_type: eventType,
            error: e.message,
          });
        }
      }
    }
  }

  /**
   * Add message and handle compression/autosave
   */
  addMessage(message: Message): void {
    this.historyManager.append(message);
    
    // Incremental token count
    const newTokens = this.tokenCounter.countMessage(message);
    this._historyTokenCount += newTokens;

    if (this._shouldCompress()) {
      this._compressHistory();
    }

    if (this.config.autoSaveEnabled && this.sessionStore) {
      const historyLen = this.historyManager.getHistory().length;
      if (historyLen % this.config.autoSaveInterval === 0) {
        this._autoSave();
      }
    }
  }

  clearHistory(): void {
    this.historyManager.clear();
    this._historyTokenCount = 0;
    this.tokenCounter.clearCache();
  }

  getHistory(): Message[] {
    return this.historyManager.getHistory();
  }

  protected _shouldCompress(): boolean {
    const threshold = Math.floor(this.config.contextWindow * this.config.compressionThreshold);
    return this._historyTokenCount > threshold;
  }

  protected _compressHistory(): void {
    const history = this.historyManager.getHistory();

    if (this.config.enableSmartCompression) {
      // Smart compression is async — fire and forget with fallback
      this._generateSmartSummary(history).then(summary => {
        this.historyManager.compress(summary);
        const newHistory = this.historyManager.getHistory();
        this._historyTokenCount = this.tokenCounter.countMessages(newHistory);
      }).catch(() => {
        const summary = this._generateSimpleSummary(history);
        this.historyManager.compress(summary);
        const newHistory = this.historyManager.getHistory();
        this._historyTokenCount = this.tokenCounter.countMessages(newHistory);
      });
    } else {
      const summary = this._generateSimpleSummary(history);
      this.historyManager.compress(summary);
      const newHistory = this.historyManager.getHistory();
      this._historyTokenCount = this.tokenCounter.countMessages(newHistory);
    }
  }

  protected _generateSimpleSummary(history: Message[]): string {
    const rounds = this.historyManager.estimateRounds();
    const userMsgs = history.filter(m => m.role === 'user').length;
    const assistantMsgs = history.filter(m => m.role === 'assistant').length;

    return `此会话包含 ${rounds} 轮对话：\n- 用户消息：${userMsgs} 条\n- 助手消息：${assistantMsgs} 条\n- 总消息数：${history.length} 条\n\n（历史已压缩，保留最近 ${this.config.minRetainRounds} 轮完整对话）`;
  }

  protected async _generateSmartSummary(history: Message[]): Promise<string> {
    const boundaries = this.historyManager.findRoundBoundaries();
    if (boundaries.length <= this.config.minRetainRounds) {
      return this._generateSimpleSummary(history);
    }

    const keepFromIndex = boundaries[boundaries.length - this.config.minRetainRounds];
    const toCompress = history.slice(0, keepFromIndex);

    if (toCompress.length === 0) {
      return this._generateSimpleSummary(history);
    }

    const historyText = this._formatHistoryForSummary(toCompress);
    const summaryPrompt = `请将以下对话历史压缩为结构化摘要，保留关键信息：\n\n## 对话历史\n${historyText}\n\n## 摘要要求\n1. **任务目标**\n2. **关键决策**\n3. **已完成工作**\n4. **待处理事项**\n5. **重要发现**\n\n请用简洁的中文输出。`;

    try {
      const summaryLlm = this._getSummaryLlm();
      const messages = [
        { role: "system" as MessageRole, content: "你是一个专业的对话摘要助手。" },
        { role: "user" as MessageRole, content: summaryPrompt }
      ];

      const response = await summaryLlm.invoke(messages, {
        temperature: this.config.summaryTemperature,
        max_tokens: this.config.summaryMaxTokens
      });

      return `## 历史摘要（${toCompress.length} 条消息）\n${response.content}\n\n---\n（已压缩，保留最近 ${this.config.minRetainRounds} 轮完整对话）`;
    } catch (e) {
      return this._generateSimpleSummary(history);
    }
  }

  private _formatHistoryForSummary(history: Message[]): string {
    return history.map(msg => {
      const content = msg.content.length > 500 ? msg.content.substring(0, 500) + "..." : msg.content;
      return `[${msg.role}]: ${content}`;
    }).join("\n\n");
  }

  private _getSummaryLlm(): HelloAgentsLLM {
    if (!this._summaryLlm) {
      this._summaryLlm = new HelloAgentsLLM({
        provider: this.config.summaryLlmProvider,
        model: this.config.summaryLlmModel,
        temperature: this.config.summaryTemperature,
        maxTokens: this.config.summaryMaxTokens
      });
    }
    return this._summaryLlm;
  }

  /**
   * Build Tool Schemas for Function Calling
   */
  _buildToolSchemas(): any[] {
    if (!this.toolRegistry) return [];

    const schemas: any[] = [];
    
    // 1. Tool objects
    for (const tool of this.toolRegistry.getAllTools()) {
      const properties: Record<string, any> = {};
      const required: string[] = [];

      const parameters = tool.getParameters();
      for (const param of parameters) {
        properties[param.name] = {
          type: this._mapParameterType(param.type),
          description: param.description || "",
        };
        if (param.default !== undefined) {
          properties[param.name].default = param.default;
        }
        if (param.required !== false) {
          required.push(param.name);
        }
      }

      const schema: any = {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description || "",
          parameters: {
            type: "object",
            properties: properties,
          },
        },
      };

      if (required.length > 0) {
        schema.function.parameters.required = required;
      }
      schemas.push(schema);
    }

    // Handle function map if any (TypeScript version might differ in implementation details)
    const functionMap = (this.toolRegistry as any)._functions || {};
    for (const [name, info] of Object.entries(functionMap)) {
      schemas.push({
        type: "function",
        function: {
          name: name,
          description: (info as any).description || "",
          parameters: {
            type: "object",
            properties: {
              input: { type: "string", description: "输入文本" }
            },
            required: ["input"]
          }
        }
      });
    }

    return schemas;
  }

  protected _mapParameterType(paramType: string): string {
    const normalized = (paramType || "").toLowerCase();
    if (["string", "number", "integer", "boolean", "array", "object"].includes(normalized)) {
      return normalized;
    }
    return "string";
  }

  protected _convertParameterTypes(toolName: string, paramDict: Record<string, any>): Record<string, any> {
    if (!this.toolRegistry) return paramDict;

    const tool = this.toolRegistry.getTool(toolName);
    if (!tool) return paramDict;

    const toolParams = tool.getParameters();
    const typeMapping: Record<string, string> = {};
    for (const p of toolParams) typeMapping[p.name] = p.type;

    const converted: Record<string, any> = {};
    for (const [key, value] of Object.entries(paramDict)) {
      const paramType = typeMapping[key];
      if (!paramType) {
        converted[key] = value;
        continue;
      }

      try {
        const normalized = paramType.toLowerCase();
        if (normalized === "number" || normalized === "float") {
          converted[key] = parseFloat(value);
        } else if (normalized === "integer" || normalized === "int") {
          converted[key] = parseInt(value, 10);
        } else if (normalized === "boolean" || normalized === "bool") {
          if (typeof value === "boolean") converted[key] = value;
          else if (typeof value === "number") converted[key] = value !== 0;
          else if (typeof value === "string") {
            converted[key] = ["true", "1", "yes"].includes(value.toLowerCase());
          } else {
            converted[key] = !!value;
          }
        } else {
          converted[key] = value;
        }
      } catch (e) {
        converted[key] = value;
      }
    }

    return converted;
  }

  async _executeToolCall(toolName: string, arguments_obj: Record<string, any>): Promise<string> {
    if (!this.toolRegistry) return "❌ 错误：未配置工具注册表";

    const tool = this.toolRegistry.getTool(toolName);
    if (tool) {
      try {
        const typedArguments = this._convertParameterTypes(toolName, arguments_obj);
        const response = await tool.runWithTiming(typedArguments);
        
        if (response.status === ToolStatus.ERROR) {
          const errorCode = response.errorInfo?.code || "UNKNOWN";
          return `❌ 错误 [${errorCode}]: ${response.text}`;
        } else if (response.status === ToolStatus.PARTIAL) {
          return `⚠️ 部分成功: ${response.text}`;
        } else {
          return response.text;
        }
      } catch (e: any) {
        return `❌ 工具调用失败：${e.message}`;
      }
    }

    // Try function map
    const func = (this.toolRegistry as any).getFunction ? (this.toolRegistry as any).getFunction(toolName) : null;
    if (func) {
      try {
        const inputText = arguments_obj.input || "";
        const response = await this.toolRegistry.executeTool(toolName, inputText);
        if (response.status === ToolStatus.ERROR) {
          const errorCode = response.errorInfo?.code || "UNKNOWN";
          return `❌ 错误 [${errorCode}]: ${response.text}`;
        } else {
          return response.text;
        }
      } catch (e: any) {
        return `❌ 工具调用失败：${e.message}`;
      }
    }

    return `❌ 错误：未找到工具 '${toolName}'`;
  }

  /**
   * Session Management
   */
  protected _autoSave(): void {
    if (!this.sessionStore) return;
    try {
      this.sessionStore.save(
        this._getAgentConfig(),
        this.historyManager.getHistory(),
        this._computeToolSchemaHash(),
        this._getReadCache(),
        this._sessionMetadata,
        "session-auto"
      );
    } catch (e) {
      if (this.config.debug) console.warn(`⚠️ 自动保存失败: ${e}`);
    }
  }

  saveSession(sessionName: string): string {
    if (!this.sessionStore) {
      throw new Error("会话持久化未启用，请在 Config 中设置 sessionEnabled=true");
    }

    this._sessionMetadata.duration_seconds = (Date.now() - this._startTime.getTime()) / 1000;
    
    return this.sessionStore.save(
      this._getAgentConfig(),
      this.historyManager.getHistory(),
      this._computeToolSchemaHash(),
      this._getReadCache(),
      this._sessionMetadata,
      sessionName
    );
  }

  loadSession(filePath: string, checkConsistency: boolean = true): void {
    if (!this.sessionStore) {
      throw new Error("会话持久化未启用，请在 Config 中设置 sessionEnabled=true");
    }

    const sessionData = this.sessionStore.load(filePath);

    if (checkConsistency) {
      const configCheck = this.sessionStore.checkConfigConsistency(
        sessionData.agent_config || {},
        this._getAgentConfig()
      );
      if (!configCheck.consistent) {
        console.warn("⚠️ 环境配置不一致：");
        for (const w of configCheck.warnings) console.warn(`  - ${w}`);
      }

      const toolCheck = this.sessionStore.checkToolSchemaConsistency(
        sessionData.tool_schema_hash || "",
        this._computeToolSchemaHash()
      );
      if (toolCheck.changed) {
        console.warn(`⚠️ 工具定义已变化: ${toolCheck.recommendation}`);
      }
    }

    this.historyManager.clear();
    for (const msgData of sessionData.history || []) {
      this.historyManager.append(Message.fromDict(msgData));
    }

    this._sessionMetadata = sessionData.metadata || {};
    if (this.toolRegistry && sessionData.read_cache) {
      (this.toolRegistry as any).readMetadataCache = sessionData.read_cache;
    }

    console.log(`✅ 会话已恢复：${sessionData.session_id || 'unknown'}`);
  }

  listSessions(): any[] {
    return this.sessionStore ? this.sessionStore.listSessions() : [];
  }

  protected _getAgentConfig(): Record<string, any> {
    const config: Record<string, any> = {
      name: this.name,
      agent_type: this.constructor.name,
      llm_provider: (this.llm as any).provider || 'unknown',
      llm_model: (this.llm as any).modelId || this.llm.model || 'unknown'
    };
    if ((this as any).maxSteps !== undefined) {
      config.max_steps = (this as any).maxSteps;
    }
    return config;
  }

  protected _computeToolSchemaHash(): string {
    if (!this.toolRegistry) return "no-tools";

    const toolsSignature: Record<string, any> = {};
    const toolNames = this.toolRegistry.listTools().sort();
    
    for (const name of toolNames) {
      const tool = this.toolRegistry.getTool(name);
      if (tool) {
        toolsSignature[name] = {
          name: tool.name,
          description: (tool.description || "").substring(0, 100),
          parameters: Object.keys((tool as any).parameters || {})
        };
      }
    }

    const schemaStr = JSON.stringify(toolsSignature);
    return crypto.createHash('sha256').update(schemaStr).digest('hex').substring(0, 16);
  }

  protected _getReadCache(): Record<string, any> {
    return (this.toolRegistry as any)?.readMetadataCache || {};
  }

  /**
   * Subagent Mechanism
   */
  async runAsSubagent(
    task: string,
    toolFilter: ToolFilter | null = null,
    returnSummary: boolean = true,
    maxStepsOverride: number | null = null
  ): Promise<Record<string, any>> {
    // Save current state
    const originalHistory = [...this.historyManager.getHistory()];
    let originalTools: string[] | null = null;
    let originalMaxSteps: number | null = null;

    // Create isolated history
    this.historyManager.clear();

    // Apply tool filter
    if (toolFilter && this.toolRegistry) {
      originalTools = this._applyToolFilter(toolFilter);
    }

    // Override max steps
    if (maxStepsOverride !== null && (this as any).maxSteps !== undefined) {
      originalMaxSteps = (this as any).maxSteps;
      (this as any).maxSteps = maxStepsOverride;
    }

    const startTime = Date.now();
    let success = false;
    let result = "";
    let errorMsg: string | null = null;

    try {
      result = await this.run(task);
      success = true;
    } catch (e: any) {
      errorMsg = e.message;
      result = `执行失败: ${errorMsg}`;
    } finally {
      const duration = (Date.now() - startTime) / 1000;
      const metadata = this._getSubagentMetadata(duration, errorMsg);
      
      let summary = "";
      if (returnSummary) {
        summary = this._generateSubagentSummary(task, result, metadata);
      }

      // Restore state
      this.historyManager.clear();
      for (const msg of originalHistory) this.historyManager.append(msg);

      if (originalTools !== null) this._restoreTools(originalTools);
      if (originalMaxSteps !== null) (this as any).maxSteps = originalMaxSteps;

      return returnSummary ? { success, summary, metadata } : { success, result, metadata };
    }
  }

  private _applyToolFilter(toolFilter: ToolFilter): string[] {
    if (!this.toolRegistry) return [];
    const originalTools = this.toolRegistry.listTools();
    const filteredTools = toolFilter.filter(originalTools);

    (this.toolRegistry as any)._tempDisabledTools = (this.toolRegistry as any)._tempDisabledTools || {};
    
    for (const name of originalTools) {
      if (!filteredTools.includes(name)) {
        const tool = this.toolRegistry.getTool(name);
        if (tool) {
          (this.toolRegistry as any)._tempDisabledTools[name] = tool;
          this.toolRegistry.unregister(name);
        }
      }
    }
    return originalTools;
  }

  private _restoreTools(originalTools: string[]): void {
    if (!this.toolRegistry) return;
    const tempDisabled = (this.toolRegistry as any)._tempDisabledTools || {};
    for (const [name, tool] of Object.entries(tempDisabled)) {
      this.toolRegistry.registerTool(tool as any);
    }
    (this.toolRegistry as any)._tempDisabledTools = {};
  }

  private _getSubagentMetadata(duration: number, error: string | null): Record<string, any> {
    const history = this.historyManager.getHistory();
    const steps = history.filter(m => m.role === 'assistant').length;
    const totalChars = history.reduce((sum, m) => sum + m.content.length, 0);
    const tokens = Math.floor(totalChars / 4);
    const toolsUsed = this._extractToolsFromHistory(history);

    const metadata: Record<string, any> = {
      steps,
      tokens,
      duration_seconds: parseFloat(duration.toFixed(2)),
      tools_used: toolsUsed
    };
    if (error) metadata.error = error;
    return metadata;
  }

  private _extractToolsFromHistory(history: Message[]): string[] {
    const tools = new Set<string>();
    for (const msg of history) {
      if (msg.metadata?.tool_calls) {
        for (const tc of msg.metadata.tool_calls) {
          if (tc.function?.name) tools.add(tc.function.name);
        }
      }
      // ReAct pattern
      if (msg.role === 'assistant' && msg.content.includes("Action:")) {
        const matches = msg.content.match(/Action:\s*(\w+)\[/g);
        if (matches) {
          for (const m of matches) {
            const name = m.replace(/Action:\s*/, "").replace("[", "");
            tools.add(name);
          }
        }
      }
    }
    return Array.from(tools).sort();
  }

  private _generateSubagentSummary(task: string, result: string, metadata: Record<string, any>): string {
    const resultPreview = result.length > 500 ? result.substring(0, 500) + "..." : result;
    const parts = [
      `任务: ${task}`,
      `结果: ${resultPreview}`,
      `步数: ${metadata.steps}`,
      `耗时: ${metadata.duration_seconds}秒`
    ];
    if (metadata.tools_used?.length > 0) {
      parts.push(`工具: ${metadata.tools_used.join(", ")}`);
    }
    if (metadata.error) parts.push(`错误: ${metadata.error}`);
    return parts.join("\n");
  }

  toString(): string {
    return `Agent(name=${this.name}, model=${this.llm.model})`;
  }
}
