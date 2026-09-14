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
