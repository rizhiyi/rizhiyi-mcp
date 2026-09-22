import https from 'https';
import dotenv from 'dotenv';
import type { HttpClientConfig } from './types.js';
import { AuthContext, buildAuthContextFromEnv } from './auth-context.js';
import type { FixedWindowRateLimiter } from './rate-limiting.js';
import type { GuardrailConfig } from './spl-guardrails.js';
import type { UsageLogConfig, UsageLogger, UsageLogRotateInterval } from './usage-log.js';

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
    usageLog: UsageLogConfig;
    guardrails: GuardrailConfig;
}

const DEFAULT_GUARDRAIL_DENY_COMMANDS = [
    'collect', 'delete', 'mcollect', 'fit', 'outputlookup', 'download', 'save',
    'dbxoutput', 'lookup2', 'fromes', 'fromkafkapy', 'rest', 'dbxlookup',
    'dbxquery', 'dbxexec', 'ldapsearch', 'ldapfilter', 'ldapgroup', 'ldapfetch', 'history'
];

export interface RequestMeta {
    source: 'stdio' | 'http';
    path?: string;
    clientAddress?: string;
    routeName?: string;
    serverName?: string;
    sessionId?: string;
}

export interface ServerContext {
    runtimeConfig: RuntimeConfig;
    authContext: AuthContext;
    requestMeta: RequestMeta;
    rateLimiter?: FixedWindowRateLimiter;
    usageLogger?: UsageLogger;
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

function parseIntegerEnv(rawValue: string | undefined, defaultValue: number, variableName: string): number {
    if (typeof rawValue === 'undefined' || rawValue.trim() === '') {
        return defaultValue;
    }
    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed)) {
        throw new Error(`${variableName} 必须是整数`);
    }
    return parsed;
}

function parseUsageLogConfig(env: NodeJS.ProcessEnv): UsageLogConfig {
    const namePrefix = (env.RIZHIYI_LOG_NAME_PREFIX || 'mcp-server').trim();
    if (!namePrefix || namePrefix.includes('/') || namePrefix.includes('\\')) {
        throw new Error('RIZHIYI_LOG_NAME_PREFIX 必须是非空文件名前缀，且不能包含路径分隔符');
    }

    const rotateInterval = (env.RIZHIYI_LOG_ROTATE_INTERVAL || '1d').trim() as UsageLogRotateInterval;
    if (!['1d', '1h'].includes(rotateInterval)) {
        throw new Error('RIZHIYI_LOG_ROTATE_INTERVAL 仅支持 1d 或 1h');
    }

    const keepFiles = parseIntegerEnv(env.RIZHIYI_LOG_KEEP_FILES, 7, 'RIZHIYI_LOG_KEEP_FILES');
    if (keepFiles <= 0) {
        throw new Error('RIZHIYI_LOG_KEEP_FILES 必须是正整数');
    }

    return {
        directory: env.RIZHIYI_LOG_DIR?.trim() || './logs',
        namePrefix,
        rotateBytes: parseIntegerEnv(env.RIZHIYI_LOG_ROTATE_BYTES, 10 * 1024 * 1024, 'RIZHIYI_LOG_ROTATE_BYTES'),
        rotateInterval,
        keepFiles
    };
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

function parseJsonEnv(rawValue: string | undefined, variableName: string, fallback: unknown): unknown {
    if (typeof rawValue === 'undefined' || rawValue.trim() === '') return fallback;
    try {
        return JSON.parse(rawValue);
    } catch (error: any) {
        throw new Error(`${variableName} 必须是合法 JSON: ${error?.message || error}`);
    }
}

function parseStringArrayEnv(rawValue: string | undefined, variableName: string, fallback: string[]): string[] {
    const parsed = parseJsonEnv(rawValue, variableName, fallback);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
        throw new Error(`${variableName} 必须是 JSON 字符串数组`);
    }
    return [...new Set(parsed.map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function parseScoreMapEnv(rawValue: string | undefined): Record<string, number> {
    const parsed = parseJsonEnv(rawValue, 'MCP_GUARDRAIL_RISK_RULE_OVERRIDES', {});
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('MCP_GUARDRAIL_RISK_RULE_OVERRIDES 必须是 JSON 对象');
    }
    return Object.fromEntries(Object.entries(parsed).map(([rawName, rawScore]) => {
        const name = rawName.trim().toLowerCase();
        if (!name || typeof rawScore !== 'number' || !Number.isInteger(rawScore) || rawScore < 0) {
            throw new Error(`MCP_GUARDRAIL_RISK_RULE_OVERRIDES 中 ${rawName} 必须是非负整数`);
        }
        return [name, rawScore];
    }));
}

function parseRiskThreshold(rawValue: string | undefined, fallback: number, variableName: string): number {
    const value = parseIntegerEnv(rawValue, fallback, variableName);
    if (value < 0 || value > 100) throw new Error(`${variableName} 必须在 0 到 100 之间`);
    return value;
}

function parseGuardrailConfig(env: NodeJS.ProcessEnv): GuardrailConfig {
    const mode = (env.MCP_GUARDRAIL_ENFORCE_MODE || 'audit').trim().toLowerCase();
    if (mode !== 'audit' && mode !== 'enforce') {
        throw new Error('MCP_GUARDRAIL_ENFORCE_MODE 仅支持 audit 或 enforce');
    }
    const masks = parseStringArrayEnv(
        env.MCP_GUARDRAIL_SANITIZE_MASKS,
        'MCP_GUARDRAIL_SANITIZE_MASKS',
        ['credit_card', 'ssn']
    );
    const unknownMasks = masks.filter((item) => !['credit_card', 'ssn'].includes(item));
    if (unknownMasks.length) throw new Error(`不支持的脱敏器: ${unknownMasks.join(', ')}`);

    const customRaw = parseJsonEnv(env.MCP_GUARDRAIL_SANITIZE_CUSTOM_PATTERNS, 'MCP_GUARDRAIL_SANITIZE_CUSTOM_PATTERNS', []);
    if (!Array.isArray(customRaw)) throw new Error('MCP_GUARDRAIL_SANITIZE_CUSTOM_PATTERNS 必须是 JSON 数组');
    const customPatterns = customRaw.map((item: any, index) => {
        if (!item || typeof item !== 'object' || typeof item.pattern !== 'string' || !item.pattern) {
            throw new Error(`MCP_GUARDRAIL_SANITIZE_CUSTOM_PATTERNS 第 ${index + 1} 项缺少 pattern`);
        }
        try {
            return { pattern: new RegExp(item.pattern, 'g'), replacement: String(item.replacement ?? '') };
        } catch (error: any) {
            throw new Error(`无效的自定义脱敏正则 ${item.pattern}: ${error?.message || error}`);
        }
    });

    const execTimeoutSeconds = parseIntegerEnv(
        env.MCP_GUARDRAIL_EXEC_TIMEOUT_SECONDS,
        60,
        'MCP_GUARDRAIL_EXEC_TIMEOUT_SECONDS'
    );
    const maxEvents = parseIntegerEnv(env.MCP_GUARDRAIL_MAX_EVENTS, 1000, 'MCP_GUARDRAIL_MAX_EVENTS');
    if (execTimeoutSeconds <= 0 || maxEvents <= 0) {
        throw new Error('MCP_GUARDRAIL_EXEC_TIMEOUT_SECONDS 和 MCP_GUARDRAIL_MAX_EVENTS 必须是正整数');
    }
    const safeTimerange = (env.MCP_GUARDRAIL_SAFE_TIMERANGE || '24h').trim().toLowerCase();
    if (!safeTimerange) throw new Error('MCP_GUARDRAIL_SAFE_TIMERANGE 不能为空');

    return {
        enabled: parseBooleanEnv(env.MCP_GUARDRAILS_ENABLED, false),
        mode,
        denyCommands: new Set(parseStringArrayEnv(
            env.MCP_GUARDRAIL_DENY_COMMANDS,
            'MCP_GUARDRAIL_DENY_COMMANDS',
            DEFAULT_GUARDRAIL_DENY_COMMANDS
        )),
        alertThreshold: parseRiskThreshold(env.MCP_GUARDRAIL_RISK_ALERT_THRESHOLD, 50, 'MCP_GUARDRAIL_RISK_ALERT_THRESHOLD'),
        rejectThreshold: parseRiskThreshold(env.MCP_GUARDRAIL_RISK_REJECT_THRESHOLD, 100, 'MCP_GUARDRAIL_RISK_REJECT_THRESHOLD'),
        ruleOverrides: parseScoreMapEnv(env.MCP_GUARDRAIL_RISK_RULE_OVERRIDES),
        safeTimerange,
        execTimeoutSeconds,
        maxEvents,
        sanitizeEnabled: parseBooleanEnv(env.MCP_GUARDRAIL_SANITIZE_ENABLED, true),
        sanitizeMasks: new Set(masks),
        sanitizeCustomPatterns: customPatterns
    };
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
    const usageLog = parseUsageLogConfig(env);
    const guardrails = parseGuardrailConfig(env);

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
        rateLimitPerTool,
        usageLog,
        guardrails
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
        username: context.authContext.username,
        timeoutMs: context.runtimeConfig.guardrails.enabled && context.runtimeConfig.guardrails.mode === 'enforce'
            ? context.runtimeConfig.guardrails.execTimeoutSeconds * 1000
            : undefined
    };
}

export function createServerContextForStdio(
    env: NodeJS.ProcessEnv = process.env,
    routeName?: string
): ServerContext {
    const runtimeConfig = getRuntimeConfig(env);
    const authContext = buildAuthContextFromEnv(env);

    if (!authContext.authorization) {
        console.warn('未检测到认证信息（LOGEASE_AUTH_HEADER 或 LOGEASE_API_KEY），与服务交互可能失败');
    }

    return {
        runtimeConfig,
        authContext,
        requestMeta: {
            source: 'stdio',
            ...(routeName ? { routeName, serverName: routeName } : {})
        }
    };
}
