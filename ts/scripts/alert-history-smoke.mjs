#!/usr/bin/env node
/**
 * alert-history-smoke.mjs
 *
 * 端到端冒烟：用真实环境跑一遍 get_triggered_alerts 的完整链路
 * （构造 SPL → /api/v3/search/sheets/ → 规整成六要素）。
 *
 * 需要环境变量（与 MCP 服务一致）：
 *   LOGEASE_BASE_URL   例如 http://172.21.16.9
 *   LOGEASE_API_KEY    user:secret 形式，例如 tmp:xxxxx
 *   LOGEASE_AUTH_HEADER  可选，直接给完整 Authorization 头（优先于 API_KEY）
 *
 * 用法：
 *   node ts/scripts/alert-history-smoke.mjs [--time-range -1d,now] [--size 5] [--alert-name "交换机*"]
 *
 * 认证：
 *   - apikey 版：LOGEASE_API_KEY=user:secret（会带上 username 查询参数）
 *   - basic 版：LOGEASE_AUTH_HEADER="Basic <base64(user:password)>"（不传 username 参数）
 *
 * 注意：沙箱里 curl 可能被代理拦截，这里统一用 Node 原生 fetch。
 */

import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(__dirname, '..', 'dist');
const require = createRequire(import.meta.url);

let AlertsModule;
try {
    ({ AlertsModule } = require(resolve(distRoot, 'modules/alerts.js')));
} catch (error) {
    console.error('[FATAL] 无法加载 ts/dist/modules/alerts.js，请先 `cd ts && npm run build`。');
    console.error('  details:', String(error?.message || error));
    process.exit(2);
}

function readArg(name, fallback) {
    // 同时支持 `--size 3` 与 `--size=3` 两种写法
    const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`));
    if (inline) return inline.slice(name.length + 3);
    const index = process.argv.indexOf(`--${name}`);
    if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
    return fallback;
}

const baseUrl = (process.env.LOGEASE_BASE_URL || '').replace(/\/+$/, '');
const apiKey = process.env.LOGEASE_API_KEY || '';
const authHeader = process.env.LOGEASE_AUTH_HEADER || '';

if (!baseUrl) {
    console.error('[SKIP] 未设置 LOGEASE_BASE_URL，跳过真实环境冒烟。');
    process.exit(0);
}

let authorization = authHeader;
let username = '';
if (!authorization) {
    if (!apiKey) {
        console.error('[SKIP] 未设置 LOGEASE_API_KEY / LOGEASE_AUTH_HEADER，跳过真实环境冒烟。');
        process.exit(0);
    }
    const separator = apiKey.indexOf(':');
    if (separator > 0) {
        username = apiKey.slice(0, separator).trim();
        authorization = `apikey ${apiKey.slice(separator + 1).trim()}`;
    } else {
        authorization = `apikey ${apiKey.trim()}`;
    }
}

const service = new AlertsModule(null);
const params = {
    time_range: readArg('time-range', '-1d,now'),
    size: Number(readArg('size', '5')),
    include_search_url: true,
};
const alertName = readArg('alert-name', '');
if (alertName) params.alert_name = alertName;

const built = service.buildHistoryQuery(params);
if (built.error) {
    console.error('[FATAL] buildHistoryQuery 失败:', JSON.stringify(built.error, null, 2));
    process.exit(1);
}
const plan = built.value;

async function fetchPage(page) {
    const search = new URLSearchParams({
        query: plan.query,
        time_range: plan.time_range,
        page: String(page),
        size: String(plan.size),
    });
    if (username) search.set('username', username);
    const response = await fetch(`${baseUrl}/api/v3/search/sheets/?${search.toString()}`, {
        headers: { Authorization: authorization, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`上游 HTTP ${response.status}`);
    const data = await response.json();
    if (data && data.error) throw new Error(`上游返回错误: ${JSON.stringify(data.error)}`);
    const rows = AlertsModule.extractHistoryRows(data);
    return AlertsModule.normalizeHistory(rows, plan, AlertsModule.extractHistoryTotal(data));
}

console.log(`[smoke] ${baseUrl}/api/v3/search/sheets/  time_range=${plan.time_range} size=${plan.size}`);
if (alertName) console.log(`[smoke] alert_name=${JSON.stringify(alertName)}`);

let payload;
let page1 = null;
try {
    payload = await fetchPage(plan.page);
    // 分页回归：SPL 里一旦写死 `| limit`，page>=1 会恒返回 0 行。
    if (payload.total !== null && payload.total > plan.size) {
        page1 = await fetchPage(plan.page + 1);
    }
} catch (error) {
    console.error('[FATAL] 请求失败:', String(error?.message || error));
    process.exit(1);
}

let failures = 0;
const assert = (condition, message) => {
    if (condition) {
        console.log(`  ✓ ${message}`);
    } else {
        failures += 1;
        console.error(`  ✗ ${message}`);
    }
};

console.log('\n=== 结果概览 ===');
console.log(`  total=${payload.total} returned=${payload.returned} has_more=${payload.has_more}`);
console.log(`  level_counts=${JSON.stringify(payload.level_counts)}`);
if (payload.entity_candidates) console.log(`  entity_candidates=${JSON.stringify(payload.entity_candidates)}`);
for (const warning of payload.warnings) console.log(`  [warn] ${warning}`);

console.log('\n=== 断言 ===');
assert(Array.isArray(payload.alerts), 'alerts 是数组');
assert(payload.total === null || payload.total >= payload.returned, 'total 不小于本页条数');
assert(payload.entity_fields === undefined, '返回结构不再回显入参 entity_fields');
assert(!plan.query.includes('| limit '), 'SPL 未硬编码 | limit');
if (alertName) {
    const clause = plan.query.split(' | ')[0].split(' ').find((part) => part.startsWith('alert_name:')) || '(无 alert_name 子句)';
    console.log(`  [info] alert_name ${JSON.stringify(alertName)} → ${clause}`);
    assert(payload.alerts.length > 0, '通配模式应能匹配到记录');
    // 回归：like() 是管道过滤、不走索引，不该再出现
    assert(!plan.query.includes('| where like'), 'SPL 不应再使用 | where like 管道过滤');
}
for (const [index, item] of payload.alerts.entries()) {
    const label = `alerts[${index}] ${item.alert_name}`;
    assert(typeof item.alert_name === 'string' && item.alert_name.length > 0, `${label} 有告警名称`);
    assert(typeof item.trigger_time === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(item.trigger_time), `${label} 有触发时间`);
    assert(typeof item.trigger_time_ms === 'number', `${label} 有触发毫秒时间戳`);
    assert(typeof item.level === 'string' || item.level === null, `${label} level 类型合法`);
    assert(typeof item.entities === 'object' && item.entities !== null, `${label} entities 是对象`);
    assert(['segmentation_value', 'entity_fields', 'complex_value', 'none'].includes(item.entity_source), `${label} entity_source 合法`);
    assert(['result.description', 'strategy_trigger_desc', 'strategy_description', 'notification_text', 'none'].includes(item.description_source), `${label} description_source 合法`);
    assert(item.description === null || typeof item.description === 'string', `${label} description 类型合法`);
}

if (page1) {
    console.log('\n=== 分页 ===');
    console.log(`  page=1 returned=${page1.returned}`);
    const key = (p) => p.alerts.map((item) => `${item.alert_id}|${item.trigger_time_ms}`).join(',');
    assert(page1.returned > 0, 'page=1 应返回数据（SPL 写死 | limit 时会恒为 0）');
    if (key(payload) === key(page1)) {
        // 实测：env1 正常翻页；env2 那套构建直接忽略 page 参数、恒返回首页。
        // 这是服务端行为，SPL 层面绕不过去，如实报告而非判失败。
        console.log('  [warn] 该日志易构建忽略 page 参数（page=1 与 page=0 内容相同）；' +
            '需要收窄结果请调小 size 或缩小 time_range / 加 alert_name 过滤。');
    } else {
        assert(true, 'page=1 的内容与 page=0 不同（服务端支持翻页）');
    }
}

console.log('');
if (failures === 0) {
    console.log('alert-history-smoke: ALL PASSED ✓');
    process.exit(0);
}
console.log(`alert-history-smoke: FAILURES=${failures}`);
process.exit(1);
