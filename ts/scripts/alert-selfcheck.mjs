#!/usr/bin/env node
/**
 * alert-selfcheck.mjs
 *
 * 纯函数自测脚本：验证 AlertsModule 的静态辅助方法，不发起任何网络请求，不读取密钥。
 * 直接运行：node ts/scripts/alert-selfcheck.mjs
 *   —— 或者在 build 之后使用已编译的版本同样可测，因为只依赖静态方法。
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createRequire } from 'module';

// 找到 dist 中编译后的 modules/alerts.js（因为 TS strict ESM，从 dist 加载更直接）
const __dirname = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(__dirname, '..', 'dist');
const require = createRequire(import.meta.url);

let AlertsModule;
try {
    const mod = require(resolve(distRoot, 'modules/alerts.js'));
    AlertsModule = mod.AlertsModule;
} catch (e) {
    console.error('[FATAL] 无法从 ts/dist/modules/alerts.js 加载 AlertsModule。请先 `cd ts && npm run build`。');
    console.error('  details:', String(e?.message || e));
    process.exit(2);
}

let failures = 0;
const errors = [];

function assert(cond, msg) {
    if (!cond) {
        failures++;
        errors.push(new Error(msg).stack || msg);
        console.error('  ✗ FAIL:', msg);
    } else {
        console.log('  ✓ PASS');
    }
}

const buildError = (code, msg, sug, det) => ({ error_code: code, error: msg, suggestion: sug, details: det });

function normalizeFieldStatic(raw, fieldPath, allowObject = true) {
    // 复制 alerts.ts 里 normalizeJsonEncodedMutationField 的核心逻辑
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return { error: buildError('INVALID_JSON_STRING', `${fieldPath} 空串`, 'fix') };
        try { JSON.parse(trimmed); return { value: trimmed }; }
        catch (e) { return { error: buildError('INVALID_JSON_STRING', `${fieldPath} 非法`, 'fix', { parse_error: e.message }) }; }
    }
    if (Array.isArray(raw) || (allowObject && !!raw && typeof raw === 'object' && !Array.isArray(raw))) {
        return { value: JSON.stringify(raw) };
    }
    return { error: buildError('INVALID_PARAM_TYPE', `${fieldPath} 类型错`, 'fix') };
}

// ---- Test 1: preprocessJsonFieldsStatic 正常预处理（T1-4 / T6-2 ①） ----
console.log('\n=== Test 1: preprocessJsonFieldsStatic — 正常预处理 ===');
{
    const body = {
        dataset_ids: [1, 2],
        check_condition: { timerange: '-5min', function: 'count', operator: '>', threshold: 'high:0' },
        extend_conf: { module: 'sec', severity: 'warning' },
        run_results: [{ ok: 1 }],
        composite_info: '{"A":1}', // 合法 JSON 字符串，保持为字符串
        extend_dataset_ids: [],
        name: 'test-alert',
    };
    const res = AlertsModule.preprocessJsonFieldsStatic(body, 'create_alert.rule', buildError, normalizeFieldStatic);
    assert(!res.error, '不应返回 error');
    assert(typeof res.value.dataset_ids === 'string' && res.value.dataset_ids === '[1,2]',
        `dataset_ids 应为 JSON 字符串 "[1,2]"，实际 ${String(res.value?.dataset_ids)}`);
    assert(typeof res.value.check_condition === 'string', 'check_condition 应序列化为字符串');
    const parsedCC = JSON.parse(res.value.check_condition);
    assert(parsedCC.function === 'count' && parsedCC.timerange === '-5min', 'check_condition 内容不变');
    assert(typeof res.value.extend_conf === 'string' && JSON.parse(res.value.extend_conf).module === 'sec', 'extend_conf 正确序列化');
    assert(typeof res.value.run_results === 'string', 'run_results 正确序列化');
    assert(res.value.composite_info === '{"A":1}', '合法 JSON 字符串不被二次修改');
    assert(res.value.name === 'test-alert', '非 JSON 字段原样保留');
}

// ---- Test 2: preprocessJsonFieldsStatic — 非法 JSON 字符串被本地拦截（T6-2 ②） ----
console.log('\n=== Test 2: preprocessJsonFieldsStatic — 非法 JSON 字符串拦截 ===');
{
    const body = { check_condition: '[1,' };
    const res = AlertsModule.preprocessJsonFieldsStatic(body, 'create_alert.rule', buildError, normalizeFieldStatic);
    assert(!!res.error, '非法 check_condition 必须返回 error');
    assert(res.error?.error_code === 'INVALID_JSON_STRING', `错误码应为 INVALID_JSON_STRING，实际 ${res.error?.error_code}`);
    assert(!!res.error?.details?.parse_error, '错误详情应包含 parse_error');
}

// ---- Test 3: validateCategoryFieldConflictsStatic — category=0 + statistics_field 冲突（T1-2 / T6-2 ③） ----
console.log('\n=== Test 3: category=0 关键字冲突 ===');
{
    const body = { category: 0, statistics_field: 'response_time' };
    const err = AlertsModule.validateCategoryFieldConflictsStatic(body, 'create_alert', buildError);
    assert(!!err, 'category=0 + statistics_field 必须报错');
    assert(String(err.suggestion).includes('category') && String(err.suggestion).includes('0'),
        `suggestion 必须包含 "category" 与 "0"，实际：${String(err.suggestion)}`);
}

// ---- Test 3b: category=1 缺 check_condition.field 报错 ----
console.log('\n=== Test 3b: category=1 缺 check_condition.field ===');
{
    const body = { category: 1, query: 'a', check_interval: 300, check_condition: { function: 'avg', timerange: '-5m' } };
    const err = AlertsModule.validateCategoryFieldConflictsStatic(body, 'create_alert', buildError);
    assert(!!err, 'category=1 缺 check_condition.field 必须报错');
    assert(String(err.suggestion).includes('field'), 'suggestion 指出 check_condition.field 必填');
}

// ---- Test 3c: category=2 缺 check_condition.base_value ----
console.log('\n=== Test 3c: category=2 缺 check_condition.base_value ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 2, check_condition: { timerange: '-10m', field: 'cnt' } }, 'x', buildError);
    assert(!!err && String(err.suggestion).includes('base_value'), '缺 base_value 报错');
}

// ---- Test 3d: category=3 缺 check_condition.base_timerange ----
console.log('\n=== Test 3d: category=3 缺 check_condition.base_timerange ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 3, query: 'a', check_condition: { timerange: '-1m' } }, 'x', buildError);
    assert(!!err && String(err.suggestion).includes('base_timerange'), '缺 base_timerange 报错');
}

// ---- Test 3e: category=5 缺 topic ----
console.log('\n=== Test 3e: category=5 缺 topic ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 5, query: 'a | lookup x' }, 'x', buildError);
    assert(!!err && String(err.suggestion).includes('topic'), '缺 topic 报错');
}

// ---- Test 3f: category=4 SPL 正常场景（含 timerange + executor_id）----
console.log('\n=== Test 3f: category=4 SPL 正常场景 ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 4, query: 'a | stats count() as cnt', executor_id: 1, check_condition: { timerange: '-1m', field: 'cnt' } }, 'x', buildError);
    assert(!err, 'category=4 含 timerange + executor_id 不应触发冲突');
}

// ---- Test 3f2: category=4 缺 timerange 报错 ----
console.log('\n=== Test 3f2: category=4 缺 timerange ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 4, query: 'a | stats count() as cnt', executor_id: 1, check_condition: { field: 'cnt' } }, 'x', buildError);
    assert(!!err && String(err.suggestion).includes('timerange'), 'category=4 缺 timerange 报错');
}

// ---- Test 3g: category=0 关键字 正常场景（含 timerange + executor_id）----
console.log('\n=== Test 3g: category=0 关键字 正常场景 ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 0, query: 'loglevel:ERROR', executor_id: 1, check_condition: { timerange: '-5min' } }, 'x', buildError);
    assert(!err, 'category=0 正确场景无冲突');
}

// ---- Test 3h: category=19 缺 composite_info ----
console.log('\n=== Test 3h: category=19 缺 composite_info ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 19, query: '*' }, 'x', buildError);
    assert(!!err && String(err.suggestion).includes('composite_info'), '缺 composite_info 报错');
}

// ---- Test 3i: category=19 联合监控 正常场景（含 composite_info + executor_id）----
console.log('\n=== Test 3i: category=19 联合监控 正常场景 ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 19, query: '*', executor_id: 1, composite_info: { operator: 'or', children: [] } }, 'x', buildError);
    assert(!err, 'category=19 有 composite_info + executor_id 无冲突');
}

// ---- Test 3i2: category=19 缺 executor_id 报错 ----
console.log('\n=== Test 3i2: category=19 缺 executor_id ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 19, query: '*', composite_info: { operator: 'or', children: [] } }, 'x', buildError);
    assert(!!err && String(err.suggestion).includes('executor_id'), 'category=19 缺 executor_id 报错');
}

// ---- Test 3j: category=1 字段统计 正常场景（含 timerange + executor_id）----
console.log('\n=== Test 3j: category=1 字段统计 正常场景 ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 1, query: 'a', executor_id: 1, check_condition: { field: 'response_time', function: 'avg', timerange: '-10m' } }, 'x', buildError);
    assert(!err, 'category=1 有 check_condition.field + timerange + executor_id 无冲突');
}

// ---- Test 3j2: category=1 缺 timerange 报错 ----
console.log('\n=== Test 3j2: category=1 缺 timerange ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 1, query: 'a', executor_id: 1, check_condition: { field: 'response_time', function: 'avg' } }, 'x', buildError);
    assert(!!err && String(err.suggestion).includes('timerange'), 'category=1 缺 timerange 报错');
}

// ---- Test 3k: category=2 连续统计 正常场景（含 timerange + executor_id）----
console.log('\n=== Test 3k: category=2 连续统计 正常场景 ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 2, query: 'a', executor_id: 1, check_condition: { base_value: '5', base_comparator: '>', timerange: '-10m' } }, 'x', buildError);
    assert(!err, 'category=2 有 base_value + timerange + executor_id 无冲突');
}

// ---- Test 3k2: category=2 缺 timerange 报错 ----
console.log('\n=== Test 3k2: category=2 缺 timerange ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 2, query: 'a', executor_id: 1, check_condition: { base_value: '5', base_comparator: '>' } }, 'x', buildError);
    assert(!!err && String(err.suggestion).includes('timerange'), 'category=2 缺 timerange 报错');
}

// ---- Test 3l: category=3 突变异常 正常场景（含 timerange + executor_id）----
console.log('\n=== Test 3l: category=3 突变异常 正常场景 ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 3, query: 'a', executor_id: 1, check_condition: { base_timerange: 'now-2m,now-1m', timerange: '-1m' } }, 'x', buildError);
    assert(!err, 'category=3 有 base_timerange + timerange + executor_id 无冲突');
}

// ---- Test 3l2: category=3 缺 timerange 报错 ----
console.log('\n=== Test 3l2: category=3 缺 timerange ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 3, query: 'a', executor_id: 1, check_condition: { base_timerange: 'now-2m,now-1m' } }, 'x', buildError);
    assert(!!err && String(err.suggestion).includes('timerange'), 'category=3 缺 timerange 报错');
}

// ---- Test 3m: category=6 缺 topic 报错 ----
console.log('\n=== Test 3m: category=6 缺 topic ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 6, query: 'a | stats count() as cnt by tag' }, 'x', buildError);
    assert(!!err && String(err.suggestion).includes('topic'), 'cat=6 缺 topic 报错');
}

// ---- Test 3n: category=6 流式聚合 正常场景（含 executor_id）----
console.log('\n=== Test 3n: category=6 流式聚合 正常场景 ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 6, query: 'a | stats count() as cnt by tag', topic: 'raw_message', executor_id: 1 }, 'x', buildError);
    assert(!err, 'category=6 有 topic + executor_id 无冲突');
}

// ---- Test 3n2: category=6 缺 executor_id 报错 ----
console.log('\n=== Test 3n2: category=6 缺 executor_id ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 6, query: 'a | stats count() as cnt by tag', topic: 'raw_message' }, 'x', buildError);
    assert(!!err && String(err.suggestion).includes('executor_id'), 'category=6 缺 executor_id 报错');
}

// ---- Test 3o: category=5 缺 executor_id 报错 ----
console.log('\n=== Test 3o: category=5 缺 executor_id ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 5, query: 'a | lookup x', topic: 'raw_message', check_condition: { timerange: 'm' } }, 'x', buildError);
    assert(!!err && String(err.suggestion).includes('executor_id'), 'category=5 缺 executor_id 报错');
}

// ---- Test 3p: category=0 缺 executor_id 报错 ----
console.log('\n=== Test 3p: category=0 缺 executor_id ===');
{
    const err = AlertsModule.validateCategoryFieldConflictsStatic({ category: 0, query: 'a', check_condition: { timerange: '-5min' } }, 'x', buildError);
    assert(!!err && String(err.suggestion).includes('executor_id'), 'category=0 缺 executor_id 报错');
}

// ---- Test 4: isMissingValueStatic + 必填缺失（T1-3 / T6-2 ④） ----
console.log('\n=== Test 4: 必填缺失（通过 isMissingValueStatic 语义判断） ===');
{
    assert(AlertsModule.isMissingValueStatic(undefined) === true, 'undefined 缺失');
    assert(AlertsModule.isMissingValueStatic(null) === true, 'null 缺失');
    assert(AlertsModule.isMissingValueStatic('') === true, '空串 缺失');
    assert(AlertsModule.isMissingValueStatic([]) === true, '空数组 缺失');
    assert(AlertsModule.isMissingValueStatic(0) === false, '0 不缺失');
    assert(AlertsModule.isMissingValueStatic(false) === false, 'false 不缺失');
    assert(AlertsModule.isMissingValueStatic(' ') === true, '空白串 缺失');
    assert(AlertsModule.isMissingValueStatic('xx') === false, '非空串 不缺失');

    // 模拟 create 必填缺失 name：按 module 的 validateRequiredFields 语义，缺失应该被识别
    // 注意：validateRequiredFields 是私有方法，这里用 isMissingValueStatic 间接验证
    const body = { category: 4, query: 'a | stats count() as cnt', check_interval: 300, enabled: true, check_condition: '{"field":"cnt"}' };
    // 必填包括 name，所以 name 应被识别为 missing
    const requiredCreate = ['name', 'query', 'check_interval', 'category', 'enabled', 'check_condition'];
    const missing = requiredCreate.filter(f => AlertsModule.isMissingValueStatic(body[f]));
    assert(missing.length === 1 && missing[0] === 'name', `仅 name 缺失，实际缺失：${missing.join(',') || '无'}`);
}

// ---- Test 5: category_reference 本地静态返回 7 类（R8） ----
console.log('\n=== Test 5: 本地静态 ALERT_CATEGORY_META 覆盖 7 类 ===');
{
    // 从编译后的模块取常量：
    const meta = require(resolve(distRoot, 'modules/alerts.js'));
    const keys = Object.keys(meta.ALERT_CATEGORY_META || {}).map(k => Number(k)).sort((a, b) => a - b);
    console.log('  categories:', keys);
    const expected = [0, 1, 2, 3, 4, 5, 6, 19];
    assert(JSON.stringify(keys) === JSON.stringify(expected), `keys 应为 [0,1,2,3,4,5,6,19]，实际 ${JSON.stringify(keys)}`);

    // 每类都要有 name / description / requiredFields / specificFields / sampleCheckCondition / sampleBody
    for (const k of keys) {
        const m = meta.ALERT_CATEGORY_META[k];
        const requiredParts = ['name', 'description', 'requiredFields', 'specificFields', 'sampleCheckCondition', 'sampleBody'];
        for (const p of requiredParts) {
            assert(m[p] !== undefined && m[p] !== null, `category ${k} 缺少字段 ${p}`);
        }
    }

    // category=4 sampleBody 里 dataset_ids=[]（SPL 统计）
    const cat4body = meta.ALERT_CATEGORY_META[4].sampleBody;
    assert(Array.isArray(cat4body.dataset_ids) && cat4body.dataset_ids.length === 0,
        `category=4 sampleBody.dataset_ids 应为 []，实际 ${JSON.stringify(cat4body.dataset_ids)}`);
    // 每个 sampleBody 都应含 executor_id（运行用户）
    for (const k of keys) {
        const body = meta.ALERT_CATEGORY_META[k].sampleBody;
        assert('executor_id' in body, `category ${k} sampleBody 应含 executor_id，实际 ${JSON.stringify(body)}`);
    }
    // category=0-4 的 sampleCheckCondition 都应含 timerange
    for (const k of [0, 1, 2, 3, 4]) {
        const cc = meta.ALERT_CATEGORY_META[k].sampleCheckCondition;
        assert('timerange' in cc, `category ${k} sampleCheckCondition 应含 timerange，实际 ${JSON.stringify(cc)}`);
    }
    // category=0 check_condition 没有 field
    const cat0cc = meta.ALERT_CATEGORY_META[0].sampleCheckCondition;
    assert(!('field' in cat0cc) && cat0cc.function === 'count',
        `category=0 sampleCheckCondition 应含 function=count 且不含 field，实际 ${JSON.stringify(cat0cc)}`);
    // category=5 sampleBody 含 topic（流式 lookup）
    const cat5body = meta.ALERT_CATEGORY_META[5].sampleBody;
    assert(cat5body.topic && typeof cat5body.topic === 'string',
        `category=5 sampleBody 含 topic（流式 lookup），实际 ${JSON.stringify(cat5body.topic)}`);
    // category=19 sampleBody 含 composite_info（联合监控）
    const cat19body = meta.ALERT_CATEGORY_META[19].sampleBody;
    assert(cat19body.composite_info && cat19body.composite_info.operator,
        `category=19 sampleBody 含 composite_info.operator，实际 ${JSON.stringify(cat19body.composite_info)}`);
    // category=6 sampleBody 含 topic（流式聚合）
    const cat6body = meta.ALERT_CATEGORY_META[6].sampleBody;
    assert(cat6body.topic && typeof cat6body.topic === 'string',
        `category=6 sampleBody 含 topic（流式聚合），实际 ${JSON.stringify(cat6body.topic)}`);
    // category=6 sampleCheckCondition 只有 threshold（极简）
    const cat6cc = meta.ALERT_CATEGORY_META[6].sampleCheckCondition;
    assert('threshold' in cat6cc && !('function' in cat6cc),
        `category=6 sampleCheckCondition 应仅含 threshold，实际 ${JSON.stringify(cat6cc)}`);
    // category=2 check_condition 含 base_value（连续统计）
    const cat2cc = meta.ALERT_CATEGORY_META[2].sampleCheckCondition;
    assert('base_value' in cat2cc && 'base_comparator' in cat2cc,
        `category=2 sampleCheckCondition 应含 base_value+base_comparator，实际 ${JSON.stringify(cat2cc)}`);
    // category=3 check_condition 含 base_timerange（突变异常）
    const cat3cc = meta.ALERT_CATEGORY_META[3].sampleCheckCondition;
    assert('base_timerange' in cat3cc,
        `category=3 sampleCheckCondition 应含 base_timerange，实际 ${JSON.stringify(cat3cc)}`);
}

// ---- Test: 已触发告警历史（get_triggered_alerts）纯函数 ----
// 与 python/tests/test_alerts_service.py::AlertHistoryTestCase 使用同一份黄金样例，
// 任何一侧改动导致输出漂移，两侧都会红。
console.log('\n=== Test: get_triggered_alerts 查询构造与字段回退链 ===');
{
    const service = new AlertsModule(null);
    const plan = (params) => {
        const built = service.buildHistoryQuery(params);
        if (built.error) throw new Error(`buildHistoryQuery 意外失败: ${JSON.stringify(built.error)}`);
        return built.value;
    };

    const defaultPlan = plan({});
    assert(
        defaultPlan.query.startsWith(
            "index=monitor appname:alert_record 'issue_alert':true NOT 'is_recovery':true | sort by -timestamp | fields "
        ),
        `默认查询前缀不符，实际 ${defaultPlan.query.slice(0, 120)}`
    );
    assert(defaultPlan.query.includes("'result.appname', 'result.ip',"), '默认查询应含 result.appname / result.ip 投影');
    assert(defaultPlan.query.includes("'result.plugin.plugin_result'"), '默认查询应含通知正文投影');
    assert(defaultPlan.time_range === '-24h,now', `默认 time_range 应为 -24h,now，实际 ${defaultPlan.time_range}`);
    assert(defaultPlan.size === 20 && defaultPlan.page === 0, '默认 size/page 应为 20/0');
    assert(defaultPlan.include_recovery === false, '默认 include_recovery 应为 false');
    assert(defaultPlan.include_search_url === false, 'include_search_url 默认应为 false');
    // 已移除的"内部实现旋钮"不应再出现在 plan 里
    assert(defaultPlan.only_triggered === undefined, 'only_triggered 应已移除');
    assert(defaultPlan.include_notification_text === undefined, 'include_notification_text 应已移除');
    assert(defaultPlan.description_max_chars === undefined, 'description_max_chars 应已移除');

    // 不传监控项 = 全系统总体查询，且不需要通配符占位
    const defaultFilters = defaultPlan.query.split(' | sort by ')[0];
    assert(
        defaultFilters === "index=monitor appname:alert_record 'issue_alert':true NOT 'is_recovery':true",
        `默认过滤子句不符，实际 ${defaultFilters}`
    );
    assert(!defaultFilters.includes('alert_id:'), '默认不应带 alert_id 过滤');
    assert(!defaultFilters.includes('alert_name:'), '默认不应带 alert_name 过滤');
    assert(!defaultFilters.includes('alert_level:'), 'levels 不传时不应带级别过滤');
    // 分页：SPL 里绝不能写死 `| limit`，否则 HTTP page 参数翻不动页（实测 page>=1 恒 0 行）
    assert(!defaultPlan.query.includes('| limit '), 'SPL 不应硬编码 | limit，否则分页失效');

    // 时间窗归一化：新版日志易只接受 `-<N><unit>,now`
    const norm = (v) => AlertsModule.normalizeHistoryTimeRange(v);
    assert(norm('now-24h,now') === '-24h,now', `now-24h,now 归一化失败：${norm('now-24h,now')}`);
    assert(norm('now-7d,now') === '-7d,now', `now-7d,now 归一化失败：${norm('now-7d,now')}`);
    assert(norm('now - 30m , now') === '-30m,now', `带空格归一化失败：${norm('now - 30m , now')}`);
    assert(norm('-24h,now') === '-24h,now', '已是通用写法应原样透传');
    assert(norm('earliest,now') === 'earliest,now', 'earliest 应原样透传');
    assert(norm('1790076698110,1790681498110') === '1790076698110,1790681498110', 'epoch 毫秒应原样透传');
    assert(norm(null) === '-24h,now' && norm('   ') === '-24h,now', '空值应回落默认');
    assert(norm('now-24h') === 'now-24h', '非两段写法不应强行改动');
    assert(plan({ time_range: 'now-7d,now' }).time_range === '-7d,now', 'buildHistoryQuery 应走同一归一化');

    const filtered = plan({ alert_id: 1489, alert_name: 'demo-name', levels: ['critical', 'mid'], size: 999, sort: 'alert_id' });
    assert(filtered.query.includes('alert_id:1489'), 'alert_id 过滤缺失');
    assert(filtered.query.includes('alert_name:demo\\-name'), 'alert_name 精确匹配缺失');
    assert(filtered.query.includes('(alert_level:"critical" OR alert_level:"mid")'), 'levels 过滤缺失');
    assert(filtered.query.includes('| sort by alert_id | fields '), '排序未生效');
    assert(!filtered.query.includes('| limit '), 'SPL 不应硬编码 | limit');
    assert(filtered.size === 200, `size 应被夹到 200，实际 ${filtered.size}`);

    // levels 不传 = 全部级别（不拼 alert_level 子句）
    assert(!plan({}).query.includes('alert_level:"'), 'levels 不传时不应带级别过滤');

    const recoveryPlan = plan({ include_recovery: true });
    assert(recoveryPlan.query.includes("'issue_alert':true"), 'issue_alert:true 应为恒定条件');
    assert(!recoveryPlan.query.includes("NOT 'is_recovery':true"), 'include_recovery=true 时不应带 is_recovery 过滤');

    const commaFields = plan({ entity_fields: 'result.hostname,result.src_ip' });
    assert(
        JSON.stringify(commaFields.entity_fields) === JSON.stringify(['result.hostname', 'result.src_ip']),
        `逗号字符串 entity_fields 解析失败：${JSON.stringify(commaFields.entity_fields)}`
    );
    assert(commaFields.query.includes("'result.hostname', 'result.src_ip',"), 'entity_fields 未进入投影');

    // ---- alert_name 字面量转义（不再用 | where like 管道）----
    const term = (v, keep) => AlertsModule.escapeSplTerm(v, keep);
    // 纯字母数字汉字：只有下划线被转义
    assert(term('交换机_华为S12700_高级别事件告警') === '交换机\\_华为S12700\\_高级别事件告警', `汉字名转义失败：${term('交换机_华为S12700_高级别事件告警')}`);
    // env2 上真实存在的告警名
    assert(
        term('K8s_kube-dns / CoreDNS_转发错误') === 'K8s\\_kube\\-dns\\ \\/\\ CoreDNS\\_转发错误',
        `真实名转义失败：${term('K8s_kube-dns / CoreDNS_转发错误')}`
    );
    assert(term('RDP Brute Force Attack') === 'RDP\\ Brute\\ Force\\ Attack', `空格未转义：${term('RDP Brute Force Attack')}`);
    assert(term('[内置监控]') === '\\[内置监控\\]', `方括号未转义：${term('[内置监控]')}`);
    assert(term('a(b)c') === 'a\\(b\\)c', `圆括号未转义：${term('a(b)c')}`);
    assert(term('a|b:c') === 'a\\|b\\:c', `竖线/冒号未转义：${term('a|b:c')}`);
    assert(term('a.b,c') === 'a\\.b\\,c', `点/逗号未转义：${term('a.b,c')}`);
    assert(term('a"b') === 'a\\"b', `双引号未转义：${term('a"b')}`);
    assert(term('a\\b') === 'a\\\\b', `反斜杠未转义：${term('a\\b')}`);
    assert(term('a!b<c>d') === 'a\\!b\\<c\\>d', `感叹号/尖括号未转义：${term('a!b<c>d')}`);
    // 非 ASCII 原样保留（不做无法验证的多字节转义）
    assert(term('攻击链模拟-大流量外传告警') === '攻击链模拟\\-大流量外传告警', '汉字应原样保留');
    // `*` 在精确模式下是字面量、在通配模式下是通配符
    assert(term('交换机*') === '交换机\\*', '精确模式下 * 应被转义');
    assert(term('交换机*', true) === '交换机*', '通配模式下 * 应保留');
    assert(term('*Brute Force*', true) === '*Brute\\ Force*', `含空格通配转义失败：${term('*Brute Force*', true)}`);
    assert(term('[内置监控]*', true) === '\\[内置监控\\]*', `方括号通配转义失败：${term('[内置监控]*', true)}`);

    const nameFilter = (v) => service.buildHistoryNameFilter(v);
    assert(nameFilter('交换机').value.clause === 'alert_name:交换机', '精确匹配应走主查询');
    assert(nameFilter('交换机*').value.clause === 'alert_name:交换机*', '通配应留在主查询');
    assert(nameFilter('交换机*').value.stage === undefined, '不应再产生 where 管道 stage');
    assert(
        nameFilter('K8s_kube-dns / CoreDNS_转发错误').value.clause === 'alert_name:K8s\\_kube\\-dns\\ \\/\\ CoreDNS\\_转发错误',
        '真实告警名未正确转义'
    );
    // 用户直觉上会传 * 占位；必须等价于"不过滤"，而不是匹配字面星号（否则静默返回 0 条）
    assert(nameFilter('*').value.clause === '' && nameFilter('**').value.clause === '', '* 应等价于不过滤');
    assert(nameFilter('').value.clause === '' && nameFilter(null).value.clause === '', '空值应不过滤');
    // `"` 与 `\` 以前被拒，实测 `\"` / `\\` 都能当字面量，改为转义而非报错
    assert(nameFilter('a"b').error === undefined && nameFilter('a"b').value.clause === 'alert_name:a\\"b', '双引号应被转义而非拒绝');
    assert(nameFilter('a\\b').error === undefined && nameFilter('a\\b').value.clause === 'alert_name:a\\\\b', '反斜杠应被转义而非拒绝');
    // 含空格的名字靠 `\ ` 保住空格
    const spacedWild = plan({ alert_name: '*Brute Force*' });
    assert(spacedWild.query.includes('alert_name:*Brute\\ Force*'), '含空格通配未保留空格');
    // 回归：like() 是管道过滤、不走索引，任何 alert_name 写法都不该再产生它
    for (const raw of ['交换机', '交换机*', '*攻击*', '[内置监控]*', 'RDP Brute Force Attack']) {
        assert(!plan({ alert_name: raw }).query.includes('| where like'), `alert_name=${raw} 不应再产生 | where like`);
    }

    const badLevel = service.buildHistoryQuery({ levels: ['bogus'] });
    assert(badLevel.error && badLevel.error.error_code === 'INVALID_PARAM_VALUE', `非法 levels 应被拦截，实际 ${JSON.stringify(badLevel)}`);

    assert(AlertsModule.resolveHistorySort('alert_level') === 'alert_level', 'sort 白名单通过失败');
    assert(AlertsModule.resolveHistorySort('-value') === '-value', 'sort 降序前缀失败');
    assert(AlertsModule.resolveHistorySort('drop table') === '-timestamp', 'sort 非法值未回落');
    assert(AlertsModule.resolveHistorySort(null) === '-timestamp', 'sort 缺省未回落');

    assert(AlertsModule.resolveBoundedInt(null, 20, 1, 200) === 20, 'boundedInt 缺省失败');
    assert(AlertsModule.resolveBoundedInt('0', 20, 1, 200) === 1, 'boundedInt 下限失败');
    assert(AlertsModule.resolveBoundedInt('999', 20, 1, 200) === 200, 'boundedInt 上限失败');
    assert(AlertsModule.resolveBoundedInt('abc', 20, 1, 200) === 20, 'boundedInt 非数字回落失败');
    assert(AlertsModule.resolveBoundedInt(true, 20, 1, 200) === 20, 'boundedInt 布尔回落失败');
}

console.log('\n=== Test: get_triggered_alerts 六要素规整 ===');
{
    const TRIGGERED_ROW = {
        alert_name: '交换机_华为S12700_高级别事件告警',
        alert_id: 75,
        alert_level: 'high',
        event_level: 'high',
        value: 64,
        timestamp: 1790682665059,
        event_time: 1790682665059,
        trigger_timestamp: 1790682665059,
        start_timestamp: 1790682365059,
        end_timestamp: 1790682665059,
        issue_alert: 'true',
        is_recovery: 'false',
        alert_history_id: '75_1790682665059_0',
        appname: 'alert_record',
        search_url: 'http://rizhiyi.com/search/?title=demo',
        'result.name': '交换机_华为S12700_高级别事件告警',
        'result.alert_id': 75,
        'result.level': 'high',
        'result.result.value': 64,
        'result.description': '',
        'result.strategy.description': '事件数监控',
        'result.strategy.trigger.level': 'high',
        'result.strategy.trigger.compare': '>',
        'result.strategy.trigger.compare_value': 20,
        'result.strategy.trigger.compare_desc_text': '计数大于20',
        'result.alert_condition_strategy.alert_level': 'high',
        'result.alert_condition_strategy.trigger_time': 1790682665059,
        'result.search.query': 'logtype:switch tag:huawei_S12700 switch.severity:<4',
        'result.trigger_timestamp': 1790682665059,
        'result.exec_time': 1790682675420,
        'result.plugin.plugin_result':
            '<br>告警名称: 交换机_华为S12700_高级别事件告警<br>告警级别：高<br>告警描述: <br>告警产生时间: 2026年9月29日 19:51:15<br>最近事件: appname:switch, hostname:VM_16_9_centos'
    };
    const SPL_STAT_ROW = {
        alert_name: '服务调用报错-示例zyt',
        alert_id: 1489,
        alert_level: 'critical',
        timestamp: 1790736207687,
        is_recovery: 'false',
        'result.result.value': 35,
        'result.result.complex_value': 'cnt:35',
        'result.result.columns.name': ['service', 'error_message', 'cnt', 'alert_msg'],
        'result.description': '-1m内收到来自的35条日志，触发条件是计数>[10]'
    };
    const SPARSE_ROW = {
        timestamp: 1790682665059,
        is_recovery: 'false',
        appname: 'alert_record',
        'result.alert_id': 74,
        'result.plugin.plugin_result': '<br>告警名称: 交换机_华为S12700_错误告警<br>告警级别：高<br>'
    };
    const RECOVERY_ROW = {
        alert_name: 'eventgen断采',
        alert_id: 1128,
        alert_level: 'no_alert',
        timestamp: 1790736209047,
        is_recovery: 'false',
        'result.description': '-10m内字段的统计值为，触发条件'
    };

    const service = new AlertsModule(null);
    const plan = service.buildHistoryQuery({}).value;

    const item = AlertsModule.normalizeHistoryRow(TRIGGERED_ROW, plan);
    assert(item.alert_name === '交换机_华为S12700_高级别事件告警', `名称不符：${item.alert_name}`);
    assert(item.alert_id === 75, `alert_id 不符：${item.alert_id}`);
    assert(item.alert_history_id === '75_1790682665059_0', `alert_history_id 不符：${item.alert_history_id}`);
    assert(item.trigger_time === '2026-09-29T19:51:05+08:00', `触发时间不符：${item.trigger_time}`);
    assert(item.trigger_time_ms === 1790682665059, `触发毫秒不符：${item.trigger_time_ms}`);
    assert(item.level === 'high', `级别不符：${item.level}`);
    assert(item.value === 64, `触发值不符：${item.value}`);
    assert(item.description === '计数大于20', `描述不符：${item.description}`);
    assert(item.description_source === 'strategy_trigger_desc', `描述来源不符：${item.description_source}`);
    assert(item.is_recovery === false, 'is_recovery 应为 false');
    assert(!('search_url' in item), '默认不应带 search_url');

    const sparseItem = AlertsModule.normalizeHistoryRow(SPARSE_ROW, plan);
    assert(sparseItem.alert_name === '交换机_华为S12700_错误告警', `通知正文抽名称失败：${sparseItem.alert_name}`);
    assert(sparseItem.alert_id === 74, `稀疏行 alert_id 不符：${sparseItem.alert_id}`);
    assert(
        sparseItem.description === '告警名称: 交换机_华为S12700_错误告警 告警级别：高',
        `通知正文描述不符：${sparseItem.description}`
    );
    assert(sparseItem.description_source === 'notification_text', `描述来源应为 notification_text：${sparseItem.description_source}`);
    assert(sparseItem.value === null, '稀疏行 value 应为 null');

    const noNameItem = AlertsModule.normalizeHistoryRow({ timestamp: 1, is_recovery: 'false' }, plan);
    assert(noNameItem.alert_name === null && noNameItem.alert_id === null, '无名称无 ID 时应为 null');
    const idOnlyItem = AlertsModule.normalizeHistoryRow({ timestamp: 1, is_recovery: 'false', 'result.alert_id': 9 }, plan);
    assert(idOnlyItem.alert_name === 'alert_id=9', `无名称时应回落 alert_id=9，实际 ${idOnlyItem.alert_name}`);

    const execTimeItem = AlertsModule.normalizeHistoryRow(
        { alert_name: 'x', is_recovery: 'false', 'result.exec_time': 1790682675420 },
        plan
    );
    assert(execTimeItem.trigger_time_ms === 1790682675420, 'exec_time 兜底失败');

    const recoveryPlan = service.buildHistoryQuery({ include_recovery: true }).value;
    const recoveryItem = AlertsModule.normalizeHistoryRow(RECOVERY_ROW, recoveryPlan);
    assert(recoveryItem.level === 'no_alert' && recoveryItem.is_recovery === true, 'no_alert 应被标记为恢复');

    const searchUrlPlan = service.buildHistoryQuery({ include_search_url: true }).value;
    const searchUrlItem = AlertsModule.normalizeHistoryRow(TRIGGERED_ROW, searchUrlPlan);
    assert(searchUrlItem.search_url === 'http://rizhiyi.com/search/?title=demo', `search_url 不符：${searchUrlItem.search_url}`);

    assert(AlertsModule.formatHistoryTime(1790682665059, 'UTC') === '2026-09-29T11:51:05+00:00', 'UTC 时间格式化不符');
    assert(AlertsModule.formatHistoryTime(null, 'Asia/Shanghai') === null, '空时间应返回 null');
    assert(AlertsModule.resolveHistoryTimezone('bogus/zone') === 'Asia/Shanghai', '非法时区未回落');
    assert(AlertsModule.stripHtmlText('<b>a</b>&nbsp;&lt;c&gt;  d') === 'a <c> d', 'HTML 剥离不符');
    assert(AlertsModule.stripHtmlText(null) === '', '空值 HTML 剥离应为空串');
    assert(AlertsModule.truncateText('abcdef', 3) === 'abc', '截断失败');
    assert(AlertsModule.truncateText('abc', 10) === 'abc', '未超长不应截断');
}

console.log('\n=== Test: get_triggered_alerts 实体识别与聚合 ===');
{
    const SEGMENTED_ROW = {
        // 研发确认：result.is_segmentation=true 时，result.segmentation_field 记实体字段名，
        // result.segmentation_specify_value 记实体字段值。
        'result.is_segmentation': true,
        'result.segmentation_field': 'json.URL',
        'result.segmentation_specify_value': '/api/v1/orders',
        'result.appname': 'order-service',
        'result.ip': '10.0.1.13'
    };
    // 只有 is_segmentation 标记、没有值的记录（= 当前环境未真正触发的形态），不应产出实体。
    const SEGMENTED_NO_VALUE_ROW = {
        'result.is_segmentation': true,
        'result.segmentation_field': 'appname',
        'result.appname': 'alert_record'
    };
    // 更早环境的历史写法：扁平 segmentation_field / segmentation_value。
    const LEGACY_SEGMENTED_ROW = {
        segmentation_field: 'src_ip',
        segmentation_value: '10.0.1.99'
    };
    const TRIGGERED_ROW = { alert_name: 'x', appname: 'alert_record' };
    const SPL_STAT_ROW = {
        alert_name: '服务调用报错-示例zyt',
        alert_id: 1489,
        alert_level: 'critical',
        timestamp: 1790736207687,
        is_recovery: 'false',
        'result.result.value': 35,
        'result.result.complex_value': 'cnt:35',
        'result.result.columns.name': ['service', 'error_message', 'cnt', 'alert_msg'],
        'result.description': '-1m内收到来自的35条日志，触发条件是计数>[10]'
    };
    const HIGH_ROW = {
        alert_name: '交换机_华为S12700_高级别事件告警',
        alert_id: 75,
        alert_level: 'high',
        timestamp: 1790682665059,
        is_recovery: 'false',
        'result.result.value': 64,
        'result.description': '计数大于20'
    };

    const preferred = AlertsModule.resolveHistoryEntities(SEGMENTED_ROW, ['result.appname', 'result.ip']);
    assert(preferred.source === 'segmentation_value', `应优先 segmentation_value，实际 ${preferred.source}`);
    assert(preferred.entities['json.URL'] === '/api/v1/orders', 'segmentation_value 实体值不符');
    assert(preferred.entities['result.appname'] === 'order-service', 'result.appname 未合并');
    assert(preferred.entities['result.ip'] === '10.0.1.13', 'result.ip 未合并');

    // 只有 result.* 三个字段、没有扁平字段时，分段实体依然能取到。
    const resultPrefixedOnly = AlertsModule.resolveHistoryEntities(
        {
            'result.is_segmentation': true,
            'result.segmentation_field': 'json.DST_IP',
            'result.segmentation_specify_value': '10.0.1.99'
        },
        ['result.ip']
    );
    assert(resultPrefixedOnly.source === 'segmentation_value', `result.* 分段字段应生效，实际 ${resultPrefixedOnly.source}`);
    assert(
        JSON.stringify(resultPrefixedOnly.entities) === JSON.stringify({ 'json.DST_IP': '10.0.1.99' }),
        `result.* 分段实体不符：${JSON.stringify(resultPrefixedOnly.entities)}`
    );

    // 有标记没值 → 不产出分段实体；appname=alert_record 无意义 → 落空。
    const flagOnly = AlertsModule.resolveHistoryEntities(SEGMENTED_NO_VALUE_ROW, ['result.appname', 'result.ip']);
    assert(flagOnly.source === 'none' && Object.keys(flagOnly.entities).length === 0, '只有标记没有值时不应产出实体');

    // 历史扁平字段仍兼容。
    const legacy = AlertsModule.resolveHistoryEntities(LEGACY_SEGMENTED_ROW, ['result.ip']);
    assert(legacy.source === 'segmentation_value', `历史扁平字段应兼容，实际 ${legacy.source}`);
    assert(
        JSON.stringify(legacy.entities) === JSON.stringify({ src_ip: '10.0.1.99' }),
        `历史扁平实体不符：${JSON.stringify(legacy.entities)}`
    );

    const noSeg = { ...SEGMENTED_ROW };
    delete noSeg['result.segmentation_specify_value'];
    const fromFields = AlertsModule.resolveHistoryEntities(noSeg, ['result.ip', 'result.hostname']);
    assert(fromFields.source === 'entity_fields', `应回落 entity_fields，实际 ${fromFields.source}`);
    assert(JSON.stringify(fromFields.entities) === JSON.stringify({ 'result.ip': '10.0.1.13' }), `实体结果不符：${JSON.stringify(fromFields.entities)}`);

    const bare = AlertsModule.resolveHistoryEntities(noSeg, ['ip']);
    assert(bare.entities['result.ip'] === '10.0.1.13', '裸字段名应回落到 result.<name>');

    const meaningless = AlertsModule.resolveHistoryEntities(TRIGGERED_ROW, ['appname', 'ip']);
    assert(meaningless.source === 'none' && Object.keys(meaningless.entities).length === 0, 'alert_record 应被判为无意义实体');

    const complexRow = { ...SPL_STAT_ROW, 'result.result.complex_value': 'service:order-api, cnt:35' };
    const complex = AlertsModule.resolveHistoryEntities(complexRow, ['result.ip']);
    assert(complex.source === 'complex_value', `应回落 complex_value，实际 ${complex.source}`);
    assert(JSON.stringify(complex.entities) === JSON.stringify({ service: 'order-api' }), `complex_value 解析不符：${JSON.stringify(complex.entities)}`);

    const none = AlertsModule.resolveHistoryEntities(TRIGGERED_ROW, ['result.ip']);
    assert(none.source === 'none', '无实体时应为 none');

    const service = new AlertsModule(null);
    const smallPlan = service.buildHistoryQuery({ size: 2 }).value;
    const payload = AlertsModule.normalizeHistory([HIGH_ROW, SPL_STAT_ROW, SPL_STAT_ROW], smallPlan, 10);
    assert(payload.total === 10 && payload.returned === 3, `total/returned 不符：${payload.total}/${payload.returned}`);
    assert(payload.has_more === true, 'has_more 应为 true');
    assert(JSON.stringify(payload.level_counts) === JSON.stringify({ high: 1, critical: 2 }), `level_counts 不符：${JSON.stringify(payload.level_counts)}`);
    assert(
        JSON.stringify(payload.alert_counts[0]) === JSON.stringify({ alert_id: 1489, alert_name: '服务调用报错-示例zyt', count: 2 }),
        `alert_counts 排序不符：${JSON.stringify(payload.alert_counts)}`
    );
    assert(payload.entity_candidates.includes('service'), 'entity_candidates 应含 service');
    assert(!payload.entity_candidates.includes('cnt'), 'entity_candidates 不应含聚合列 cnt');
    // 不再回显入参 entity_fields，只保留真正新增的 entity_candidates（避免两者混淆）
    assert(payload.entity_fields === undefined, '不应再回显 entity_fields');
    assert(payload.warnings.some((w) => w.includes('未携带实体信息')), '应提示未携带实体');

    // 实体落空时，分段字段名应作为候选字段给出，引导调用方换字段下钻。
    const candidatePayload = AlertsModule.normalizeHistory([SEGMENTED_NO_VALUE_ROW], smallPlan, 1);
    assert(candidatePayload.entity_candidates.includes('appname'), 'entity_candidates 应含分段字段名 appname');

    const lastPage = AlertsModule.normalizeHistory([HIGH_ROW], service.buildHistoryQuery({ size: 50 }).value, 1);
    assert(lastPage.has_more === false, '末页 has_more 应为 false');

    const empty = AlertsModule.normalizeHistory([], service.buildHistoryQuery({}).value, 0);
    assert(empty.alerts.length === 0 && empty.warnings.some((w) => w.includes('没有命中的已触发告警')), '空窗口提示缺失');

    const rows = AlertsModule.extractHistoryRows({ results: { total_hits: 7, sheets: { rows: [{ a: 1 }, 'skip'] } } });
    assert(JSON.stringify(rows) === JSON.stringify([{ a: 1 }]), `行提取不符：${JSON.stringify(rows)}`);
    assert(AlertsModule.extractHistoryTotal({ results: { total_hits: 7 } }) === 7, 'total 提取失败');
    assert(AlertsModule.extractHistoryRows(null).length === 0, '空数据行提取应为空数组');
    assert(AlertsModule.extractHistoryTotal({ results: {} }) === null, '缺 total_hits 应返回 null');
}

// ---- 汇总 ----
console.log('\n=== 汇总 ===');
if (failures === 0) {
    console.log('alert-selfcheck: ALL PASSED ✓');
    process.exit(0);
} else {
    console.log(`alert-selfcheck: FAILURES=${failures}`);
    for (const e of errors) console.log('\n -', typeof e === 'string' ? e : e.split('\n').slice(0, 3).join('\n   '));
    process.exit(1);
}
