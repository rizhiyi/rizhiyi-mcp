import https from 'https';
import dotenv from 'dotenv';
import type { HttpClientConfig } from './types.js';
import { AuthContext, buildAuthContextFromEnv } from './auth-context.js';

dotenv.config({ path: ['.env.local', '.env'] });

export interface RuntimeConfig {
    logeaseBaseURL: string;
    rejectUnauthorized: boolean;
    httpHost: string;
    httpPort: number;
    httpBasePath: string;
}

export interface RequestMeta {
    source: 'stdio' | 'http';
    path?: string;
    clientAddress?: string;
}

export interface ServerContext {
    runtimeConfig: RuntimeConfig;
    authContext: AuthContext;
    requestMeta: RequestMeta;
}

function parseBooleanEnv(rawValue: string | undefined, defaultValue: boolean): boolean {
    if (typeof rawValue === 'undefined') {
        return defaultValue;
    }

    return rawValue === 'true';
}

function normalizeBasePath(rawPath: string | undefined): string {
    const pathValue = (rawPath || '/mcp').trim();
    if (!pathValue || pathValue === '/') {
        return '/mcp';
    }

    return pathValue.startsWith('/') ? pathValue.replace(/\/+$/, '') : `/${pathValue.replace(/\/+$/, '')}`;
}

export function getRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
    const logeaseBaseURL = env.LOGEASE_BASE_URL ?? 'http://127.0.0.1:8090';
    const rejectUnauthorized = parseBooleanEnv(env.LOGEASE_TLS_REJECT_UNAUTHORIZED, false);
    const httpHost = env.MCP_HTTP_HOST || '0.0.0.0';
    const httpPort = Number(env.MCP_HTTP_PORT || 3000);
    const httpBasePath = normalizeBasePath(env.MCP_HTTP_BASE_PATH);

    if (!env.LOGEASE_BASE_URL) {
        console.warn('LOGEASE_BASE_URL 未设置，默认使用 http://127.0.0.1:8090');
    }

    return {
        logeaseBaseURL,
        rejectUnauthorized,
        httpHost,
        httpPort: Number.isFinite(httpPort) ? httpPort : 3000,
        httpBasePath
    };
}

export function createHttpsAgent(runtimeConfig: RuntimeConfig): https.Agent {
    return new https.Agent({
        rejectUnauthorized: runtimeConfig.rejectUnauthorized
    });
}

export function createHttpClientConfig(context: ServerContext): HttpClientConfig {
    return {
        baseURL: context.runtimeConfig.logeaseBaseURL,
        headers: context.authContext.headers,
        httpsAgent: createHttpsAgent(context.runtimeConfig)
    };
}

export function createServerContextForStdio(env: NodeJS.ProcessEnv = process.env): ServerContext {
    const runtimeConfig = getRuntimeConfig(env);
    const authContext = buildAuthContextFromEnv(env);

    if (!authContext.authorization) {
        console.warn('未检测到认证信息（LOGEASE_AUTH_HEADER 或 LOGEASE_API_KEY），与服务交互可能失败');
    }

    return {
        runtimeConfig,
        authContext,
        requestMeta: {
            source: 'stdio'
        }
    };
}
