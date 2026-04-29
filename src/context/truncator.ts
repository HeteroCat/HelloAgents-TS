import * as fs from 'fs';
import * as path from 'path';

/**
 * ObservationTruncator - Tool output truncator.
 * 
 * Responsibilities:
 * - Unified truncation for tool outputs
 * - Support multiple truncation directions (head/tail/head_tail)
 * - Save full output to a file
 */
export class ObservationTruncator {
  maxLines: number;
  maxBytes: number;
  truncateDirection: string;
  outputDir: string;

  /**
   * Initialize Truncator
   * 
   * @param maxLines Maximum lines to keep
   * @param maxBytes Maximum bytes to keep
   * @param truncateDirection Truncation direction (head/tail/head_tail)
   * @param outputDir Directory for saving full outputs
   */
  constructor(
    maxLines: number = 2000,
    maxBytes: number = 51200,
    truncateDirection: string = 'head',
    outputDir: string = 'tool-output'
  ) {
    this.maxLines = maxLines;
    this.maxBytes = maxBytes;
    this.truncateDirection = truncateDirection;
    this.outputDir = outputDir;

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Truncate tool output.
   * 
   * @param toolName Tool name
   * @param output Original output string
   * @param metadata Optional metadata
   * @returns Result with truncation info
   */
  truncate(
    toolName: string,
    output: string,
    metadata: Record<string, any> | null = null
  ): Record<string, any> {
    const start = Date.now();
    const lines = output.split(/\r?\n/);
    const bytesSize = Buffer.from(output).byteLength;

    // Check if truncation is needed
    if (lines.length <= this.maxLines && bytesSize <= this.maxBytes) {
      return {
        truncated: false,
        preview: output,
        fullOutputPath: null,
        stats: {
          originalLines: lines.length,
          originalBytes: bytesSize,
          timeMs: Date.now() - start
        }
      };
    }

    // Truncate lines
    const truncatedLines = this._truncateLines(lines);
    const preview = truncatedLines.join('\n');
    const truncatedBytes = Buffer.from(preview).byteLength;

    // Save full output
    const outputPath = this._saveFullOutput(toolName, output, metadata);

    return {
      truncated: true,
      preview: preview,
      fullOutputPath: outputPath,
      stats: {
        direction: this.truncateDirection,
        originalLines: lines.length,
        originalBytes: bytesSize,
        keptLines: truncatedLines.length,
        keptBytes: truncatedBytes,
        timeMs: Date.now() - start
      }
    };
  }

  /**
   * Truncate lines according to direction.
   * 
   * @param lines Original list of lines
   * @returns Truncated list of lines
   */
  private _truncateLines(lines: string[]): string[] {
    if (this.truncateDirection === 'head') {
      return lines.slice(0, this.maxLines);
    } else if (this.truncateDirection === 'tail') {
      return lines.slice(-this.maxLines);
    } else if (this.truncateDirection === 'head_tail') {
      const half = Math.floor(this.maxLines / 2);
      if (lines.length > this.maxLines) {
        return [...lines.slice(0, half), '...(中间省略)...', ...lines.slice(-half)];
      } else {
        return lines;
      }
    } else {
      // Default: head
      return lines.slice(0, this.maxLines);
    }
  }

  /**
   * Save full output to a JSON file.
   * 
   * @param toolName Tool name
   * @param output Full output content
   * @param metadata Metadata
   * @returns Path of the saved file
   */
  private _saveFullOutput(
    toolName: string,
    output: string,
    metadata: Record<string, any> | null = null
  ): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `tool_${timestamp}_${toolName}.json`;
    const filepath = path.join(this.outputDir, filename);

    const data = {
      tool: toolName,
      output: output,
      timestamp: new Date().toISOString(),
      metadata: metadata || {}
    };

    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');

    return filepath;
  }
}
