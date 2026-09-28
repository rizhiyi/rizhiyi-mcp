import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { FixedWindowRateLimiter } from '../dist/rate-limiting.js';

const port = Number(process.env.MCP_RATE_LIMIT_SMOKE_PORT || 3102);
const baseUrl = `http://127.0.0.1:${port}`;
const authorization = 'apikey rate-limit-smoke:secret';

// 进程内断言：锁住“被拒绝的请求不占用配额”这一语义（与 Python 侧保持一致）。
function assertLimiterSemantics() {
    const boundary = new FixedWindowRateLimiter(2, {}, 60, () => 100);
    if (!boundary.consume('r', 'a').allowed) throw new Error('limit=2 第 1 次应放行');
    if (!boundary.consume('r', 'a').allowed) throw new Error('limit=2 第 2 次应放行');
    const denied = boundary.consume('r', 'a');
    if (denied.allowed || denied.scope !== 'global' || denied.limit !== 2 || denied.current !== 3 || denied.remaining !== 0) {
        throw new Error(`边界语义不符合预期: ${JSON.stringify(denied)}`);
    }

    const inflate = new FixedWindowRateLimiter(1, {}, 60, () => 100);
    if (!inflate.consume('r', 'a').allowed) throw new Error('limit=1 第 1 次应放行');
    const currents = [inflate.consume('r', 'a').current, inflate.consume('r', 'a').current, inflate.consume('r', 'a').current];
    if (currents.join(',') !== '2,2,2') {
        throw new Error(`被拒绝调用不应让 current 膨胀，实际: ${currents.join(',')}`);
    }

    const globalQuota = new FixedWindowRateLimiter(2, { tool_a: 1 }, 60, () => 100);
    if (!globalQuota.consume('r', 'tool_a').allowed) throw new Error('tool_a 首次应放行');
    const toolDenied = globalQuota.consume('r', 'tool_a');
    if (toolDenied.allowed || toolDenied.scope !== 'tool') {
        throw new Error(`tool_a 第二次应被 tool 维度拒绝: ${JSON.stringify(toolDenied)}`);
    }
    if (!globalQuota.consume('r', 'tool_b').allowed) {
        throw new Error('被拒绝的 tool_a 调用不应占用全局配额，tool_b 应仍可用');
    }
}

async function waitForServerReady(serverProcess) {
    let output = '';
    serverProcess.stdout.on('data', chunk => { output += chunk.toString(); });
    serverProcess.stderr.on('data', chunk => { output += chunk.toString(); });

    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (serverProcess.exitCode !== null) {
            throw new Error(`HTTP server 提前退出: ${output}`);
        }
        try {
            const response = await fetch(`${baseUrl}/healthz`);
            if (response.ok) {
                return response.json();
            }
        } catch {
        }
        await delay(250);
    }
    throw new Error(`HTTP server 未在预期时间内启动: ${output}`);
}

async function post(path, body, sessionId) {
    const headers = {
        Authorization: authorization,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream'
    };
    if (sessionId) {
        headers['mcp-session-id'] = sessionId;
    }
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
    return { response, body: await response.json() };
}

async function main() {
    assertLimiterSemantics();

    const logDirectory = await mkdtemp(path.join(tmpdir(), 'rizhiyi-rate-limit-log-'));
    const serverProcess = spawn(process.execPath, ['./dist/http-server.js'], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            MCP_HTTP_PORT: String(port),
            MCP_RATE_LIMIT_GLOBAL_PER_MINUTE: '1',
            MCP_RATE_LIMIT_PER_TOOL: '{}',
            RIZHIYI_LOG_DIR: logDirectory
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    try {
        const health = await waitForServerReady(serverProcess);
        if (!health.rate_limiting?.enabled || health.rate_limiting.global_per_minute !== 1) {
            throw new Error(`healthz 未报告预期限流配置: ${JSON.stringify(health)}`);
        }

        const initialized = await post('/mcp/manage', {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'rate-limit-smoke', version: '1.0.0' }
            }
        });
        const sessionId = initialized.response.headers.get('mcp-session-id');
        if (initialized.response.status !== 200 || !sessionId) {
            throw new Error(`initialize 失败: ${JSON.stringify(initialized.body)}`);
        }

        const toolCall = id => post('/mcp/manage', {
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: { name: 'select_module', arguments: {} }
        }, sessionId);

        const first = await toolCall(2);
        const second = await toolCall(3);
        if (first.body?.result?.isError) {
            throw new Error(`第一次工具调用不应被限流: ${JSON.stringify(first.body)}`);
        }
        if (
            second.body?.result?.isError !== true
            || second.body?.result?.structuredContent?.error_code !== 'RATE_LIMIT_EXCEEDED'
            || second.body?.result?.structuredContent?.details?.scope !== 'global'
        ) {
            throw new Error(`第二次工具调用未返回预期限流错误: ${JSON.stringify(second.body)}`);
        }

        const logNames = (await readdir(logDirectory)).filter(name => name.endsWith('.log'));
        if (logNames.length !== 1) {
            throw new Error(`预期生成一个使用日志文件，实际: ${JSON.stringify(logNames)}`);
        }
        const entries = (await readFile(path.join(logDirectory, logNames[0]), 'utf8'))
            .trim()
            .split('\n')
            .map(line => JSON.parse(line));
        if (
            entries.length !== 2
            || entries[0].status !== 'ok'
            || entries[1].status !== 'ok-limited'
            || entries[1].error_code !== 'RATE_LIMIT_EXCEEDED'
            || entries[0].session_id !== sessionId
            || entries[0].user !== 'rate-limit-smoke'
            || 'arguments' in entries[0]
        ) {
            throw new Error(`使用日志内容不符合预期: ${JSON.stringify(entries)}`);
        }

        console.log('Rate limit HTTP smoke test passed');
    } finally {
        serverProcess.kill('SIGTERM');
        await delay(300);
        await rm(logDirectory, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
