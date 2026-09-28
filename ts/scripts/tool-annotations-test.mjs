import assert from 'node:assert/strict';

import { deriveToolAnnotations } from '../dist/tool-annotations.js';
import { allTools } from '../dist/tools.js';

const READ_ONLY = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
};
const MUTATING = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true
};
const DEFAULT = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
};

// 1. 全部已定义工具都必须能拿到完整注解，且注解字段为布尔值。
const names = allTools.map((tool) => tool.name);
assert.ok(names.length > 0, 'allTools 不应为空');
assert.equal(new Set(names).size, names.length, `工具名存在重复: ${JSON.stringify(names)}`);
for (const name of names) {
    const annotations = deriveToolAnnotations(name);
    for (const key of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
        assert.equal(typeof annotations[key], 'boolean', `${name} 的 ${key} 不是布尔值`);
    }
}

// 2. 显式覆盖表：前缀推断会判错、实际语义已确认的工具。
assert.deepEqual(deriveToolAnnotations('chat_spl'), READ_ONLY, 'chat_spl 应只读');
assert.deepEqual(deriveToolAnnotations('preview_alert'), READ_ONLY, 'preview_alert 应只读');
assert.deepEqual(deriveToolAnnotations('generate_parserrule_draft'), READ_ONLY, 'generate_parserrule_draft 应只读');
assert.deepEqual(deriveToolAnnotations('testrun_alert'), DEFAULT, 'testrun_alert 应非只读、非破坏性');
assert.deepEqual(deriveToolAnnotations('replace_pipeline_groups'), MUTATING, 'replace_pipeline_groups 应破坏性写入');
assert.deepEqual(deriveToolAnnotations('gencode_callapi'), MUTATING, 'gencode_callapi 应破坏性写入');

// 3. 前缀兜底行为锁定。
for (const name of ['get_anything', 'list_anything', 'verify_anything', 'query_anything', 'anomaly_anything', 'log_search_anything', 'log_reduce_anything']) {
    assert.deepEqual(deriveToolAnnotations(name), READ_ONLY, `${name} 应命中只读前缀`);
}
for (const name of ['create_anything', 'update_anything', 'delete_anything', 'remove_anything', 'add_anything', 'clone_anything']) {
    assert.deepEqual(deriveToolAnnotations(name), MUTATING, `${name} 应命中写入前缀`);
}
assert.deepEqual(deriveToolAnnotations('select_module'), READ_ONLY, 'select_module 应只读');
assert.deepEqual(deriveToolAnnotations('select_api_from_module'), READ_ONLY, 'select_api_from_module 应只读');

// 4. 风险前缀已从只读集合移除：未知的 generate_/data_/replace_ 一律走默认分支（非只读），
//    避免未来出现真正写盘的 generate_*/data_* 工具时被误标为只读。
assert.deepEqual(deriveToolAnnotations('generate_future_writer'), DEFAULT, '未知 generate_* 不应被标为只读');
assert.deepEqual(deriveToolAnnotations('data_future_writer'), DEFAULT, '未知 data_* 不应被标为只读');
assert.deepEqual(deriveToolAnnotations('replace_future_writer'), DEFAULT, '未知 replace_* 不应被标为只读');
assert.deepEqual(deriveToolAnnotations('totally_unknown_tool'), DEFAULT, '未知工具应走默认分支');

// 5. 当前实际存在、且此前会被误标的关键工具，逐一锁定。
assert.deepEqual(deriveToolAnnotations('replace_pipeline_groups'), MUTATING);
assert.deepEqual(deriveToolAnnotations('add_agents_to_group'), MUTATING, 'add_agents_to_group 应破坏性写入');

console.log(`Tool annotations test passed（共 ${names.length} 个工具）`);
