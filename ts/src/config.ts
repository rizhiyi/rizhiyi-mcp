import https from 'https';
import dotenv from 'dotenv';
import type { HttpClientConfig } from './types.js';
import { AuthContext, buildAuthContextFromEnv } from './auth-context.js';
import type { FixedWindowRateLimiter } from './rate-limiting.js';

dotenv.config({ path: ['.env.local', '.env'] });

export interface RuntimeConfig {
    logeaseBaseURL: string;
    logeaseUsername?: string;
    rejectUnauthorized: boolean;
    httpHost: string;
    httpPort: number;
    httpBasePath: string;
    rateLimitGlobalPerMinute?: number;
    rateLimitPerTool: Record<string, number>;
}

export interface RequestMeta {
    source: 'stdio' | 'http';
    path?: string;
    clientAddress?: string;
    routeName?: string;
}

export interface ServerContext {
    runtimeConfig: RuntimeConfig;
    authContext: AuthContext;
    requestMeta: RequestMeta;
    rateLimiter?: FixedWindowRateLimiter;
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

function parseOptionalPositiveInteger(rawValue: string | undefined, variableName: string): number | undefined {
    if (typeof rawValue === 'undefined' || rawValue.trim() === '') {
        return undefined;
    }
    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${variableName} 必须是正整数`);
    }
    return parsed;
}

function parsePerToolRateLimits(rawValue: string | undefined): Record<string, number> {
    if (typeof rawValue === 'undefined' || rawValue.trim() === '') {
        return {};
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawValue);
    } catch (error: any) {
        throw new Error(`MCP_RATE_LIMIT_PER_TOOL 必须是合法 JSON 对象: ${error?.message || error}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('MCP_RATE_LIMIT_PER_TOOL 必须是 JSON 对象');
    }

    return Object.fromEntries(Object.entries(parsed).map(([rawKey, rawLimit]) => {
        const key = rawKey.trim();
        if (!key) {
            throw new Error('MCP_RATE_LIMIT_PER_TOOL 的工具键不能为空');
        }
        if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit <= 0) {
            throw new Error(`MCP_RATE_LIMIT_PER_TOOL 中 ${key} 的值必须是正整数`);
        }
        return [key, rawLimit];
    }));
}

export function getRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
    const logeaseBaseURL = env.LOGEASE_BASE_URL ?? 'https://127.0.0.1:8090';
    const logeaseUsername = env.LOGEASE_USERNAME;
    const rejectUnauthorized = parseBooleanEnv(env.LOGEASE_TLS_REJECT_UNAUTHORIZED, false);
    const httpHost = env.MCP_HTTP_HOST || '0.0.0.0';
    const httpPort = Number(env.MCP_HTTP_PORT || 3000);
    const httpBasePath = normalizeBasePath(env.MCP_HTTP_BASE_PATH);
    const rateLimitGlobalPerMinute = parseOptionalPositiveInteger(
        env.MCP_RATE_LIMIT_GLOBAL_PER_MINUTE,
        'MCP_RATE_LIMIT_GLOBAL_PER_MINUTE'
    );
    const rateLimitPerTool = parsePerToolRateLimits(env.MCP_RATE_LIMIT_PER_TOOL);

    if (!env.LOGEASE_BASE_URL) {
        console.warn('LOGEASE_BASE_URL 未设置，默认使用 https://127.0.0.1:8090');
    }

    return {
        logeaseBaseURL,
        logeaseUsername,
        rejectUnauthorized,
        httpHost,
        httpPort: Number.isFinite(httpPort) ? httpPort : 3000,
        httpBasePath,
        rateLimitGlobalPerMinute,
        rateLimitPerTool
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
        httpsAgent: createHttpsAgent(context.runtimeConfig),
        username: context.authContext.username
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
