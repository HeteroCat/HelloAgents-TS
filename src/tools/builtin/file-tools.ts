import * as fs from 'fs';
import * as path from 'path';
import { Tool, ToolParameter } from '../base';
import { ToolResponse } from '../response';
import { ToolErrorCode } from '../errors';

/**
 * 文件读取工具
 */
export class ReadTool extends Tool {
    private projectRoot: string;
    private workingDir: string;
    private registry: any;

    constructor(projectRoot: string = ".", workingDir?: string, registry?: any) {
        super(
            "Read",
            "读取文件内容或列出目录内容，支持行号范围和元数据缓存"
        );
        this.projectRoot = path.resolve(projectRoot);
        this.workingDir = workingDir ? path.resolve(workingDir) : this.projectRoot;
        this.registry = registry;
    }

    getParameters(): ToolParameter[] {
        return [
            {
                name: "path",
                type: "string",
                description: "要读取的文件路径或目录路径（相对项目根目录）。如果是目录，将列出目录内容",
                required: true
            },
            {
                name: "offset",
                type: "integer",
                description: "起始行号（从 0 开始，仅读取文件时有效）",
                required: false,
                default: 0
            },
            {
                name: "limit",
                type: "integer",
                description: "最大行数（仅读取文件时有效）",
                required: false,
                default: 2000
            }
        ];
    }

    async run(parameters: Record<string, any>): Promise<ToolResponse> {
        const filePath = parameters.path;
        const offset = parameters.offset || 0;
        const limit = parameters.limit || 2000;

        if (!filePath) {
            return ToolResponse.error(ToolErrorCode.INVALID_PARAM, "缺少必需参数: path");
        }

        try {
            const fullPath = this.resolvePath(filePath);

            if (!fs.existsSync(fullPath)) {
                return ToolResponse.error(ToolErrorCode.NOT_FOUND, `路径 '${filePath}' 不存在`);
            }

            const stats = fs.statSync(fullPath);

            if (stats.isDirectory()) {
                return this.listDirectory(filePath, fullPath);
            }

            // 读取文件
            const content = fs.readFileSync(fullPath, 'utf-8');
            let lines = content.split('\n');
            const totalLines = lines.length;

            if (offset > 0) {
                lines = lines.slice(offset);
            }
            if (limit > 0) {
                lines = lines.slice(0, limit);
            }

            const resultTabs = lines.join('\n');
            const fileMtimeMs = stats.mtimeMs;
            const fileSizeByes = stats.size;

            // 缓存元数据到 ToolRegistry
            if (this.registry && typeof this.registry.cacheReadMetadata === 'function') {
                this.registry.cacheReadMetadata(filePath, {
                    file_mtime_ms: fileMtimeMs,
                    file_size_bytes: fileSizeByes
                });
            }

            return ToolResponse.success(
                `读取 ${lines.length} 行（共 ${totalLines} 行，${fileSizeByes} 字节）`,
                {
                    content: resultTabs,
                    lines: lines.length,
                    total_lines: totalLines,
                    file_mtime_ms: fileMtimeMs,
                    file_size_bytes: fileSizeByes,
                    offset,
                    limit
                }
            );
        } catch (e) {
            return ToolResponse.error(ToolErrorCode.INTERNAL_ERROR, `读取文件失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private listDirectory(dirPath: string, fullPath: string): ToolResponse {
        try {
            const entries: any[] = [];
            let totalFiles = 0;
            let totalDirs = 0;

            const files = fs.readdirSync(fullPath);
            for (const name of files) {
                try {
                    const entryPath = path.join(fullPath, name);
                    const stats = fs.statSync(entryPath);
                    const isDir = stats.isDirectory();

                    if (isDir) totalDirs++;
                    else totalFiles++;

                    const relativePath = path.relative(this.projectRoot, entryPath).replace(/\\/g, '/');

                    entries.push({
                        name,
                        type: isDir ? "directory" : "file",
                        size: isDir ? "<DIR>" : this.formatSize(stats.size),
                        mtime: this.formatTime(stats.mtimeMs),
                        path: relativePath
                    });
                } catch (e) {
                    continue;
                }
            }

            // 排序：目录在前，按名称字母顺序
            entries.sort((a, b) => {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
            });

            let text = `目录 '${dirPath}' 包含 ${totalFiles} 个文件，${totalDirs} 个目录：\n`;
            if (entries.length === 0) {
                text = `目录 '${dirPath}' 为空`;
            } else {
                for (const entry of entries) {
                    const icon = entry.type === 'directory' ? '📁' : '📄';
                    text += `${icon} ${entry.name.padEnd(40)} ${entry.size.padStart(10)} ${entry.mtime}\n`;
                }
            }

            return ToolResponse.success(text, {
                path: dirPath,
                entries,
                total_files: totalFiles,
                total_dirs: totalDirs,
                is_directory: true
            });
        } catch (e) {
            return ToolResponse.error(ToolErrorCode.INTERNAL_ERROR, `列出目录失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private formatSize(size: number): string {
        const units = ['B', 'KB', 'MB', 'GB'];
        let unitIdx = 0;
        while (size >= 1024 && unitIdx < units.length - 1) {
            size /= 1024;
            unitIdx++;
        }
        return `${size.toFixed(1)}${units[unitIdx]}`;
    }

    private formatTime(mtimeMs: number): string {
        return new Date(mtimeMs).toISOString().replace('T', ' ').substring(0, 19);
    }

    private resolvePath(p: string): string {
        p = p.replace(/\\/g, '/');
        if (path.isAbsolute(p)) return p;
        return path.join(this.workingDir, p);
    }
}

/**
 * 文件写入工具
 */
export class WriteTool extends Tool {
    private projectRoot: string;
    private workingDir: string;
    private registry: any;

    constructor(projectRoot: string = ".", workingDir?: string, registry?: any) {
        super(
            "Write",
            "创建或覆盖文件，支持冲突检测和原子写入"
        );
        this.projectRoot = path.resolve(projectRoot);
        this.workingDir = workingDir ? path.resolve(workingDir) : this.projectRoot;
        this.registry = registry;
    }

    getParameters(): ToolParameter[] {
        return [
            {
                name: "path",
                type: "string",
                description: "文件路径（相对项目根目录）",
                required: true
            },
            {
                name: "content",
                type: "string",
                description: "文件内容",
                required: true
            },
            {
                name: "file_mtime_ms",
                type: "integer",
                description: "缓存的文件修改时间（用于冲突检测）",
                required: false
            }
        ];
    }

    async run(parameters: Record<string, any>): Promise<ToolResponse> {
        const filePath = parameters.path;
        const content = parameters.content;
        const cachedMtime = parameters.file_mtime_ms;

        if (!filePath) return ToolResponse.error(ToolErrorCode.INVALID_PARAM, "缺少必需参数: path");
        if (content === undefined || content === null) return ToolResponse.error(ToolErrorCode.INVALID_PARAM, "缺少必需参数: content");

        try {
            const fullPath = this.resolvePath(filePath);
            let backupPath: string | null = null;

            if (fs.existsSync(fullPath)) {
                const stats = fs.statSync(fullPath);
                const currentMtimeMs = stats.mtimeMs;

                if (cachedMtime !== undefined && Math.floor(currentMtimeMs) !== Math.floor(cachedMtime)) {
                    return ToolResponse.error(
                        ToolErrorCode.CONFLICT,
                        `文件自上次读取后被修改。当前 mtime=${currentMtimeMs}, 缓存 mtime=${cachedMtime}`,
                        undefined,
                        { current_mtime_ms: currentMtimeMs, cached_mtime_ms: cachedMtime }
                    );
                }

                backupPath = this.backupFile(fullPath);
            } else {
                fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            }

            // 原子写入
            const tempPath = fullPath + '.tmp';
            fs.writeFileSync(tempPath, content, 'utf-8');
            fs.renameSync(tempPath, fullPath);

            const sizeBytes = Buffer.byteLength(content, 'utf-8');

            return ToolResponse.success(
                `成功写入 ${filePath} (${sizeBytes} 字节)`,
                {
                    written: true,
                    size_bytes: sizeBytes,
                    backup_path: backupPath ? path.relative(this.workingDir, backupPath).replace(/\\/g, '/') : null
                }
            );
        } catch (e) {
            return ToolResponse.error(ToolErrorCode.INTERNAL_ERROR, `写入文件失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private backupFile(fullPath: string): string {
        const backupDir = path.join(path.dirname(fullPath), ".backups");
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:T]/g, '_').substring(0, 19);
        const backupName = `${path.basename(fullPath)}.${timestamp}.bak`;
        const backupPath = path.join(backupDir, backupName);

        fs.copyFileSync(fullPath, backupPath);
        return backupPath;
    }

    private resolvePath(p: string): string {
        if (path.isAbsolute(p)) return p;
        return path.join(this.workingDir, p);
    }
}

/**
 * 文件编辑工具
 */
export class EditTool extends Tool {
    private workingDir: string;

    constructor(projectRoot: string = ".", workingDir?: string) {
        super(
            "Edit",
            "精确替换文件内容，支持冲突检测和自动备份"
        );
        const root = path.resolve(projectRoot);
        this.workingDir = workingDir ? path.resolve(workingDir) : root;
    }

    getParameters(): ToolParameter[] {
        return [
            {
                name: "path",
                type: "string",
                description: "要编辑的文件路径（相对项目根目录）",
                required: true
            },
            {
                name: "old_string",
                type: "string",
                description: "要替换的内容（必须唯一匹配）",
                required: true
            },
            {
                name: "new_string",
                type: "string",
                description: "替换后的内容",
                required: true
            },
            {
                name: "file_mtime_ms",
                type: "integer",
                description: "缓存的文件修改时间（用于冲突检测）",
                required: false
            }
        ];
    }

    async run(parameters: Record<string, any>): Promise<ToolResponse> {
        const filePath = parameters.path;
        const oldString = parameters.old_string;
        const newString = parameters.new_string;
        const cachedMtime = parameters.file_mtime_ms;

        if (!filePath) return ToolResponse.error(ToolErrorCode.INVALID_PARAM, "缺少必需参数: path");
        if (oldString === undefined) return ToolResponse.error(ToolErrorCode.INVALID_PARAM, "缺少必需参数: old_string");
        if (newString === undefined) return ToolResponse.error(ToolErrorCode.INVALID_PARAM, "缺少必需参数: new_string");

        try {
            const fullPath = this.resolvePath(filePath);

            if (!fs.existsSync(fullPath)) {
                return ToolResponse.error(ToolErrorCode.NOT_FOUND, `文件 '${filePath}' 不存在`);
            }

            const stats = fs.statSync(fullPath);
            const currentMtimeMs = stats.mtimeMs;

            if (cachedMtime !== undefined && Math.floor(currentMtimeMs) !== Math.floor(cachedMtime)) {
                return ToolResponse.error(
                    ToolErrorCode.CONFLICT,
                    `文件自上次读取后被修改。当前 mtime=${currentMtimeMs}, 缓存 mtime=${cachedMtime}`,
                    undefined,
                    { current_mtime_ms: currentMtimeMs, cached_mtime_ms: cachedMtime }
                );
            }

            let content = fs.readFileSync(fullPath, 'utf-8');

            // 检查 old_string 是否唯一匹配
            const matches = content.split(oldString).length - 1;
            if (matches !== 1) {
                return ToolResponse.error(
                    ToolErrorCode.INVALID_PARAM,
                    `old_string 必须唯一匹配文件内容。找到 ${matches} 处匹配。`,
                    undefined,
                    { matches }
                );
            }

            const backupPath = this.backupFile(fullPath);
            const newContent = content.replace(oldString, newString);
            fs.writeFileSync(fullPath, newContent, 'utf-8');

            const changedBytes = Buffer.byteLength(newString, 'utf-8') - Buffer.byteLength(oldString, 'utf-8');

            return ToolResponse.success(
                `成功编辑 ${filePath} (变化 ${changedBytes >= 0 ? '+' : ''}${changedBytes} 字节)`,
                {
                    modified: true,
                    changed_bytes: changedBytes,
                    backup_path: path.relative(this.workingDir, backupPath).replace(/\\/g, '/')
                }
            );
        } catch (e) {
            return ToolResponse.error(ToolErrorCode.INTERNAL_ERROR, `编辑文件失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private backupFile(fullPath: string): string {
        const backupDir = path.join(path.dirname(fullPath), ".backups");
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:T]/g, '_').substring(0, 19);
        const backupName = `${path.basename(fullPath)}.${timestamp}.bak`;
        const backupPath = path.join(backupDir, backupName);

        fs.copyFileSync(fullPath, backupPath);
        return backupPath;
    }

    private resolvePath(p: string): string {
        if (path.isAbsolute(p)) return p;
        return path.join(this.workingDir, p);
    }
}

/**
 * 批量编辑工具
 */
export class MultiEditTool extends Tool {
    private workingDir: string;

    constructor(projectRoot: string = ".", workingDir?: string) {
        super(
            "MultiEdit",
            "批量替换文件内容，支持原子性和冲突检测"
        );
        const root = path.resolve(projectRoot);
        this.workingDir = workingDir ? path.resolve(workingDir) : root;
    }

    getParameters(): ToolParameter[] {
        return [
            {
                name: "path",
                type: "string",
                description: "要编辑的文件路径（相对项目根目录）",
                required: true
            },
            {
                name: "edits",
                type: "array",
                description: "替换列表，每项包含 old_string 和 new_string",
                required: true
            },
            {
                name: "file_mtime_ms",
                type: "integer",
                description: "缓存的文件修改时间（用于冲突检测）",
                required: false
            }
        ];
    }

    async run(parameters: Record<string, any>): Promise<ToolResponse> {
        const filePath = parameters.path;
        const edits = parameters.edits;
        const cachedMtime = parameters.file_mtime_ms;

        if (!filePath) return ToolResponse.error(ToolErrorCode.INVALID_PARAM, "缺少必需参数: path");
        if (!Array.isArray(edits)) return ToolResponse.error(ToolErrorCode.INVALID_PARAM, "缺少必需参数: edits（必须是列表）");

        try {
            const fullPath = this.resolvePath(filePath);

            if (!fs.existsSync(fullPath)) {
                return ToolResponse.error(ToolErrorCode.NOT_FOUND, `文件 '${filePath}' 不存在`);
            }

            const stats = fs.statSync(fullPath);
            const currentMtimeMs = stats.mtimeMs;

            if (cachedMtime !== undefined && Math.floor(currentMtimeMs) !== Math.floor(cachedMtime)) {
                return ToolResponse.error(
                    ToolErrorCode.CONFLICT,
                    `文件自上次读取后被修改。所有替换已取消。当前 mtime=${currentMtimeMs}, 缓存 mtime=${cachedMtime}`,
                    undefined,
                    { current_mtime_ms: currentMtimeMs, cached_mtime_ms: cachedMtime }
                );
            }

            let content = fs.readFileSync(fullPath, 'utf-8');
            const originalContent = content;

            // 验证所有替换操作
            for (let i = 0; i < edits.length; i++) {
                const edit = edits[i];
                const oldString = edit.old_string;
                const newString = edit.new_string;

                if (oldString === undefined || newString === undefined) {
                    return ToolResponse.error(ToolErrorCode.INVALID_PARAM, `编辑项 ${i} 缺少 old_string 或 new_string`);
                }

                const matches = content.split(oldString).length - 1;
                if (matches !== 1) {
                    return ToolResponse.error(
                        ToolErrorCode.INVALID_PARAM,
                        `编辑项 ${i}: old_string 必须唯一匹配。找到 ${matches} 处匹配。`,
                        undefined,
                        { edit_index: i, matches }
                    );
                }
                
                // 为了保证原子性，我们先在副本上验证
                content = content.replace(oldString, newString);
            }

            const backupPath = this.backupFile(fullPath);
            fs.writeFileSync(fullPath, content, 'utf-8');

            const changedBytes = Buffer.byteLength(content, 'utf-8') - Buffer.byteLength(originalContent, 'utf-8');

            return ToolResponse.success(
                `成功执行 ${edits.length} 个替换操作 (变化 ${changedBytes >= 0 ? '+' : ''}${changedBytes} 字节)`,
                {
                    modified: true,
                    num_edits: edits.length,
                    changed_bytes: changedBytes,
                    backup_path: path.relative(this.workingDir, backupPath).replace(/\\/g, '/')
                }
            );
        } catch (e) {
            return ToolResponse.error(ToolErrorCode.INTERNAL_ERROR, `批量编辑失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private backupFile(fullPath: string): string {
        const backupDir = path.join(path.dirname(fullPath), ".backups");
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:T]/g, '_').substring(0, 19);
        const backupName = `${path.basename(fullPath)}.${timestamp}.bak`;
        const backupPath = path.join(backupDir, backupName);

        fs.copyFileSync(fullPath, backupPath);
        return backupPath;
    }

    private resolvePath(p: string): string {
        if (path.isAbsolute(p)) return p;
        return path.join(this.workingDir, p);
    }
}
