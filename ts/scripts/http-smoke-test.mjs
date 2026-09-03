import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const port = Number(process.env.MCP_HTTP_PORT || 3101);
const baseUrl = `http://127.0.0.1:${port}`;
const authHeader = 'apikey demo-user:demo-secret';

async function waitForServerReady(serverProcess) {
    let serverOutput = '';

    serverProcess.stdout.on('data', (chunk) => {
        serverOutput += chunk.toString();
    });
    serverProcess.stderr.on('data', (chunk) => {
        serverOutput += chunk.toString();
    });

    for (let i = 0; i < 40; i += 1) {
        if (serverProcess.exitCode !== null) {
            throw new Error(`HTTP server 提前退出: ${serverOutput}`);
        }

        try {
            const response = await fetch(`${baseUrl}/healthz`);
            if (response.ok) {
                return;
            }
        } catch {
        }

        await delay(250);
    }

    throw new Error(`HTTP server 未在预期时间内启动: ${serverOutput}`);
}

async function jsonRequest(path, body, extraHeaders = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            ...extraHeaders
        },
        body: JSON.stringify(body)
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : null;

    return {
        status: response.status,
        headers: response.headers,
        json
    };
}

async function initializeSession(serverName) {
    const response = await jsonRequest(`/mcp/${serverName}`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: {
                name: 'smoke-test',
                version: '1.0.0'
            }
        }
    }, {
        Authorization: authHeader
    });

    if (response.status !== 200) {
        throw new Error(`${serverName} initialize 失败: ${response.status} ${JSON.stringify(response.json)}`);
    }

    const sessionId = response.headers.get('mcp-session-id');
    if (!sessionId) {
        throw new Error(`${serverName} initialize 缺少 mcp-session-id`);
    }

    return sessionId;
}

async function deleteSession(serverName, sessionId) {
    const deleteResponse = await fetch(`${baseUrl}/mcp/${serverName}`, {
        method: 'DELETE',
        headers: {
            Authorization: authHeader,
            'mcp-session-id': sessionId
        }
    });

    if (deleteResponse.status !== 204) {
        throw new Error(`${serverName} delete session 失败: ${deleteResponse.status}`);
    }
}

async function assertToolsList(serverName, expectedMinimum) {
    const sessionId = await initializeSession(serverName);
    const response = await jsonRequest(`/mcp/${serverName}`, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
    }, {
        Authorization: authHeader,
        'mcp-session-id': sessionId
    });

    if (response.status !== 200) {
        throw new Error(`${serverName} tools/list 失败: ${response.status} ${JSON.stringify(response.json)}`);
    }

    const toolCount = response.json?.result?.tools?.length ?? 0;
    if (toolCount < expectedMinimum) {
        throw new Error(`${serverName} tools/list 数量异常: ${toolCount}`);
    }

    await deleteSession(serverName, sessionId);
}

async function assertStructuredContentForManage() {
    const sessionId = await initializeSession('manage');
    const response = await jsonRequest('/mcp/manage', {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
            name: 'select_module',
            arguments: {}
        }
    }, {
        Authorization: authHeader,
        'mcp-session-id': sessionId
    });

    if (response.status !== 200) {
        throw new Error(`manage tools/call 失败: ${response.status} ${JSON.stringify(response.json)}`);
    }

    const result = response.json?.result ?? {};
    if (!Array.isArray(result.content) || !result.structuredContent || !Array.isArray(result.structuredContent.modules)) {
        throw new Error(`manage structuredContent 缺失或格式异常: ${JSON.stringify(result)}`);
    }

    await deleteSession('manage', sessionId);
}

async function assertStructuredContentForLogSearchSheet() {
    const timeRange = process.env.MCP_SMOKE_LOG_SEARCH_TIME_RANGE;
    if (!timeRange) {
        return;
    }

    const sessionId = await initializeSession('log-tools');
    const response = await jsonRequest('/mcp/log-tools', {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
            name: 'log_search_sheet',
            arguments: {
                time_range: timeRange,
                query: process.env.MCP_SMOKE_LOG_SEARCH_QUERY || '*',
                index_name: process.env.MCP_SMOKE_LOG_SEARCH_INDEX || 'yotta',
                size: Number(process.env.MCP_SMOKE_LOG_SEARCH_SIZE || 1),
                result_delivery: 'inline'
            }
        }
    }, {
        Authorization: authHeader,
        'mcp-session-id': sessionId
    });

    if (response.status !== 200) {
        throw new Error(`log-tools log_search_sheet 失败: ${response.status} ${JSON.stringify(response.json)}`);
    }

    const result = response.json?.result ?? {};
    const sc = result.structuredContent ?? {};

    if (!sc || typeof sc !== 'object') {
        throw new Error(`log_search_sheet structuredContent 缺失: ${JSON.stringify(result)}`);
    }

    if (!Array.isArray(sc.hits)) {
        throw new Error(`log_search_sheet structuredContent.hits 格式异常: ${JSON.stringify(sc)}`);
    }

    if (typeof sc.total !== 'number' || typeof sc.page !== 'number' || typeof sc.size !== 'number' || typeof sc.has_more !== 'boolean') {
        throw new Error(`log_search_sheet structuredContent 关键字段缺失或类型异常: ${JSON.stringify(sc)}`);
    }

    await deleteSession('log-tools', sessionId);
}

async function main() {
    const serverProcess = spawn(process.execPath, ['./dist/http-server.js'], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            MCP_HTTP_PORT: String(port)
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    try {
        await waitForServerReady(serverProcess);

        const noAuthResponse = await jsonRequest('/mcp/log-tools', {
            jsonrpc: '2.0',
            id: 100,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: {
                    name: 'smoke-test',
                    version: '1.0.0'
                }
            }
        });

        if (noAuthResponse.status !== 401) {
            throw new Error(`未鉴权 initialize 应返回 401，实际为 ${noAuthResponse.status}`);
        }

        await assertToolsList('log-tools', 10);
        await assertToolsList('manage', 1);
        await assertStructuredContentForManage();
        await assertStructuredContentForLogSearchSheet();

        console.log('HTTP smoke test passed');
    } finally {
        serverProcess.kill('SIGTERM');
        await delay(300);
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
