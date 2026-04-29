import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

/**
 * SessionStore - 会话持久化存储
 */
export class SessionStore {
  private sessionDir: string;

  constructor(sessionDir: string = "memory/sessions") {
    this.sessionDir = path.resolve(sessionDir);
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  private _generateSessionId(): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..+/, "")
      .replace("T", "-");
    const uniqueSuffix = uuidv4().split("-")[0];
    return `s-${timestamp}-${uniqueSuffix}`;
  }

  /**
   * 保存会话
   */
  save(
    agentConfig: Record<string, any>,
    history: any[],
    toolSchemaHash: string,
    readCache: Record<string, any>,
    metadata: Record<string, any>,
    sessionName?: string
  ): string {
    const sessionId = this._generateSessionId();
    const filename = sessionName ? `${sessionName}.json` : `session-${sessionId}.json`;
    const filePath = path.join(this.sessionDir, filename);

    const sessionData = {
      session_id: sessionId,
      created_at: metadata.created_at || new Date().toISOString(),
      saved_at: new Date().toISOString(),
      agent_config: agentConfig,
      history: history.map((msg) =>
        typeof msg.toDict === "function" ? msg.toDict() : msg
      ),
      tool_schema_hash: toolSchemaHash,
      read_cache: readCache,
      metadata: metadata,
    };

    // 原子写入（临时文件 + 重命名）
    const tempPath = filePath + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(sessionData, null, 2), "utf-8");
    fs.renameSync(tempPath, filePath);

    return filePath;
  }

  /**
   * 加载会话
   */
  load(filePath: string): Record<string, any> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  }

  /**
   * 列出所有会话
   */
  listSessions(): any[] {
    const sessions: any[] = [];
    const files = fs.readdirSync(this.sessionDir).filter((f) => f.endsWith(".json"));

    for (const filename of files) {
      const filePath = path.join(this.sessionDir, filename);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(content);
        sessions.push({
          filename: filename,
          filepath: filePath,
          session_id: data.session_id,
          created_at: data.created_at,
          saved_at: data.saved_at,
          metadata: data.metadata || {},
        });
      } catch (e) {
        console.warn(`⚠️ 警告：无法读取 ${filePath}: ${e}`);
      }
    }

    // 按保存时间倒序
    sessions.sort((a, b) => (b.saved_at || "").localeCompare(a.saved_at || ""));

    return sessions;
  }

  /**
   * 删除会话
   */
  delete(sessionName: string): boolean {
    const filePath = path.join(this.sessionDir, `${sessionName}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  /**
   * 检查配置一致性
   */
  checkConfigConsistency(
    savedConfig: Record<string, any>,
    currentConfig: Record<string, any>
  ): { consistent: boolean; warnings: string[] } {
    const warnings: string[] = [];

    if (savedConfig.llm_provider !== currentConfig.llm_provider) {
      warnings.push(
        `LLM 提供商变化: ${savedConfig.llm_provider} → ${currentConfig.llm_provider}`
      );
    }

    if (savedConfig.llm_model !== currentConfig.llm_model) {
      warnings.push(
        `模型变化: ${savedConfig.llm_model} → ${currentConfig.llm_model}`
      );
    }

    if (savedConfig.max_steps !== currentConfig.max_steps) {
      warnings.push(
        `最大步数变化: ${savedConfig.max_steps} → ${currentConfig.max_steps}`
      );
    }

    return {
      consistent: warnings.length === 0,
      warnings: warnings,
    };
  }

  /**
   * 检查工具 Schema 一致性
   */
  checkToolSchemaConsistency(
    savedHash: string,
    currentHash: string
  ): { changed: boolean; saved_hash: string; current_hash: string; recommendation: string } {
    const changed = savedHash !== currentHash;
    return {
      changed: changed,
      saved_hash: savedHash,
      current_hash: currentHash,
      recommendation: changed ? "建议重新读取文件" : "可以安全恢复",
    };
  }
}
