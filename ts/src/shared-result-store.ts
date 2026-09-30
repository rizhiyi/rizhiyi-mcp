import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { ANALYSIS_CONSTANTS } from './modules/analysis-constants.js';
import type { SharedResultEnvelope, SharedResultKind, SharedResultSummary } from './types.js';
import { applyOutputGuardrails, type GuardrailConfig } from './spl-guardrails.js';

const DEFAULT_TTL_SECONDS = 30 * 60;
const DEFAULT_INLINE_MAX_BYTES = 24 * 1024;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_STORE_DIR = path.join(tmpdir(), 'rizhiyi-mcp', 'log-tool-results');
const SHARED_RESULT_RESOURCE_PROTOCOL = 'logease:';
const SHARED_RESULT_RESOURCE_HOST = 'shared-result';
const SHARED_RESULT_RESOURCE_MIME_TYPE = 'application/json';
const EXPIRED_MARKER_SUFFIX = '.expired.json';

/**
 * 结果文件名格式（TS / Python 逐字节一致，契约见 config/shared-store-parity.golden.json）：
 *   `<expiresAtEpochMilliseconds>-<handle>.json`
 *
 * 过期时间编码进文件名后，清理路径只需比对文件名即可判定过期，无需读取、解析每个文件
 * （见 CODE_REVIEW.md M2）。使用 **毫秒** 而非秒，是为了让按文件名判定的过期时刻与真实
 * `expires_at` 的误差 < 1ms，从而不影响「刚过期即从列表消失」这类精度敏感的语义。
 * `handle` 沿用生成时的 `[a-zA-Z0-9_-]{8,}` 形态。
 *
 * 旧格式（无过期前缀）文件仍然可读：清理 / 列表 / 读取都会降级到「读取内容再判断」的慢路径。
 */
const SHARED_RESULT_FILE_NAME_PATTERN = /^(\d{13,})-([A-Za-z0-9_-]{8,})\.json$/;

const CLEANUP_INTERVAL_MS = ANALYSIS_CONSTANTS.sharedResultStore.cleanupIntervalSeconds * 1000;
const CORRUPT_DIR_NAME = ANALYSIS_CONSTANTS.sharedResultStore.corruptDirName;

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
    guardrailConfig?: GuardrailConfig;
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

/**
 * 生成新格式结果文件名。与 Python `build_shared_result_file_name` 行为一致。
 */
export function buildSharedResultFileName(expiresAtEpochMilliseconds: number, handle: string): string {
    return `${expiresAtEpochMilliseconds}-${handle}.json`;
}

/**
 * 解析新格式结果文件名，非新格式（旧格式 / 过期标记 / 其它文件）返回 null。
 * 与 Python `parse_shared_result_file_name` 行为一致。
 */
export function parseSharedResultFileName(
    fileName: string
): { expiresAtEpochMilliseconds: number; handle: string } | null {
    const match = SHARED_RESULT_FILE_NAME_PATTERN.exec(fileName);
    if (!match) {
        return null;
    }
    return { expiresAtEpochMilliseconds: Number(match[1]), handle: match[2] };
}

function buildActiveFilePath(storeDir: string, expiresAtEpochMilliseconds: number, handle: string): string {
    return path.join(storeDir, buildSharedResultFileName(expiresAtEpochMilliseconds, handle));
}

/** 旧格式路径：`<handle>.json`，仅在读取历史文件时使用。 */
function buildLegacyFilePath(storeDir: string, handle: string): string {
    return path.join(storeDir, `${handle}.json`);
}

function buildExpiredMarkerPath(storeDir: string, handle: string): string {
    return path.join(storeDir, `${handle}${EXPIRED_MARKER_SUFFIX}`);
}

function buildCorruptDir(storeDir: string): string {
    return path.join(storeDir, CORRUPT_DIR_NAME);
}

function isExpiredMarkerFileName(fileName: string): boolean {
    return fileName.endsWith(EXPIRED_MARKER_SUFFIX);
}

/**
 * 是否为候选「结果文件」：以 `.json` 结尾且不是过期标记。
 * 新格式与旧格式都返回 true，由调用方决定走快路径还是慢路径。
 */
function isActiveEnvelopeFileName(fileName: string): boolean {
    return fileName.endsWith('.json') && !isExpiredMarkerFileName(fileName);
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

/**
 * 校验解析出来的内容确实是一个可用的 envelope。
 * 任何不满足契约的内容都视为「损坏文件」，交给隔离流程处理。
 */
function assertEnvelopeShape(value: unknown): asserts value is SharedResultEnvelope {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('共享结果内容不是 JSON 对象');
    }
    const envelope = value as Record<string, unknown>;
    if (typeof envelope.handle !== 'string' || !envelope.handle) {
        throw new Error('共享结果缺少 handle 字段');
    }
    if (typeof envelope.expires_at !== 'string' || !envelope.expires_at) {
        throw new Error('共享结果缺少 expires_at 字段');
    }
    if (Number.isNaN(Date.parse(envelope.expires_at))) {
        throw new Error('共享结果 expires_at 字段无法解析为时间');
    }
}

async function ensureStoreDir(storeDir: string): Promise<void> {
    await fs.mkdir(storeDir, { recursive: true });
}

async function pathExists(filePath: string): Promise<boolean> {
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

/**
 * 把损坏文件移动到 `corrupt/` 隔离目录，避免每次扫描都重复报错。
 * 移动失败必须可容忍（只记录日志），绝不能中断批量流程。
 */
async function quarantineCorruptFile(filePath: string, storeDir: string, reason: unknown): Promise<void> {
    console.warn(`共享结果文件损坏，已按不存在处理并隔离：${filePath}`, reason);
    try {
        const corruptDir = buildCorruptDir(storeDir);
        await fs.mkdir(corruptDir, { recursive: true });
        const fileName = path.basename(filePath);
        let target = path.join(corruptDir, fileName);
        if (await pathExists(target)) {
            target = path.join(corruptDir, `${fileName}.${Date.now()}`);
        }
        await fs.rename(filePath, target);
    } catch (error) {
        console.warn(`隔离损坏文件失败，已忽略：${filePath}`, error);
    }
}

/**
 * 读取并解析 envelope。任何失败（不存在 / 损坏 / 权限）都返回 null，绝不抛异常：
 * 单个坏文件不应让整个存储不可用（见 CODE_REVIEW.md M1）。
 */
async function safeReadEnvelope(filePath: string, storeDir: string): Promise<SharedResultEnvelope | null> {
    let content: string;
    try {
        content = await fs.readFile(filePath, 'utf8');
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            console.warn(`读取共享结果文件失败，已按不存在处理：${filePath}`, error);
        }
        return null;
    }

    try {
        const parsed: unknown = JSON.parse(content);
        assertEnvelopeShape(parsed);
        return normalizeSharedResultEnvelope(parsed);
    } catch (error) {
        await quarantineCorruptFile(filePath, storeDir, error);
        return null;
    }
}

async function hasExpiredMarker(filePath: string): Promise<boolean> {
    return pathExists(filePath);
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

/**
 * 在 storeDir 中定位某个 handle 对应的结果文件。
 * 优先返回新格式（`<expires>-<handle>.json`），找不到时回退旧格式（`<handle>.json`）。
 * 只做文件名匹配，不读取文件内容。
 */
async function findActiveFilePath(storeDir: string, handle: string): Promise<string | null> {
    const legacyPath = buildLegacyFilePath(storeDir, handle);
    let legacyExists = false;
    let entries: import('fs').Dirent[];
    try {
        entries = await fs.readdir(storeDir, { withFileTypes: true });
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return null;
        }
        throw error;
    }

    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }
        const parsed = parseSharedResultFileName(entry.name);
        if (parsed && parsed.handle === handle) {
            return path.join(storeDir, entry.name);
        }
        if (entry.name === path.basename(legacyPath)) {
            legacyExists = true;
        }
    }

    return legacyExists ? legacyPath : null;
}

async function markExpiredResult(
    handle: string,
    activeFilePath: string | null,
    expiresAtIso: string | undefined,
    config: SharedResultStoreConfig
): Promise<void> {
    const markerPath = buildExpiredMarkerPath(config.storeDir, handle);
    const expiredAt = expiresAtIso || new Date().toISOString();

    await fs.writeFile(markerPath, JSON.stringify({
        handle,
        resource_uri: buildSharedResultResourceUri(handle),
        expired_at: expiredAt
    }, null, 2), 'utf8');
    if (activeFilePath) {
        await removeFileIfExists(activeFilePath);
    }
}

async function loadSharedResultState(
    handleOrResourceUri: string,
    config: SharedResultStoreConfig
): Promise<{
    handle: string;
    filePath: string | null;
    markerPath: string;
    envelope: SharedResultEnvelope | null;
    status: 'active' | 'expired' | 'missing';
}> {
    const handle = resolveHandleReference(handleOrResourceUri);
    const filePath = await findActiveFilePath(config.storeDir, handle);
    const markerPath = buildExpiredMarkerPath(config.storeDir, handle);
    const envelope = filePath ? await safeReadEnvelope(filePath, config.storeDir) : null;

    if (envelope) {
        if (isExpired(envelope)) {
            await markExpiredResult(handle, filePath, envelope.expires_at, config);
            return { handle, filePath, markerPath, envelope: null, status: 'expired' };
        }
        return { handle, filePath, markerPath, envelope, status: 'active' };
    }

    if (await hasExpiredMarker(markerPath)) {
        return { handle, filePath, markerPath, envelope: null, status: 'expired' };
    }

    return { handle, filePath, markerPath, envelope: null, status: 'missing' };
}

function currentEpochMilliseconds(now = Date.now()): number {
    return Math.floor(now);
}

export async function cleanupExpiredResults(config: SharedResultStoreConfig = getSharedResultStoreConfig()): Promise<void> {
    await ensureStoreDir(config.storeDir);
    const now = Date.now();
    const nowEpochMilliseconds = currentEpochMilliseconds(now);
    let entries: import('fs').Dirent[];
    try {
        entries = await fs.readdir(config.storeDir, { withFileTypes: true });
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return;
        }
        throw error;
    }

    await Promise.all(entries.map(async (entry) => {
        if (!entry.isFile() || !isActiveEnvelopeFileName(entry.name)) {
            return;
        }

        const filePath = path.join(config.storeDir, entry.name);
        // 快路径：过期时间已编码进文件名，直接按文件名判断，无需读取 / 解析内容。
        const parsedName = parseSharedResultFileName(entry.name);
        if (parsedName) {
            if (parsedName.expiresAtEpochMilliseconds <= nowEpochMilliseconds) {
                await markExpiredResult(
                    parsedName.handle,
                    filePath,
                    new Date(parsedName.expiresAtEpochMilliseconds).toISOString(),
                    config
                );
            }
            return;
        }

        // 慢路径：旧格式文件没有过期前缀，只能读取内容判断是否过期。
        const envelope = await safeReadEnvelope(filePath, config.storeDir);
        if (!envelope) {
            // 不存在（并发删除）或损坏（已隔离）：都跳过，绝不删除 / 抛错。
            return;
        }
        if (isExpired(envelope, now)) {
            await markExpiredResult(envelope.handle, filePath, envelope.expires_at, config);
        }
    }));
}

/**
 * 写路径清理降频状态。
 * 保存是最高频的入口，若每次都全目录扫描，固定开销会随存量线性增长（CODE_REVIEW.md M2）。
 * 这里改为「距上次写路径清理不足 cleanup_interval_seconds 时直接跳过」；
 * 正确性不依赖写路径清理——读取 / 列表路径仍会按 TTL 判定过期。
 */
let lastWritePathCleanupAtMs = 0;

/** 仅供测试：重置写路径清理降频状态。 */
export function resetSharedResultCleanupThrottle(): void {
    lastWritePathCleanupAtMs = 0;
}

async function maybeCleanupOnSave(config: SharedResultStoreConfig): Promise<void> {
    const now = Date.now();
    if (now - lastWritePathCleanupAtMs < CLEANUP_INTERVAL_MS) {
        return;
    }
    lastWritePathCleanupAtMs = now;
    await cleanupExpiredResults(config);
}

export async function saveSharedResult(
    input: SaveSharedResultInput,
    config: SharedResultStoreConfig = getSharedResultStoreConfig()
): Promise<SharedResultEnvelope> {
    await maybeCleanupOnSave(config);
    await ensureStoreDir(config.storeDir);

    let payload = input.payload;
    let summary = input.summary;
    let sourceQuery = input.sourceQuery;
    if (input.guardrailConfig?.enabled) {
        const guardedPayload = applyOutputGuardrails(payload, input.guardrailConfig);
        const guardedSummary = applyOutputGuardrails(summary, input.guardrailConfig);
        const guardedSourceQuery = applyOutputGuardrails(sourceQuery, input.guardrailConfig);
        payload = guardedPayload.data;
        summary = guardedSummary.data as SharedResultSummary;
        sourceQuery = typeof guardedSourceQuery.data === 'string' ? guardedSourceQuery.data : undefined;
        guardedPayload.sanitizedValues += guardedSourceQuery.sanitizedValues;
        if (
            payload
            && typeof payload === 'object'
            && !Array.isArray(payload)
            && (guardedPayload.sanitizedValues || guardedPayload.truncatedEvents)
        ) {
            payload = {
                ...(payload as Record<string, unknown>),
                guardrail_output: {
                    sanitized_values: guardedPayload.sanitizedValues,
                    truncated_events: guardedPayload.truncatedEvents,
                    truncated_paths: guardedPayload.truncatedPaths
                }
            };
        }
    }

    const ttlSeconds = input.ttlSeconds && input.ttlSeconds > 0
        ? Math.floor(input.ttlSeconds)
        : config.defaultTtlSeconds;
    const handle = randomUUID().replace(/-/g, '');
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload ?? null), 'utf8');
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
        resource_title: buildSharedResultResourceTitle(input.toolName, summary, handle),
        resource_type: input.resultKind,
        resource_mime_type: SHARED_RESULT_RESOURCE_MIME_TYPE,
        created_at: createdAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        tool_name: input.toolName,
        result_kind: input.resultKind,
        source_query: sourceQuery,
        time_range: input.timeRange,
        index_name: input.indexName,
        upstream_sid: input.upstreamSid,
        payload_bytes: payloadBytes,
        summary,
        payload
    };

    // 过期时间（毫秒）编码进文件名；按文件名判定过期的误差 < 1ms。
    const expiresAtEpochMilliseconds = Math.floor(expiresAt.getTime());
    await fs.writeFile(
        buildActiveFilePath(config.storeDir, expiresAtEpochMilliseconds, handle),
        JSON.stringify(envelope, null, 2),
        'utf8'
    );
    return envelope;
}

export async function readSharedResult(
    resourceUri: string,
    config: SharedResultStoreConfig = getSharedResultStoreConfig(),
    routeName?: string
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

    // A handle is only addressable within the route that created it. Treat a
    // cross-route lookup as missing so resource existence is not disclosed.
    if (routeName && state.envelope.route_name !== routeName) {
        throw new SharedResultStoreError('HANDLE_NOT_FOUND', '共享结果不存在，可能已被删除或尚未生成。');
    }

    return state.envelope;
}

export async function listSharedResults(
    config: SharedResultStoreConfig = getSharedResultStoreConfig(),
    routeName?: string
): Promise<SharedResultEnvelope[]> {
    await cleanupExpiredResults(config);
    await ensureStoreDir(config.storeDir);

    const nowEpochMilliseconds = currentEpochMilliseconds();
    let entries: import('fs').Dirent[];
    try {
        entries = await fs.readdir(config.storeDir, { withFileTypes: true });
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const envelopes = await Promise.all(entries.map(async (entry) => {
        if (!entry.isFile() || !isActiveEnvelopeFileName(entry.name)) {
            return null;
        }

        // 快路径：文件名已表明过期（清理失败或竞态残留）时直接跳过，不读取内容。
        const parsedName = parseSharedResultFileName(entry.name);
        if (parsedName && parsedName.expiresAtEpochMilliseconds <= nowEpochMilliseconds) {
            return null;
        }

        return safeReadEnvelope(path.join(config.storeDir, entry.name), config.storeDir);
    }));

    return envelopes
        .filter((envelope) => envelope !== null)
        .filter((envelope) => !routeName || envelope!.route_name === routeName)
        .map((envelope) => envelope as SharedResultEnvelope)
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

    if (state.filePath) {
        await removeFileIfExists(state.filePath);
    }
    await removeFileIfExists(state.markerPath);
    return true;
}
