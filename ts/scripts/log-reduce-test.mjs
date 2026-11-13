#!/usr/bin/env node
/**
 * 日志聚类轮询（log_reduce_preview）自检脚本（TypeScript 侧）。
 *
 * 覆盖两个真实踩过的坑：
 *   1. 任务未完成时必须是「可继续轮询的进度结果」，不能是 error——
 *      否则外层工具超时会抢先杀掉轮询并丢失 sid；
 *   2. 上游 5.8 的预览响应把结果放在 tree_layer，total_hits / sid 也要能取到。
 *
 * 用法：npm run test:log-reduce
 */
import assert from 'node:assert/strict';
import { LogSearchModule } from '../dist/modules/log-search.js';

function fakeClient(responses) {
    let index = 0;
    return {
        calls: [],
        async get(path, params, options) {
            this.calls.push({ path, params, options });
            const response = responses[Math.min(index, responses.length - 1)];
            index += 1;
            return typeof response === 'function' ? response(index) : response;
        }
    };
}

function runningResponse() {
    return {
        status: 200,
        data: {
            rc: 0,
            job_status: 'RUNNING',
            result: true,
            tree_layer: { clusters: [], level: 0, max_level: 0, total_hits: 0 }
        }
    };
}

function completedResponse() {
    return {
        status: 200,
        data: {
            rc: 0,
            job_status: 'COMPLETED',
            result: true,
            tree_layer: {
                clusters: [{
                    id: 'cluster-1',
                    pattern_string: 'error timeout',
                    count: 9,
                    _cus_raw: { segment_tree: [] },
                    timeline: { rows: [{ count: 9 }] }
                }],
                level: 0,
                max_level: 0,
                total_hits: 9
            }
        }
    };
}

async function testRunningStaysSuccess() {
    const client = fakeClient([runningResponse()]);
    const module = new LogSearchModule(client, '');
    const startedAt = Date.now();
    const result = await module.executeLogReducePreview('sid-running', 50, 500, 1200);
    const elapsed = Date.now() - startedAt;

    assert.equal(result.error, undefined, '轮询超时不应作为 error 返回');
    assert.equal(result.data.job_status, 'RUNNING');
    assert.equal(result.data.in_progress, true);
    assert.equal(result.data.sid, 'sid-running', '必须回填 sid，调用方才能继续轮询');
    assert.deepEqual(result.data.result, []);
    assert.ok(elapsed >= 1000, `应至少轮询到 deadline，实际 ${elapsed}ms`);
    assert.ok(elapsed < 10000, `不应无限轮询，实际 ${elapsed}ms`);
    assert.ok(client.calls.length > 1, '未完成时应多次轮询');
    console.log('✓ 未完成时返回非 error 的进度结果并保留 sid');
}

async function testCompletedTreeLayer() {
    const client = fakeClient([completedResponse()]);
    const module = new LogSearchModule(client, '');
    const result = await module.executeLogReducePreview('sid-done', 1, 0, 20000);

    assert.equal(result.error, undefined);
    assert.equal(result.data.job_status, 'COMPLETED');
    assert.equal(result.data.sid, 'sid-done', '上游未回传 sid 时应回填请求 sid');
    assert.equal(result.data.total_hits, 9, 'total_hits 应取自 tree_layer.total_hits');
    assert.equal(result.data.result.length, 1);
    assert.equal(result.data.result[0]._cus_raw, undefined, '_cus_raw 应被剥离');
    assert.equal(client.calls.length, 1, '完成后不应继续轮询');
    console.log('✓ 完成时正确解析 tree_layer 并回填 sid / total_hits');
}

await testRunningStaysSuccess();
await testCompletedTreeLayer();
console.log('log-reduce tests passed');
