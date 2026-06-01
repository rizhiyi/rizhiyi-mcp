import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { SharedResultEnvelope, SharedResultKind, SharedResultSummary } from './types.js';

const DEFAULT_TTL_SECONDS = 30 * 60;
const DEFAULT_INLINE_MAX_BYTES = 24 * 1024;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_STORE_DIR = path.join(tmpdir(), 'rizhiyi-mcp', 'log-tool-results');
const SHARED_RESULT_RESOURCE_PROTOCOL = 'logease:';
const SHARED_RESULT_RESOURCE_HOST = 'shared-result';
const SHARED_RESULT_RESOURCE_MIME_TYPE = 'application/json';
const EXPIRED_MARKER_SUFFIX = '.expired.json';

export class SharedResultStoreError extends Error {
    constructor(
        public readonly code: 'INVALID_RESOURCE_URI' | 'HANDLE_NOT_FOUND' | 'HANDLE_EXPIRED' | 'PAYLOAD_TOO_LARGE',
        message: string
    ) {
        super(message);
        this.name = 'SharedResultStoreError';
    }
}

export interface SharedResultStoreConfig {
    storeDir: string;
    defaultTtlSeconds: number;
    inlineMaxBytes: number;
    maxFileBytes: number;
}

export interface SaveSharedResultInput {
    toolName: string;
    resultKind: SharedResultKind;
    payload: unknown;
    summary: SharedResultSummary;
    sourceQuery?: string;
    timeRange?: string;
    indexName?: string;
    upstreamSid?: string;
    ttlSeconds?: number;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getSharedResultStoreConfig(): SharedResultStoreConfig {
    return {
        storeDir: process.env.LOG_TOOLS_RESULT_STORE_DIR || DEFAULT_STORE_DIR,
        defaultTtlSeconds: parsePositiveInteger(process.env.LOG_TOOLS_RESULT_TTL_SECONDS, DEFAULT_TTL_SECONDS),
        inlineMaxBytes: parsePositiveInteger(process.env.LOG_TOOLS_RESULT_INLINE_MAX_BYTES, DEFAULT_INLINE_MAX_BYTES),
        maxFileBytes: parsePositiveInteger(process.env.LOG_TOOLS_RESULT_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES)
    };
}

function buildFilePath(storeDir: string, handle: string): string {
    return path.join(storeDir, `${handle}.json`);
}

function buildExpiredMarkerPath(storeDir: string, handle: string): string {
    return path.join(storeDir, `${handle}${EXPIRED_MARKER_SUFFIX}`);
}

function isActiveEnvelopeFileName(fileName: string): boolean {
    return fileName.endsWith('.json') && !fileName.endsWith(EXPIRED_MARKER_SUFFIX);
}

export function buildSharedResultResourceUri(handle: string): string {
    assertValidHandle(handle);
    return `${SHARED_RESULT_RESOURCE_PROTOCOL}//${SHARED_RESULT_RESOURCE_HOST}/${handle}`;
}

function buildSharedResultResourceTitle(
    toolName: string | undefined,
    summary: SharedResultSummary | undefined,
    handle: string
): string {
    const baseTitle = summary?.title?.trim() || `${toolName || 'shared_result'} 结果`;
    return `${baseTitle} [${handle.slice(0, 8)}]`;
}

function assertValidHandle(handle: string): void {
    if (!/^[a-zA-Z0-9_-]{8,}$/.test(handle)) {
        throw new SharedResultStoreError('INVALID_RESOURCE_URI', '共享资源 URI 中的 handle 格式不合法。');
    }
}

function resolveHandleReference(reference: string): string {
    if (!reference.includes('://')) {
        throw new SharedResultStoreError('INVALID_RESOURCE_URI', '请传入共享资源 URI（resource_uri）。');
    }

    try {
        const parsed = new URL(reference);
        if (parsed.protocol !== SHARED_RESULT_RESOURCE_PROTOCOL || parsed.hostname !== SHARED_RESULT_RESOURCE_HOST) {
            throw new SharedResultStoreError('INVALID_RESOURCE_URI', '共享资源 URI 格式不合法。');
        }
        const handle = parsed.pathname.replace(/^\/+/, '');
        assertValidHandle(handle);
        return handle;
    } catch (error) {
        if (error instanceof SharedResultStoreError) {
            throw error;
        }
        throw new SharedResultStoreError('INVALID_RESOURCE_URI', '共享资源 URI 格式不合法。');
    }
}

function normalizeSharedResultEnvelope(envelope: SharedResultEnvelope): SharedResultEnvelope {
    return {
        ...envelope,
        resource_uri: envelope.resource_uri || buildSharedResultResourceUri(envelope.handle),
        resource_title: envelope.resource_title || buildSharedResultResourceTitle(envelope.tool_name, envelope.summary, envelope.handle),
        resource_type: envelope.resource_type || envelope.result_kind,
        resource_mime_type: envelope.resource_mime_type || SHARED_RESULT_RESOURCE_MIME_TYPE
    };
}

async function ensureStoreDir(storeDir: string): Promise<void> {
    await fs.mkdir(storeDir, { recursive: true });
}

async function safeReadEnvelope(filePath: string): Promise<SharedResultEnvelope | null> {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return normalizeSharedResultEnvelope(JSON.parse(content) as SharedResultEnvelope);
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

async function hasExpiredMarker(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

async function removeFileIfExists(filePath: string): Promise<void> {
    try {
        await fs.unlink(filePath);
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }
}

function isExpired(envelope: SharedResultEnvelope, now = Date.now()): boolean {
    return new Date(envelope.expires_at).getTime() <= now;
}

async function markExpiredResult(
    handle: string,
    envelope: SharedResultEnvelope | null,
    config: SharedResultStoreConfig
): Promise<void> {
    const filePath = buildFilePath(config.storeDir, handle);
    const markerPath = buildExpiredMarkerPath(config.storeDir, handle);
    const expiredAt = envelope?.expires_at || new Date().toISOString();

    await fs.writeFile(markerPath, JSON.stringify({
        handle,
        resource_uri: envelope?.resource_uri || buildSharedResultResourceUri(handle),
        expired_at: expiredAt
    }, null, 2), 'utf8');
    await removeFileIfExists(filePath);
}

async function loadSharedResultState(
    handleOrResourceUri: string,
    config: SharedResultStoreConfig
): Promise<{
    handle: string;
    filePath: string;
    markerPath: string;
    envelope: SharedResultEnvelope | null;
    status: 'active' | 'expired' | 'missing';
}> {
    const handle = resolveHandleReference(handleOrResourceUri);
    const filePath = buildFilePath(config.storeDir, handle);
    const markerPath = buildExpiredMarkerPath(config.storeDir, handle);
    const envelope = await safeReadEnvelope(filePath);

    if (envelope) {
        if (isExpired(envelope)) {
            await markExpiredResult(handle, envelope, config);
            return { handle, filePath, markerPath, envelope: null, status: 'expired' };
        }
        return { handle, filePath, markerPath, envelope, status: 'active' };
    }

    if (await hasExpiredMarker(markerPath)) {
        return { handle, filePath, markerPath, envelope: null, status: 'expired' };
    }

    return { handle, filePath, markerPath, envelope: null, status: 'missing' };
}

export async function cleanupExpiredResults(config: SharedResultStoreConfig = getSharedResultStoreConfig()): Promise<void> {
    await ensureStoreDir(config.storeDir);
    const now = Date.now();
    const entries = await fs.readdir(config.storeDir, { withFileTypes: true });

    await Promise.all(entries.map(async (entry) => {
        if (!entry.isFile() || !isActiveEnvelopeFileName(entry.name)) {
            return;
        }

        const filePath = path.join(config.storeDir, entry.name);
        const envelope = await safeReadEnvelope(filePath);
        if (!envelope) {
            await removeFileIfExists(filePath);
            return;
        }

        if (isExpired(envelope, now)) {
            await markExpiredResult(envelope.handle, envelope, config);
        }
    }));
}

export async function saveSharedResult(
    input: SaveSharedResultInput,
    config: SharedResultStoreConfig = getSharedResultStoreConfig()
): Promise<SharedResultEnvelope> {
    await cleanupExpiredResults(config);
    await ensureStoreDir(config.storeDir);

    const ttlSeconds = input.ttlSeconds && input.ttlSeconds > 0
        ? Math.floor(input.ttlSeconds)
        : config.defaultTtlSeconds;
    const handle = randomUUID().replace(/-/g, '');
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);
    const payloadBytes = Buffer.byteLength(JSON.stringify(input.payload ?? null), 'utf8');
    const resourceUri = buildSharedResultResourceUri(handle);

    if (payloadBytes > config.maxFileBytes) {
        throw new SharedResultStoreError(
            'PAYLOAD_TOO_LARGE',
            `共享结果大小 ${payloadBytes} bytes 超过上限 ${config.maxFileBytes} bytes。`
        );
    }

    const envelope: SharedResultEnvelope = {
        handle,
        resource_uri: resourceUri,
        resource_title: buildSharedResultResourceTitle(input.toolName, input.summary, handle),
        resource_type: input.resultKind,
        resource_mime_type: SHARED_RESULT_RESOURCE_MIME_TYPE,
        created_at: createdAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        tool_name: input.toolName,
        result_kind: input.resultKind,
        source_query: input.sourceQuery,
        time_range: input.timeRange,
        index_name: input.indexName,
        upstream_sid: input.upstreamSid,
        payload_bytes: payloadBytes,
        summary: input.summary,
        payload: input.payload
    };

    await fs.writeFile(buildFilePath(config.storeDir, handle), JSON.stringify(envelope, null, 2), 'utf8');
    return envelope;
}

export async function readSharedResult(
    resourceUri: string,
    config: SharedResultStoreConfig = getSharedResultStoreConfig()
): Promise<SharedResultEnvelope> {
    await ensureStoreDir(config.storeDir);
    const state = await loadSharedResultState(resourceUri, config);
    if (state.status === 'missing') {
        throw new SharedResultStoreError('HANDLE_NOT_FOUND', '共享结果不存在，可能已被删除或尚未生成。');
    }

    if (state.status === 'expired') {
        throw new SharedResultStoreError('HANDLE_EXPIRED', '共享结果已过期，请重新执行源工具。');
    }

    if (!state.envelope) {
        throw new SharedResultStoreError('HANDLE_NOT_FOUND', '共享结果不存在，可能已被删除或尚未生成。');
    }

    return state.envelope;
}

export async function listSharedResults(
    config: SharedResultStoreConfig = getSharedResultStoreConfig()
): Promise<SharedResultEnvelope[]> {
    await cleanupExpiredResults(config);
    await ensureStoreDir(config.storeDir);

    const entries = await fs.readdir(config.storeDir, { withFileTypes: true });
    const envelopes = await Promise.all(entries.map(async (entry) => {
        if (!entry.isFile() || !isActiveEnvelopeFileName(entry.name)) {
            return null;
        }

        return safeReadEnvelope(path.join(config.storeDir, entry.name));
    }));

    return envelopes
        .filter((envelope): envelope is SharedResultEnvelope => Boolean(envelope))
        .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

export async function deleteSharedResult(
    resourceUri: string,
    config: SharedResultStoreConfig = getSharedResultStoreConfig()
): Promise<boolean> {
    await ensureStoreDir(config.storeDir);
    const state = await loadSharedResultState(resourceUri, config);

    if (state.status === 'missing') {
        return false;
    }

    if (state.status === 'expired') {
        throw new SharedResultStoreError('HANDLE_EXPIRED', '共享结果已过期，无需重复删除，请重新执行源工具。');
    }

    await removeFileIfExists(state.filePath);
    await removeFileIfExists(state.markerPath);
    return true;
}
