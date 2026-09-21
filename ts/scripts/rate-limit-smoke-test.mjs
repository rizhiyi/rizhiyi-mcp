import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const port = Number(process.env.MCP_RATE_LIMIT_SMOKE_PORT || 3102);
const baseUrl = `http://127.0.0.1:${port}`;
const authorization = 'apikey rate-limit-smoke:secret';

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
    const serverProcess = spawn(process.execPath, ['./dist/http-server.js'], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            MCP_HTTP_PORT: String(port),
            MCP_RATE_LIMIT_GLOBAL_PER_MINUTE: '1',
            MCP_RATE_LIMIT_PER_TOOL: '{}'
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

        console.log('Rate limit HTTP smoke test passed');
    } finally {
        serverProcess.kill('SIGTERM');
        await delay(300);
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
