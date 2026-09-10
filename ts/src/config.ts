import https from 'https';
import dotenv from 'dotenv';
import type { HttpClientConfig } from './types.js';
import { AuthContext, buildAuthContextFromEnv } from './auth-context.js';

dotenv.config({ path: ['.env.local', '.env'] });

export interface RuntimeConfig {
    logeaseBaseURL: string;
    logeaseUsername?: string;
    rejectUnauthorized: boolean;
    httpHost: string;
    httpPort: number;
    httpBasePath: string;
    // OAuth2 / 统一 SSO（可选，默认关闭）
    oauthEnable: boolean;
    oauthIssuer?: string;
    oauthClientId?: string;
    oauthClientSecret?: string;
    oauthIntrospectEndpoint?: string;
    oauthTokenEndpoint?: string;
    oauthTokenExchangeAudience?: string;
    oauthSkipExchange: boolean;
    oauthJwtRefreshAheadSeconds: number;
    // 日志易 JWT 登录端点配置
    logeaseLoginEndpoint?: string;
    logeaseLoginTokenField?: string;
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
    const logeaseUsername = env.LOGEASE_USERNAME;
    const rejectUnauthorized = parseBooleanEnv(env.LOGEASE_TLS_REJECT_UNAUTHORIZED, false);
    const httpHost = env.MCP_HTTP_HOST || '0.0.0.0';
    const httpPort = Number(env.MCP_HTTP_PORT || 3000);
    const httpBasePath = normalizeBasePath(env.MCP_HTTP_BASE_PATH);

    // OAuth2 / 统一 SSO
    const oauthEnable = parseBooleanEnv(env.OAUTH_ENABLE, false);
    const oauthIssuer = env.OAUTH_ISSUER;
    const oauthClientId = env.OAUTH_CLIENT_ID;
    const oauthClientSecret = env.OAUTH_CLIENT_SECRET;
    const oauthIntrospectEndpoint = env.OAUTH_INTROSPECT_ENDPOINT;
    const oauthTokenEndpoint = env.OAUTH_TOKEN_ENDPOINT;
    const oauthTokenExchangeAudience = env.OAUTH_TOKEN_EXCHANGE_AUDIENCE;
    const oauthSkipExchange = parseBooleanEnv(env.OAUTH_SKIP_EXCHANGE, false);
    const oauthJwtRefreshAheadSeconds = Number(env.OAUTH_JWT_REFRESH_AHEAD_SECONDS || 60);

    const logeaseLoginEndpoint = env.LOGEASE_LOGIN_ENDPOINT;
    const logeaseLoginTokenField = env.LOGEASE_LOGIN_TOKEN_FIELD || 'token';

    if (!env.LOGEASE_BASE_URL) {
        console.warn('LOGEASE_BASE_URL 未设置，默认使用 http://127.0.0.1:8090');
    }

    if (oauthEnable && (!oauthIssuer || !oauthClientId || !oauthClientSecret)) {
        console.warn(
            'OAUTH_ENABLE=true 但 OAUTH_ISSUER / OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET 未完整配置，OAuth 链路可能失败。',
        );
    }

    return {
        logeaseBaseURL,
        logeaseUsername,
        rejectUnauthorized,
        httpHost,
        httpPort: Number.isFinite(httpPort) ? httpPort : 3000,
        httpBasePath,
        oauthEnable,
        oauthIssuer,
        oauthClientId,
        oauthClientSecret,
        oauthIntrospectEndpoint,
        oauthTokenEndpoint,
        oauthTokenExchangeAudience,
        oauthSkipExchange,
        oauthJwtRefreshAheadSeconds: Number.isFinite(oauthJwtRefreshAheadSeconds) ? oauthJwtRefreshAheadSeconds : 60,
        logeaseLoginEndpoint,
        logeaseLoginTokenField,
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
