import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

/**
 * TraceLogger - 双格式 Trace 记录器
 */
export class TraceLogger {
  public session_id: string;
  private output_dir: string;
  private sanitize: boolean;
  private html_include_raw: boolean;
  private _events: any[] = [];
  private jsonl_path: string;
  private html_path: string;
  private jsonl_fd: number;
  private html_fd: number;

  constructor(
    output_dir: string = "memory/traces",
    sanitize: boolean = true,
    html_include_raw_response: boolean = false
  ) {
    this.output_dir = path.resolve(output_dir);
    this.sanitize = sanitize;
    this.html_include_raw = html_include_raw_response;

    this.session_id = this._generateSessionId();

    if (!fs.existsSync(this.output_dir)) {
      fs.mkdirSync(this.output_dir, { recursive: true });
    }

    this.jsonl_path = path.join(this.output_dir, `trace-${this.session_id}.jsonl`);
    this.html_path = path.join(this.output_dir, `trace-${this.session_id}.html`);

    // Using synchronous file operations for simplicity as in Python version's open()
    this.jsonl_fd = fs.openSync(this.jsonl_path, "w");
    this.html_fd = fs.openSync(this.html_path, "w");

    this._writeHtmlHeader();
  }

  private _generateSessionId(): string {
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..+/, "")
      .replace("T", "-");
    const randomSuffix = uuidv4().split("-")[0].substring(0, 4);
    return `s-${timestamp}-${randomSuffix}`;
  }

  logEvent(event: string, payload: Record<string, any>, step?: number): void {
    let eventObj: any = {
      ts: new Date().toISOString(),
      session_id: this.session_id,
      step: step,
      event: event,
      payload: payload,
    };

    if (this.sanitize) {
      eventObj = this._sanitizeEvent(eventObj);
    }

    this._events.push(eventObj);

    // Stream to JSONL
    fs.writeSync(this.jsonl_fd, JSON.stringify(eventObj) + "\n");
    // No explicit flush needed for fs.writeSync in Node.js typically, but we could call fs.fsyncSync(this.jsonl_fd)

    // Incremental HTML write
    this._writeHtmlEvent(eventObj);
  }

  private _sanitizeEvent(event: any): any {
    const newEvent = JSON.parse(JSON.stringify(event));
    newEvent.payload = this._sanitizeValue(newEvent.payload);
    return newEvent;
  }

  private _sanitizeValue(value: any): any {
    if (typeof value === "string") {
      // API Key: sk-xxx -> sk-***
      value = value.replace(/sk-[a-zA-Z0-9]+/g, "sk-***");
      // Bearer Token: Bearer xxx -> Bearer ***
      value = value.replace(/Bearer\s+[a-zA-Z0-9_\-]+/g, "Bearer ***");
      // Path usernames
      value = value.replace(/(\/Users\/|\/home\/|C:\\Users\\)[^/\\]+/g, "$1***");
      return value;
    } else if (Array.isArray(value)) {
      return value.map((item) => this._sanitizeValue(item));
    } else if (value !== null && typeof value === "object") {
      const result: any = {};
      for (const key in value) {
        result[key] = this._sanitizeValue(value[key]);
      }
      return result;
    }
    return value;
  }

  finalize(): void {
    const stats = this._computeStats();
    this._writeHtmlFooter(stats);

    fs.closeSync(this.jsonl_fd);
    fs.closeSync(this.html_fd);

    console.log(`✅ Trace 已保存:`);
    console.log(`   JSONL: ${this.jsonl_path}`);
    console.log(`   HTML:  ${this.html_path}`);
  }

  private _computeStats(): any {
    const stats: any = {
      total_steps: 0,
      total_tokens: 0,
      total_cost: 0.0,
      tool_calls: {},
      errors: [],
      duration_seconds: 0.0,
      model_calls: 0,
    };

    let session_start: Date | null = null;
    let session_end: Date | null = null;

    for (const event of this._events) {
      if (event.event === "session_start") {
        session_start = new Date(event.ts);
      }
      if (event.event === "session_end") {
        session_end = new Date(event.ts);
      }

      if (event.step) {
        stats.total_steps = Math.max(stats.total_steps, event.step);
      }

      if (event.event === "model_output") {
        const usage = event.payload?.usage || {};
        stats.total_tokens += usage.total_tokens || 0;
        stats.total_cost += usage.cost || 0.0;
        stats.model_calls += 1;
      }

      if (event.event === "tool_call") {
        const toolName = event.payload?.tool_name || "unknown";
        stats.tool_calls[toolName] = (stats.tool_calls[toolName] || 0) + 1;
      }

      if (event.event === "error") {
        stats.errors.push({
          step: event.step,
          type: event.payload?.error_type,
          message: event.payload?.message,
        });
      }
    }

    if (session_start && session_end) {
      stats.duration_seconds = (session_end.getTime() - session_start.getTime()) / 1000;
    }

    return stats;
  }

  private _writeHtmlHeader(): void {
    const now = new Date().toLocaleString();
    const header = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Trace: ${this.session_id}</title>
    <style>
        body {
            font-family: 'Consolas', 'Monaco', monospace;
            padding: 20px;
            background: #1a1a1a;
            color: #e0e0e0;
            margin: 0;
        }
        .header {
            background: #2a2a2a;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .header h1 {
            margin: 0 0 10px 0;
            color: #4af626;
        }
        .stats-panel {
            background: #2a2a2a;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }
        .stat-item {
            background: #1a1a1a;
            padding: 15px;
            border-radius: 5px;
            border-left: 3px solid #4af626;
        }
        .stat-label {
            display: block;
            color: #888;
            font-size: 12px;
            margin-bottom: 5px;
        }
        .stat-value {
            display: block;
            color: #e0e0e0;
            font-size: 24px;
            font-weight: bold;
        }
        .tool-stats {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        .tool-stats th, .tool-stats td {
            padding: 8px;
            text-align: left;
            border-bottom: 1px solid #333;
        }
        .tool-stats th {
            color: #4af626;
        }
        .error-list {
            list-style: none;
            padding: 0;
        }
        .error-list li {
            background: #331111;
            padding: 10px;
            margin: 5px 0;
            border-radius: 5px;
            border-left: 3px solid #ff4444;
        }
        .events-container {
            background: #2a2a2a;
            padding: 20px;
            border-radius: 8px;
        }
        .event {
            border: 1px solid #333;
            margin: 10px 0;
            padding: 15px;
            border-radius: 5px;
            background: #1a1a1a;
        }
        .event-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
        }
        .step {
            color: #888;
            font-size: 12px;
        }
        .timestamp {
            color: #666;
            font-size: 11px;
        }
        .event-type {
            color: #4af626;
            font-weight: bold;
        }
        .expandable {
            cursor: pointer;
            color: #4af626;
            user-select: none;
        }
        .expandable:hover {
            color: #6fff48;
        }
        .details {
            display: none;
            margin-top: 10px;
            padding: 10px;
            background: #0d0d0d;
            border-radius: 5px;
            overflow-x: auto;
        }
        .details pre {
            margin: 0;
            color: #e0e0e0;
        }
        .tool-call {
            border-left: 3px solid #4af626;
        }
        .tool-result {
            border-left: 3px solid #ffd700;
        }
        .error {
            border-left: 3px solid #ff4444;
            background: #2a1a1a;
        }
        .model-output {
            border-left: 3px solid #00bfff;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔍 Trace Session: ${this.session_id}</h1>
        <p>生成时间: ${now}</p>
    </div>

    <div class="events-container">
        <h2>📋 事件列表</h2>
`;
    fs.writeSync(this.html_fd, header);
  }

  private _writeHtmlEvent(event: any): void {
    const eventType = event.event;
    const step = event.step || "";
    const timestamp = event.ts;
    const payload = event.payload || {};

    let cssClass = "event";
    if (eventType === "tool_call") cssClass += " tool-call";
    else if (eventType === "tool_result") cssClass += " tool-result";
    else if (eventType === "error") cssClass += " error";
    else if (eventType === "model_output") cssClass += " model-output";

    const detailsId = `details-${this._events.length}`;
    const payloadJson = JSON.stringify(payload, null, 2);

    const eventHtml = `
        <div class="${cssClass}">
            <div class="event-header">
                <span class="step">Step ${step ? step : "-"}</span>
                <span class="timestamp">${timestamp}</span>
                <span class="event-type">${eventType}</span>
                <span class="expandable" onclick="toggleDetails('${detailsId}')">[▼ 详情]</span>
            </div>
            <div id="${detailsId}" class="details">
                <pre>${payloadJson}</pre>
            </div>
        </div>
`;
    fs.writeSync(this.html_fd, eventHtml);
  }

  private _writeHtmlFooter(stats: any): void {
    let toolStatsRows = "";
    const toolNames = Object.keys(stats.tool_calls).sort(
      (a, b) => stats.tool_calls[b] - stats.tool_calls[a]
    );

    for (const toolName of toolNames) {
      toolStatsRows += `<tr><td>${toolName}</td><td>${stats.tool_calls[toolName]}</td></tr>\n`;
    }

    let errorListHtml = "";
    if (stats.errors.length > 0) {
      let errorItems = "";
      for (const error of stats.errors) {
        const step = error.step || "?";
        const errorType = error.type || "UNKNOWN";
        const message = error.message || "";
        errorItems += `<li>Step ${step}: <strong>${errorType}</strong> - ${message}</li>\n`;
      }
      errorListHtml = `
        <h3>❌ 错误列表 (${stats.errors.length})</h3>
        <ul class="error-list">
            ${errorItems}
        </ul>
`;
    }

    const footer = `
    </div>

    <div class="stats-panel">
        <h2>📊 会话统计</h2>
        <div class="stats-grid">
            <div class="stat-item">
                <span class="stat-label">总步骤数</span>
                <span class="stat-value">${stats.total_steps}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">总 Token</span>
                <span class="stat-value">${stats.total_tokens.toLocaleString()}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">总成本</span>
                <span class="stat-value">$${stats.total_cost.toFixed(4)}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">会话时长</span>
                <span class="stat-value">${stats.duration_seconds.toFixed(1)}s</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">模型调用次数</span>
                <span class="stat-value">${stats.model_calls}</span>
            </div>
        </div>

        <h3>🔧 工具调用统计</h3>
        <table class="tool-stats">
            <tr><th>工具名称</th><th>调用次数</th></tr>
            ${
              toolStatsRows
                ? toolStatsRows
                : '<tr><td colspan="2">无工具调用</td></tr>'
            }
        </table>

        ${errorListHtml}
    </div>

    <script>
        function toggleDetails(id) {
            const el = document.getElementById(id);
            if (el.style.display === 'none' || el.style.display === '') {
                el.style.display = 'block';
            } else {
                el.style.display = 'none';
            }
        }
    </script>
</body>
</html>
`;
    fs.writeSync(this.html_fd, footer);
  }
}
