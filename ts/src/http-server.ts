import express from 'express';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildAuthContextFromAuthorization } from './auth-context.js';
import { getRuntimeConfig, type ServerContext } from './config.js';
import { serverRegistry } from './server-registry.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describeAuthorization } from './auth-header.js';
import { isExecutedDirectly } from './runtime-entry.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { FixedWindowRateLimiter } from './rate-limiting.js';
import { UsageLogger } from './usage-log.js';

function sendJsonError(res: Response, status: number, error: string, message: string) {
    res.status(status).json({
        error,
        message
    });
}

interface SessionEntry {
    serverName: string;
    server: McpServer;
    transport: StreamableHTTPServerTransport;
    context: ServerContext;
    /** 最近一次命中该 session 的请求时间（毫秒），用于空闲 TTL 与数量淘汰。 */
    lastSeenAt: number;
}

/** 后台 session GC 周期。 */
const SESSION_GC_INTERVAL_MS = 60_000;

function touchSessionEntry(entry: SessionEntry): void {
    entry.lastSeenAt = Date.now();
}

async function closeSessionEntry(entry: SessionEntry): Promise<void> {
    try {
        await entry.server.close();
    } catch (error) {
        console.error('关闭 MCP session server 失败:', error);
    }
    try {
        await entry.transport.close();
    } catch (error) {
        console.error('关闭 MCP session transport 失败:', error);
    }
}

/**
 * 超过 maxCount 时按 lastSeenAt 淘汰最旧的 session。
 * 仅从 Map 中移除并返回条目，由调用方负责关闭其 transport/server。
 */
export function evictOverflowSessions(store: Map<string, SessionEntry>, maxCount: number): SessionEntry[] {
    const evicted: SessionEntry[] = [];
    while (store.size > maxCount) {
        let oldestId: string | undefined;
        let oldestSeenAt = Number.POSITIVE_INFINITY;
        for (const [sessionId, entry] of store) {
            if (entry.lastSeenAt < oldestSeenAt) {
                oldestSeenAt = entry.lastSeenAt;
                oldestId = sessionId;
            }
        }
        if (!oldestId) {
            break;
        }
        const entry = store.get(oldestId);
        store.delete(oldestId);
        if (entry) {
            evicted.push(entry);
        }
    }
    return evicted;
}

/**
 * 后台 session GC。
 * 优先级：先按空闲 TTL 清理，再按数量上限淘汰最旧的 session；
 * 两类淘汰都必须真正关闭 transport/server，而不是只删除 Map 引用。
 */
export async function collectSessions(
    store: Map<string, SessionEntry>,
    idleTtlSeconds: number,
    maxCount: number
): Promise<void> {
    const now = Date.now();
    const ttlMs = idleTtlSeconds * 1000;

    const expired: SessionEntry[] = [];
    for (const [sessionId, entry] of store) {
        if (now - entry.lastSeenAt >= ttlMs) {
            store.delete(sessionId);
            expired.push(entry);
        }
    }

    const overflow = evictOverflowSessions(store, maxCount);
    await Promise.all([...expired, ...overflow].map(closeSessionEntry));
}

function buildRequestContext(
    req: Request,
    runtimeConfig: ReturnType<typeof getRuntimeConfig>,
    rateLimiter: FixedWindowRateLimiter,
    usageLogger: UsageLogger,
    routeName: string
): ServerContext {
    // 如果 LOGEASE_USERNAME 环境变量设置了，用它显式指定（优先于从 apikey 里拆分的 username）
    const authContext = buildAuthContextFromAuthorization(
        req.header('authorization'),
        runtimeConfig.logeaseUsername
    );

    return {
        runtimeConfig,
        authContext,
        requestMeta: {
            source: 'http',
            path: req.path,
            clientAddress: req.ip,
            routeName,
            serverName: routeName
        },
        rateLimiter,
        usageLogger
    };
}

async function handleMcpRequest(
    req: Request,
    res: Response,
    runtimeConfig: ReturnType<typeof getRuntimeConfig>,
    rateLimiter: FixedWindowRateLimiter,
    usageLogger: UsageLogger,
    sessionStore: Map<string, SessionEntry>
) {
    const serverName = String(req.params.serverName || '').trim();
    const factory = serverRegistry[serverName];

    if (!factory) {
        sendJsonError(res, 404, 'SERVER_NOT_FOUND', `未知 MCP Server 路径: ${serverName}`);
        return;
    }

    const authorization = req.header('authorization');
    if (!authorization) {
        sendJsonError(res, 401, 'MISSING_AUTHORIZATION', '缺少 Authorization 请求头。');
        return;
    }

    let context: ServerContext;
    try {
        context = buildRequestContext(req, runtimeConfig, rateLimiter, usageLogger, serverName);
    } catch (error: any) {
        sendJsonError(res, 400, 'INVALID_AUTHORIZATION', error?.message || 'Authorization 格式无效。');
        return;
    }

    try {
        const sessionId = req.header('mcp-session-id');
        let entry = sessionId ? sessionStore.get(sessionId) : undefined;

        if (entry && entry.serverName !== serverName) {
            sendJsonError(res, 400, 'SESSION_SERVER_MISMATCH', '当前 session 不属于该 MCP Server 路径。');
            return;
        }

        if (entry && entry.context.authContext.authorization && context.authContext.authorization) {
            if (entry.context.authContext.authorization.rawAuthorization !== context.authContext.authorization.rawAuthorization) {
                sendJsonError(res, 400, 'SESSION_AUTH_MISMATCH', '同一个 session 不允许切换 Authorization。');
                return;
            }
        }

        if (!entry && !isInitializeRequest(req.body)) {
            sendJsonError(res, 400, 'MISSING_SESSION', '非 initialize 请求必须提供有效的 mcp-session-id。');
            return;
        }

        if (!entry) {
            const server = await factory(context);
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                enableJsonResponse: true,
                onsessioninitialized: (initializedSessionId) => {
                    context.requestMeta.sessionId = initializedSessionId;
                    sessionStore.set(initializedSessionId, {
                        serverName,
                        server,
                        transport,
                        context,
                        lastSeenAt: Date.now()
                    });

                    // 超过数量上限时立即淘汰最旧的 session，避免恶意方用大量 initialize 快速放大内存。
                    for (const evicted of evictOverflowSessions(sessionStore, runtimeConfig.sessionMaxCount)) {
                        void closeSessionEntry(evicted);
                    }

                    if (context.authContext.authorization) {
                        console.error(`MCP HTTP session created: ${serverName} ${describeAuthorization(context.authContext.authorization)}`);
                    }
                }
            });

            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            return;
        }

        touchSessionEntry(entry);
        await entry.transport.handleRequest(req, res, req.body);
    } catch (error: any) {
        if (!res.headersSent) {
            sendJsonError(res, 500, 'MCP_HTTP_ERROR', error?.message || '处理 MCP HTTP 请求失败。');
        }
    }
}

export function createHttpApp() {
    const runtimeConfig = getRuntimeConfig();
    const rateLimiter = new FixedWindowRateLimiter(
        runtimeConfig.rateLimitGlobalPerMinute,
        runtimeConfig.rateLimitPerTool
    );
    const usageLogger = new UsageLogger(runtimeConfig.usageLog);
    const sessionStore = new Map<string, SessionEntry>();
    const app = express();

    app.disable('x-powered-by');
    // 请求体上限与 Python 端 MCP_HTTP_MAX_BODY_BYTES 共用同一配置键与默认值。
    app.use(express.json({ limit: runtimeConfig.httpMaxBodyBytes }));

    app.get('/healthz', (_req, res) => {
        res.status(200).json({
            ok: true,
            session_count: sessionStore.size,
            rate_limiting: {
                enabled: rateLimiter.enabled,
                global_per_minute: runtimeConfig.rateLimitGlobalPerMinute ?? null,
                per_tool_count: Object.keys(runtimeConfig.rateLimitPerTool).length
            },
            guardrails: {
                enabled: runtimeConfig.guardrails.enabled,
                mode: runtimeConfig.guardrails.mode,
                alert_threshold: runtimeConfig.guardrails.alertThreshold,
                reject_threshold: runtimeConfig.guardrails.rejectThreshold,
                max_events: runtimeConfig.guardrails.maxEvents
            }
        });
    });

    app.post(
        `${runtimeConfig.httpBasePath}/:serverName`,
        (req, res) => handleMcpRequest(req, res, runtimeConfig, rateLimiter, usageLogger, sessionStore)
    );
    app.get(`${runtimeConfig.httpBasePath}/:serverName`, (_req, res) => {
        res.status(405).set('Allow', 'POST, DELETE').send('Method Not Allowed');
    });
    app.delete(`${runtimeConfig.httpBasePath}/:serverName`, async (req, res) => {
        const sessionId = req.header('mcp-session-id');
        if (!sessionId) {
            sendJsonError(res, 400, 'MISSING_SESSION_ID', '缺少 mcp-session-id 请求头。');
            return;
        }

        const entry = sessionStore.get(sessionId);
        if (!entry) {
            sendJsonError(res, 404, 'SESSION_NOT_FOUND', '指定的 session 不存在。');
            return;
        }

        sessionStore.delete(sessionId);
        await closeSessionEntry(entry);
        res.status(204).end();
    });

    app.use((req, res) => {
        sendJsonError(res, 404, 'NOT_FOUND', `未知路径: ${req.path}`);
    });

    // body-parser 在请求体超过 limit 时抛出 PayloadTooLargeError；
    // 这里转成与其它错误一致的 JSON 响应（413），而不是落入 Express 默认 HTML 错误页或直接断连。
    app.use((error: any, _req: Request, res: Response, next: NextFunction) => {
        if (error?.type === 'entity.too.large' || error?.status === 413) {
            sendJsonError(
                res,
                413,
                'REQUEST_BODY_TOO_LARGE',
                `请求体超过上限 ${runtimeConfig.httpMaxBodyBytes} 字节。`
            );
            return;
        }
        next(error);
    });

    // 后台定时 GC：先按空闲 TTL 清理，再按数量上限淘汰最旧 session。
    // unref() 保证该定时器不会阻止进程退出。
    setInterval(() => {
        void collectSessions(sessionStore, runtimeConfig.sessionIdleTtlSeconds, runtimeConfig.sessionMaxCount);
    }, SESSION_GC_INTERVAL_MS).unref();

    return {
        app,
        runtimeConfig
    };
}

export async function startHttpServer(): Promise<void> {
    const { app, runtimeConfig } = createHttpApp();

    await new Promise<void>((resolve) => {
        app.listen(runtimeConfig.httpPort, runtimeConfig.httpHost, () => {
            console.error(`Rizhiyi MCP HTTP 服务器已启动: http://${runtimeConfig.httpHost}:${runtimeConfig.httpPort}${runtimeConfig.httpBasePath}`);
            resolve();
        });
    });
}

if (isExecutedDirectly(import.meta.url)) {
    startHttpServer().catch((error) => {
        console.error('启动 HTTP 服务器失败:', error);
        process.exit(1);
    });
}
