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

export class UsageLogger {
    private pending: Promise<void> = Promise.resolve();
    private active?: ActiveLogFile;

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
        const active = await this.resolveActiveFile(now, Buffer.byteLength(line, 'utf8'));
        await appendFile(active.path, line, { encoding: 'utf8', flag: 'a' });
        await this.cleanupOldFiles(active.path);
    }

    private async resolveActiveFile(now: Date, lineBytes: number): Promise<ActiveLogFile> {
        const dateKey = formatLocalDate(now);
        const bucketKey = this.config.rotateBytes > 0
            ? dateKey
            : formatTimeBucket(now, this.config.rotateInterval);
        const files = await this.listLogFiles();

        if (this.active?.bucketKey === bucketKey) {
            const activeFile = files.find((file) => file.path === this.active?.path);
            if (
                activeFile
                && (this.config.rotateBytes <= 0 || activeFile.size === 0 || activeFile.size + lineBytes <= this.config.rotateBytes)
            ) {
                return this.active;
            }
        }

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
        let names: string[];
        try {
            names = await readdir(this.config.directory);
        } catch (error: any) {
            if (error?.code === 'ENOENT') {
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

        return files.filter((file): file is LogFile => Boolean(file));
    }

    private async cleanupOldFiles(activePath: string): Promise<void> {
        const files = (await this.listLogFiles()).sort(compareLogFiles);
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
