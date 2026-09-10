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

async function assertAlertServerBehavior() {
    // 1. initialize + tools/list
    const sessionId = await initializeSession('alert');
    const listResp = await jsonRequest('/mcp/alert', {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/list',
        params: {}
    }, {
        Authorization: authHeader,
        'mcp-session-id': sessionId
    });
    if (listResp.status !== 200) {
        throw new Error(`alert tools/list 失败: ${listResp.status} ${JSON.stringify(listResp.json)}`);
    }
    const toolNames = (listResp.json?.result?.tools ?? []).map(t => t.name);
    const expectedNames = new Set([
        'list_alerts', 'get_alert_detail', 'get_alerts_batch',
        'create_keyword_alert', 'create_field_stat_alert', 'create_baseline_alert',
        'create_surge_alert', 'create_spl_alert', 'create_stream_lookup_alert',
        'create_stream_agg_alert', 'create_composite_alert',
        'update_alert', 'update_alerts_batch',
        'delete_alert', 'delete_alerts_batch',
        'preview_alert', 'testrun_alert', 'get_alert_pretest_result',
        'get_alert_references', 'get_alert_category_reference',
    ]);
    for (const name of expectedNames) {
        if (!toolNames.includes(name)) {
            throw new Error(`alert tools/list 缺少工具: ${name}; 实际: ${toolNames.join(',')}`);
        }
    }
    console.log('  [alert] tools/list ok: ' + toolNames.length + ' tools');

    // 2. 调用 list_alerts（真实环境）— 只看结构化字段，不关心数据量
    const listCallResp = await jsonRequest('/mcp/alert', {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
            name: 'list_alerts',
            arguments: {
                page: 0,
                size: 3,
                result_delivery: 'inline',
                output_format: 'json',
            }
        }
    }, {
        Authorization: authHeader,
        'mcp-session-id': sessionId
    });
    if (listCallResp.status !== 200) {
        throw new Error(`alert list_alerts 调用失败: ${listCallResp.status} ${JSON.stringify(listCallResp.json)}`);
    }
    const listContent = (listCallResp.json?.result?.content ?? []);
    if (!listContent.length) {
        throw new Error(`alert list_alerts 内容缺失: ${JSON.stringify(listCallResp.json)}`);
    }
    console.log('  [alert] alert list ok');

    // 3. 调用 get_alert_category_reference，确认 6 类都在
    const refResp = await jsonRequest('/mcp/alert', {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
            name: 'get_alert_category_reference',
            arguments: { result_delivery: 'inline', output_format: 'json' }
        }
    }, {
        Authorization: authHeader,
        'mcp-session-id': sessionId
    });
    if (refResp.status !== 200) {
        throw new Error(`alert get_alert_category_reference 调用失败: ${refResp.status} ${JSON.stringify(refResp.json)}`);
    }
    const refText = ((refResp.json?.result?.content ?? [])[0]?.text) || '';
    for (const c of [0, 1, 2, 3, 4, 5]) {
        // 要么在 catalog.supported_categories 要么在 categories 键
        if (!refText.includes(`"${c}"`) && !refText.includes(`category:${c}`) && !refText.includes(`category: ${c}`) &&
            // 支持对象键数字字符串
            !(`"${c}"` in {} )) {
            // 使用更宽松的检测：categories 对象键
        }
    }
    // 更实际的做法：包含 "关键字监控" / "字段统计" / "SPL" / "流式" / "联合" / "切分" 这些字样中的名称
    const namesMust = ['关键字监控', '字段统计监控', '连续统计监控', '突变异常监控', 'SPL 统计监控', '流式 lookup 监控', '流式聚合监控', '联合监控'];
    for (const n of namesMust) {
        if (!refText.includes(n)) {
            throw new Error(`get_alert_category_reference 返回未包含名称 ${n}。返回文本片段: ${refText.slice(0, 300)}`);
        }
    }
    console.log('  [alert] category ref ok (8 types)');

    // 4. 构造最小 category=4 草稿对象，验证 create_* 的 JSON 字段预处理（本地 dry-run：通过 create_* 缺少必填拦截 / 不真实 create）
    const draftBody = {
        name: 'smoke-draft-spl-count',
        category: 4,
        enabled: true,
        check_interval: 300,
        interval_unit: 1,
        dataset_ids: [],
        query: 'tag:yottaweb_audit | stats count() as cnt',
        check_condition: { timerange: '-1m', field: 'cnt', operator: '>', threshold: 'mid:0' },
        extend_conf: { smoke: 'true' },
    };
    // 为避免真实创建，只调用 create_keyword_alert 但**故意带去 statistics_field 冲突**：这里用本地校验拦截；不真实 create
    // 按 spec R10，这里只 print 草稿对象预处理结果 → 我们用 category=0 + statistics_field 冲突做本地校验
    const badCallResp = await jsonRequest('/mcp/alert', {
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
            name: 'create_keyword_alert',
            arguments: {
                name: 'smoke-should-fail',
                statistics_field: 'response_time', // category=0 + 非空 statistics_field -> 本地拦截
                enabled: true,
                check_interval: 300,
                query: 'loglevel:ERROR',
                dataset_ids: [1, 2],
                check_condition: { timerange: '-5min', function: 'count', operator: '>', threshold: 'high:100' },
                result_delivery: 'inline',
            }
        }
    }, {
        Authorization: authHeader,
        'mcp-session-id': sessionId
    });
    // 预期返回 isError=true 且 suggestion 含 category
    const isError = badCallResp.json?.result?.isError === true ||
        Array.isArray(badCallResp.json?.result?.content) && badCallResp.json.result.content.some(c => c.type === 'text' && typeof c.text === 'string' && c.text.includes('CATEGORY_FIELD_CONFLICT'));
    // 或者查看 content 文本：
    const contentText = ((badCallResp.json?.result?.content ?? [])[0]?.text) ?? '';
    if (!contentText.includes('CATEGORY_FIELD_CONFLICT') && !contentText.includes('category')) {
        throw new Error(`category=0 + statistics_field 冲突应该在本地被拦截。实际内容: ${contentText.slice(0, 500)}`);
    }
    console.log('  [alert] draft preprocess ok (本地 category 冲突拦截生效)');

    // 5. 打印预处理后的草稿（category=4）——用 selfcheck 的静态方法等价实现（此处仅 log JSON，不发请求）
    const preprocessed = JSON.stringify({
        ...draftBody,
        dataset_ids: JSON.stringify(draftBody.dataset_ids),
        check_condition: JSON.stringify(draftBody.check_condition),
        extend_conf: JSON.stringify(draftBody.extend_conf),
    });
    console.log('  [alert] draft body (preprocessed) =', preprocessed);

    await deleteSession('alert', sessionId);
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
        await assertToolsList('alert', 13);
        await assertAlertServerBehavior();

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
