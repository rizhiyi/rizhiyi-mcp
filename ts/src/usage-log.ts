import path from 'node:path';
import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';

export type UsageLogRotateInterval = '1d' | '1h';
export type UsageLogStatus = 'ok' | 'ok-limited' | 'error';

export interface UsageLogConfig {
    directory: string;
    namePrefix: string;
    rotateBytes: number;
    rotateInterval: UsageLogRotateInterval;
    keepFiles: number;
}

export interface UsageLogEntry {
    ts: string;
    epoch_ms: number;
    session_id: string | null;
    serverName: string;
    tool: string;
    routeName: string;
    status: UsageLogStatus;
    duration_ms: number;
    user: string | null;
    error_code: string | null;
    guardrail_action?: string | null;
    guardrail_risk_score?: number | null;
    guardrail_denied_commands?: string[];
}

interface LogFile {
    name: string;
    path: string;
    dateKey: string;
    sequence: number;
    size: number;
    modifiedMs: number;
}

interface ActiveLogFile {
    bucketKey: string;
    path: string;
}

interface FileCache {
    dirMtimeMs: number;
    files: LogFile[];
}

// 清理降频阈值：没有超额文件时，最多每 N 次写入或每 60s 执行一次清理。
const CLEANUP_EVERY_WRITES = 50;
const CLEANUP_MIN_INTERVAL_MS = 60_000;

export class UsageLogger {
    private pending: Promise<void> = Promise.resolve();
    private active?: ActiveLogFile;
    private fileCache?: FileCache;
    private writesSinceCleanup = 0;
    private lastCleanupMs?: number;

    constructor(
        readonly config: UsageLogConfig,
        private readonly clock: () => Date = () => new Date()
    ) {}

    write(entry: UsageLogEntry): Promise<void> {
        const task = this.pending.then(() => this.appendEntry(entry));
        this.pending = task.catch(() => undefined);
        return task;
    }

    private async appendEntry(entry: UsageLogEntry): Promise<void> {
        await mkdir(this.config.directory, { recursive: true });
        const line = `${JSON.stringify(entry)}\n`;
        const now = this.clock();
        const lineBytes = Buffer.byteLength(line, 'utf8');
        const active = await this.resolveActiveFile(now, lineBytes);
        await appendFile(active.path, line, { encoding: 'utf8', flag: 'a' });
        this.noteAppended(active.path, lineBytes, now);
        await this.cleanupOldFiles(active.path, now);
    }

    private async resolveActiveFile(now: Date, lineBytes: number): Promise<ActiveLogFile> {
        const dateKey = formatLocalDate(now);
        const bucketKey = this.config.rotateBytes > 0
            ? dateKey
            : formatTimeBucket(now, this.config.rotateInterval);

        // 快路径：active 缓存命中且文件缓存新鲜时直接复用，无需任何目录扫描。
        // 缓存按目录 mtime 失效，因此外部进程新建文件后这里会自然回退到慢路径。
        if (this.active?.bucketKey === bucketKey) {
            const cached = await this.cachedFile(this.active.path);
            if (
                cached
                && (this.config.rotateBytes <= 0 || cached.size === 0 || cached.size + lineBytes <= this.config.rotateBytes)
            ) {
                return this.active;
            }
        }

        const files = await this.listLogFiles();
        const todayFiles = files
            .filter((file) => file.dateKey === dateKey)
            .sort(compareLogFiles);
        const latest = todayFiles.at(-1);

        if (this.config.rotateBytes > 0) {
            if (!latest) {
                this.active = { bucketKey, path: this.filePath(dateKey, 0) };
            } else if (latest.size === 0 || latest.size + lineBytes <= this.config.rotateBytes) {
                this.active = { bucketKey, path: latest.path };
            } else {
                this.active = { bucketKey, path: this.filePath(dateKey, latest.sequence + 1) };
            }
            return this.active;
        }

        if (!latest) {
            this.active = { bucketKey, path: this.filePath(dateKey, 0) };
        } else if (formatTimeBucket(new Date(latest.modifiedMs), this.config.rotateInterval) === bucketKey) {
            this.active = { bucketKey, path: latest.path };
        } else {
            this.active = { bucketKey, path: this.filePath(dateKey, latest.sequence + 1) };
        }
        return this.active;
    }

    private async listLogFiles(): Promise<LogFile[]> {
        const dirMtimeMs = await this.directoryMtimeMs();
        if (typeof dirMtimeMs === 'undefined') {
            this.fileCache = undefined;
            return [];
        }
        if (this.fileCache && this.fileCache.dirMtimeMs === dirMtimeMs) {
            return this.fileCache.files;
        }

        let names: string[];
        try {
            names = await readdir(this.config.directory);
        } catch (error: any) {
            if (error?.code === 'ENOENT') {
                this.fileCache = undefined;
                return [];
            }
            throw error;
        }

        const pattern = new RegExp(`^${escapeRegExp(this.config.namePrefix)}-(\\d{8})(?:\\.(\\d+))?\\.log$`);
        const files = await Promise.all(names.map(async (name): Promise<LogFile | undefined> => {
            const match = pattern.exec(name);
            if (!match) {
                return undefined;
            }
            const filePath = path.join(this.config.directory, name);
            const info = await stat(filePath);
            if (!info.isFile()) {
                return undefined;
            }
            return {
                name,
                path: filePath,
                dateKey: match[1],
                sequence: match[2] ? Number(match[2]) : 0,
                size: info.size,
                modifiedMs: info.mtimeMs
            };
        }));

        const result = files.filter((file): file is LogFile => Boolean(file));
        this.fileCache = { dirMtimeMs, files: result };
        return result;
    }

    private async directoryMtimeMs(): Promise<number | undefined> {
        try {
            const info = await stat(this.config.directory);
            return info.mtimeMs;
        } catch (error: any) {
            if (error?.code === 'ENOENT') {
                return undefined;
            }
            throw error;
        }
    }

    // 仅在文件缓存新鲜（目录 mtime 未变）时返回指定文件的缓存元数据，否则返回 undefined。
    private async cachedFile(filePath: string): Promise<LogFile | undefined> {
        const dirMtimeMs = await this.directoryMtimeMs();
        if (typeof dirMtimeMs === 'undefined' || !this.fileCache || this.fileCache.dirMtimeMs !== dirMtimeMs) {
            return undefined;
        }
        return this.fileCache.files.find((file) => file.path === filePath);
    }

    // 写入后更新缓存中的文件大小，避免快路径基于过期大小重复追加导致超出 rotateBytes。
    private noteAppended(filePath: string, lineBytes: number, now: Date): void {
        if (!this.fileCache) {
            return;
        }
        const entry = this.fileCache.files.find((file) => file.path === filePath);
        if (entry) {
            entry.size += lineBytes;
            entry.modifiedMs = now.getTime();
        }
        // 新建文件会改变目录 mtime，缓存自然失效，下一轮 listLogFiles 会重新扫描。
    }

    private async cleanupOldFiles(activePath: string, now: Date): Promise<void> {
        const files = [...(await this.listLogFiles())].sort(compareLogFiles);
        this.writesSinceCleanup += 1;
        if (!this.shouldRunCleanup(files.length, now)) {
            return;
        }

        let excess = files.length - this.config.keepFiles;
        for (const file of files) {
            if (excess <= 0) {
                break;
            }
            if (file.path === activePath) {
                continue;
            }
            try {
                await unlink(file.path);
                excess -= 1;
            } catch (error: any) {
                if (error?.code !== 'ENOENT') {
                    throw error;
                }
            }
        }
        this.writesSinceCleanup = 0;
        this.lastCleanupMs = now.getTime();
        // 删除改变了目录，缓存失效。
        this.fileCache = undefined;
    }

    private shouldRunCleanup(fileCount: number, now: Date): boolean {
        if (fileCount > this.config.keepFiles) {
            // 存在超额文件时立即清理，保证 keepFiles 语义不被降频破坏。
            return true;
        }
        if (this.writesSinceCleanup >= CLEANUP_EVERY_WRITES) {
            return true;
        }
        return typeof this.lastCleanupMs === 'number'
            && now.getTime() - this.lastCleanupMs >= CLEANUP_MIN_INTERVAL_MS;
    }

    private filePath(dateKey: string, sequence: number): string {
        const suffix = sequence > 0 ? `.${sequence}` : '';
        return path.join(this.config.directory, `${this.config.namePrefix}-${dateKey}${suffix}.log`);
    }
}

export function createUsageLogEntry(input: Omit<UsageLogEntry, 'ts' | 'epoch_ms'>, now = new Date()): UsageLogEntry {
    return {
        ts: now.toISOString(),
        epoch_ms: now.getTime(),
        ...input
    };
}

function formatLocalDate(value: Date): string {
    return `${value.getFullYear()}${pad2(value.getMonth() + 1)}${pad2(value.getDate())}`;
}

function formatTimeBucket(value: Date, interval: UsageLogRotateInterval): string {
    const dateKey = formatLocalDate(value);
    return interval === '1h' ? `${dateKey}${pad2(value.getHours())}` : dateKey;
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

function compareLogFiles(left: LogFile, right: LogFile): number {
    return left.dateKey.localeCompare(right.dateKey)
        || left.sequence - right.sequence
        || left.modifiedMs - right.modifiedMs
        || left.name.localeCompare(right.name);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
