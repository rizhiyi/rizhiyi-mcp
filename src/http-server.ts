import express from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildAuthContextFromAuthorization } from './auth-context.js';
import { getRuntimeConfig, type ServerContext } from './config.js';
import { serverRegistry } from './server-registry.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describeAuthorization } from './auth-header.js';
import { isExecutedDirectly } from './runtime-entry.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

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
}

const sessionStore = new Map<string, SessionEntry>();

function buildRequestContext(req: Request): ServerContext {
    const runtimeConfig = getRuntimeConfig();
    const authContext = buildAuthContextFromAuthorization(req.header('authorization'));

    return {
        runtimeConfig,
        authContext,
        requestMeta: {
            source: 'http',
            path: req.path,
            clientAddress: req.ip
        }
    };
}

async function handleMcpRequest(req: Request, res: Response) {
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
        context = buildRequestContext(req);
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
                    sessionStore.set(initializedSessionId, {
                        serverName,
                        server,
                        transport,
                        context
                    });

                    if (context.authContext.authorization) {
                        console.error(`MCP HTTP session created: ${serverName} ${describeAuthorization(context.authContext.authorization)}`);
                    }
                }
            });

            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            return;
        }

        await entry.transport.handleRequest(req, res, req.body);
    } catch (error: any) {
        if (!res.headersSent) {
            sendJsonError(res, 500, 'MCP_HTTP_ERROR', error?.message || '处理 MCP HTTP 请求失败。');
        }
    }
}

export function createHttpApp() {
    const runtimeConfig = getRuntimeConfig();
    const app = express();

    app.disable('x-powered-by');
    app.use(express.json({ limit: '4mb' }));

    app.get('/healthz', (_req, res) => {
        res.status(200).json({
            ok: true
        });
    });

    app.post(`${runtimeConfig.httpBasePath}/:serverName`, handleMcpRequest);
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

        await entry.server.close();
        await entry.transport.close();
        sessionStore.delete(sessionId);
        res.status(204).end();
    });

    app.use((req, res) => {
        sendJsonError(res, 404, 'NOT_FOUND', `未知路径: ${req.path}`);
    });

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
