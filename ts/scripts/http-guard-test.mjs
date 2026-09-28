#!/usr/bin/env node
/**
 * H2/H3/H4 网关护栏测试（TypeScript 侧）。
 *
 * 覆盖：
 *   H2 上游超时与护栏解耦：UPSTREAM_TIMEOUT_SECONDS 默认值 / 解析 / 校验
 *   H3 请求体大小上限：MCP_HTTP_MAX_BODY_BYTES 默认值 / 解析 / 校验，HTTP 超限返回 413
 *   H4 session 空闲回收与数量上限：TTL / 最旧淘汰 / 真正关闭 transport，healthz 暴露 session_count
 *
 * 说明：HTTP 部分需要真正拉起网关；沙箱环境冷启动较慢，这里给足等待时间。
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { getRuntimeConfig } from '../dist/config.js';
import { collectSessions } from '../dist/http-server.js';
import { resolveExecutionTimeoutSeconds } from '../dist/mcp-tool-helpers.js';

// ---------------------------------------------------------------------------
// 1. 配置默认值 / 解析 / 校验（与 Python 端保持一致）
// ---------------------------------------------------------------------------

const defaults = getRuntimeConfig({});
assert.equal(defaults.upstreamTimeoutSeconds, 30, 'UPSTREAM_TIMEOUT_SECONDS 默认应为 30');
assert.equal(defaults.httpMaxBodyBytes, 4 * 1024 * 1024, 'MCP_HTTP_MAX_BODY_BYTES 默认应为 4MB');
assert.equal(defaults.sessionIdleTtlSeconds, 1800, 'MCP_HTTP_SESSION_IDLE_TTL_SECONDS 默认应为 1800');
assert.equal(defaults.sessionMaxCount, 256, 'MCP_HTTP_SESSION_MAX_COUNT 默认应为 256');

const overridden = getRuntimeConfig({
    UPSTREAM_TIMEOUT_SECONDS: '5',
    MCP_HTTP_MAX_BODY_BYTES: '1024',
    MCP_HTTP_SESSION_IDLE_TTL_SECONDS: '10',
    MCP_HTTP_SESSION_MAX_COUNT: '2'
});
assert.equal(overridden.upstreamTimeoutSeconds, 5);
assert.equal(overridden.httpMaxBodyBytes, 1024);
assert.equal(overridden.sessionIdleTtlSeconds, 10);
assert.equal(overridden.sessionMaxCount, 2);

for (const [key, value] of [
    ['UPSTREAM_TIMEOUT_SECONDS', '0'],
    ['UPSTREAM_TIMEOUT_SECONDS', 'abc'],
    ['MCP_HTTP_MAX_BODY_BYTES', '-1'],
    ['MCP_HTTP_SESSION_IDLE_TTL_SECONDS', '0'],
    ['MCP_HTTP_SESSION_MAX_COUNT', 'x']
]) {
    assert.throws(() => getRuntimeConfig({ [key]: value }), `期望 ${key}=${value} 抛错`);
}
console.log('  [config] 默认值 / 解析 / 校验 ok');

// ---------------------------------------------------------------------------
// 1b. H2：执行超时阈值选择（护栏只决定阈值，不决定是否超时）
// ---------------------------------------------------------------------------

const disabledGuardrails = getRuntimeConfig({ MCP_GUARDRAILS_ENABLED: 'false' }).guardrails;
const enforceGuardrails = getRuntimeConfig({
    MCP_GUARDRAILS_ENABLED: 'true',
    MCP_GUARDRAIL_ENFORCE_MODE: 'enforce',
    MCP_GUARDRAIL_EXEC_TIMEOUT_SECONDS: '60'
}).guardrails;
const auditGuardrails = getRuntimeConfig({
    MCP_GUARDRAILS_ENABLED: 'true',
    MCP_GUARDRAIL_ENFORCE_MODE: 'audit'
}).guardrails;

// 护栏关闭：回退到上游超时（自定义 5s），说明超时不再被护栏门控。
assert.equal(
    resolveExecutionTimeoutSeconds(disabledGuardrails, { routeName: 'log-tools', queryCount: 0, upstreamTimeoutSeconds: 5 }),
    5,
    '护栏关闭时应使用 UPSTREAM_TIMEOUT_SECONDS'
);
// 护栏 enforce + log-tools：使用护栏阈值。
assert.equal(
    resolveExecutionTimeoutSeconds(enforceGuardrails, { routeName: 'log-tools', queryCount: 0, upstreamTimeoutSeconds: 5 }),
    60,
    '护栏 enforce 命中 log-tools 时应使用护栏阈值'
);
// 护栏 enforce + 非 log-tools 且无查询：回退到上游超时。
assert.equal(
    resolveExecutionTimeoutSeconds(enforceGuardrails, { routeName: 'manage', queryCount: 0, upstreamTimeoutSeconds: 5 }),
    5,
    '未命中护栏执行路径时应使用 UPSTREAM_TIMEOUT_SECONDS'
);
// 护栏 enforce + 有查询：使用护栏阈值。
assert.equal(
    resolveExecutionTimeoutSeconds(enforceGuardrails, { routeName: 'dashboard', queryCount: 1, upstreamTimeoutSeconds: 5 }),
    60,
    '命中查询时应使用护栏阈值'
);
// 护栏 audit：不参与阈值决策，回退到上游超时。
assert.equal(
    resolveExecutionTimeoutSeconds(auditGuardrails, { routeName: 'log-tools', queryCount: 1, upstreamTimeoutSeconds: 5 }),
    5,
    'audit 模式不应使用护栏阈值'
);
// 无上下文时回退到默认 30s（保证超时始终存在）。
assert.equal(
    resolveExecutionTimeoutSeconds(undefined, { routeName: undefined, queryCount: 0, upstreamTimeoutSeconds: undefined }),
    30,
    '无配置时应回退到默认 30s 兜底'
);
console.log('  [timeout] 执行超时阈值选择 ok');

// ---------------------------------------------------------------------------
// 2. session GC：先空闲 TTL、后数量上限，且真正关闭 transport
// ---------------------------------------------------------------------------

function fakeEntry(label, lastSeenAt, closed) {
    return {
        serverName: label,
        server: { close: async () => { closed.push(`${label}:server`); } },
        transport: { close: async () => { closed.push(`${label}:transport`); } },
        context: {},
        lastSeenAt
    };
}

const now = Date.now();
{
    const closed = [];
    const store = new Map();
    store.set('old', fakeEntry('old', now - 10_000, closed));
    store.set('fresh', fakeEntry('fresh', now, closed));
    await collectSessions(store, 5, 100);
    assert.equal(store.has('old'), false, 'TTL 过期 session 应被移除');
    assert.equal(store.has('fresh'), true, '未过期 session 应保留');
    assert.deepEqual(closed, ['old:server', 'old:transport'], '淘汰时必须关闭 server 与 transport');
}
console.log('  [gc] 空闲 TTL 回收 ok');

{
    const closed = [];
    const store = new Map();
    store.set('a', fakeEntry('a', now - 300, closed));
    store.set('b', fakeEntry('b', now - 200, closed));
    store.set('c', fakeEntry('c', now - 100, closed));
    await collectSessions(store, 3600, 2);
    assert.deepEqual([...store.keys()].sort(), ['b', 'c'], '数量超限应淘汰最旧的 a');
    assert.deepEqual(closed, ['a:server', 'a:transport']);
}
console.log('  [gc] 数量上限淘汰最旧 ok');

// ---------------------------------------------------------------------------
// 3. HTTP 行为：413 与 session_count
// ---------------------------------------------------------------------------

const port = Number(process.env.MCP_HTTP_GUARD_PORT || 3196);
const baseUrl = `http://127.0.0.1:${port}`;
const authHeader = 'apikey demo-user:demo-secret';
const jsonHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    Authorization: authHeader
};
const initializeBody = (id) => ({
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'http-guard-test', version: '1.0.0' }
    }
});

const serverProcess = spawn(process.execPath, ['./dist/http-server.js'], {
    cwd: process.cwd(),
    env: {
        ...process.env,
        MCP_HTTP_PORT: String(port),
        MCP_HTTP_MAX_BODY_BYTES: '1024',
        MCP_HTTP_SESSION_MAX_COUNT: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
});

try {
    let ready = false;
    for (let i = 0; i < 600; i += 1) {
        if (serverProcess.exitCode !== null) {
            throw new Error('HTTP server 提前退出');
        }
        try {
            const response = await fetch(`${baseUrl}/healthz`);
            if (response.ok) {
                ready = true;
                break;
            }
        } catch {
        }
        await delay(250);
    }
    if (!ready) {
        throw new Error('HTTP server 未在预期时间内启动');
    }

    const health = await (await fetch(`${baseUrl}/healthz`)).json();
    assert.equal(health.session_count, 0, 'healthz 应暴露 session_count');
    console.log('  [http] healthz session_count ok');

    const oversized = await fetch(`${baseUrl}/mcp/log-tools`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ...initializeBody(1), padding: 'x'.repeat(4096) })
    });
    assert.equal(oversized.status, 413, '超过请求体上限应返回 413');
    const oversizedJson = await oversized.json();
    assert.equal(oversizedJson.error, 'REQUEST_BODY_TOO_LARGE');
    console.log('  [http] 请求体上限 413 ok');

    const first = await fetch(`${baseUrl}/mcp/log-tools`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(initializeBody(2))
    });
    assert.equal(first.status, 200);
    const firstSession = first.headers.get('mcp-session-id');
    assert.ok(firstSession, 'initialize 应返回 mcp-session-id');

    const second = await fetch(`${baseUrl}/mcp/log-tools`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(initializeBody(3))
    });
    assert.equal(second.status, 200);
    const secondSession = second.headers.get('mcp-session-id');
    assert.ok(secondSession && secondSession !== firstSession, '第二个 initialize 应创建新 session');

    const healthAfter = await (await fetch(`${baseUrl}/healthz`)).json();
    assert.equal(healthAfter.session_count, 1, '超过数量上限后应淘汰最旧 session');
    console.log('  [http] session 数量上限 ok');

    console.log('HTTP guard test passed');
} finally {
    serverProcess.kill('SIGTERM');
    await delay(300);
}
