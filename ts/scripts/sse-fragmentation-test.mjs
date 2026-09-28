#!/usr/bin/env node
/**
 * SSE 分片解析回归测试（TypeScript 侧）。
 *
 * 背景：旧实现把"当前事件名 / 当前 data 行"声明在 `res.on('data')` 回调内部，
 * 并在**每个网络分片处理完后无条件 flush 一次事件**。SSE 规范中事件应由**空行**
 * 界定，分片边界与事件边界毫无关系，于是出现：
 *   分片 1 末尾以不完整的 data 提前产出一个事件并清空状态，
 *   分片 2 剩余的 data 行因状态已被清空而被静默丢弃。
 * 表现为 chatspl `deep_think` 进度事件丢失、`send_spl` 输出缺失，最终莫名
 * `NO_SPL_GENERATED`。这类缺陷依赖 TCP 分片时机，难以复现，必须用测试锁住。
 *
 * 本脚本直接向 `SseParser` 喂**人为切分的分片**（不依赖真实网络），
 * 覆盖：多 data 行被切开、单行被切开、正常空行分隔、EOF 无尾随空行、
 * CRLF 换行、注释行忽略，以及"分片边界不得产出事件"的回归断言。
 *
 * 用法：npm run test:sse-fragmentation
 */
import assert from 'node:assert/strict';

import { SseParser } from '../dist/sse-client.js';

let checked = 0;

/** 把分片依次喂入解析器，最后一次 push 后追加 flush，返回全部事件。 */
function parseChunks(chunks) {
    const parser = new SseParser();
    const events = [];
    for (const chunk of chunks) {
        events.push(...parser.push(chunk));
    }
    events.push(...parser.flush());
    return events;
}

function assertEvents(actual, expected, label) {
    assert.deepEqual(actual, expected, label);
    checked += 1;
}

// ---------------------------------------------------------------------------
// a) 同一事件的多个 data 行被 TCP 分片切开 —— 必须只产出一个事件，data 完整
// ---------------------------------------------------------------------------
{
    const block =
        'event: STEP_OUTPUT\n' +
        'data: {"id": "s1",\n' +
        'data: "content": "hello"}\n' +
        '\n';
    // 在两个 data 行之间切开，且切点落在行中间
    const chunk1 = 'event: STEP_OUTPUT\ndata: {"id": "s1",';
    const chunk2 = '\ndata: "content": "hello"}\n\n';

    const events = parseChunks([chunk1, chunk2]);
    assertEvents(
        events,
        [{ event: 'STEP_OUTPUT', data: '{"id": "s1",\n"content": "hello"}' }],
        'a) 多 data 行跨分片必须合成一个完整事件'
    );
}

// ---------------------------------------------------------------------------
// 回归：分片边界本身绝不能产出事件（旧实现的致命缺陷）
// ---------------------------------------------------------------------------
{
    const parser = new SseParser();
    const premature = parser.push('event: X\ndata: partial\n');
    assertEvents(premature, [], '分片以换行结尾但事件未闭合时不得产出事件');

    const closed = parser.push('data: rest\n\n');
    assertEvents(
        closed,
        [{ event: 'X', data: 'partial\nrest' }],
        '空行到达后才产出事件，且 data 拼接完整'
    );
}

// ---------------------------------------------------------------------------
// b) 一行被从中间切开（data: {"a": | 1}）—— 必须正确拼接
// ---------------------------------------------------------------------------
{
    const events = parseChunks(['event: META\ndata: {"a":', '1}\n\n']);
    assertEvents(
        events,
        [{ event: 'META', data: '{"a":1}' }],
        'b) 单行被切在中间必须正确拼接'
    );
}

// ---------------------------------------------------------------------------
// c) 正常按空行分隔的多个事件 —— 全部产出
// ---------------------------------------------------------------------------
{
    const stream =
        'event: META\ndata: {"conversation": {"id": 1}}\n\n' +
        'event: CREATE_STEP\ndata: {"id": "s1"}\n\n' +
        'event: DONE\ndata: {"conversation_id": 7}\n\n';
    // 在任意位置切成三段
    const events = parseChunks([
        stream.slice(0, 20),
        stream.slice(20, 55),
        stream.slice(55)
    ]);
    assertEvents(
        events,
        [
            { event: 'META', data: '{"conversation": {"id": 1}}' },
            { event: 'CREATE_STEP', data: '{"id": "s1"}' },
            { event: 'DONE', data: '{"conversation_id": 7}' }
        ],
        'c) 空行分隔的多个事件必须全部产出'
    );
}

// ---------------------------------------------------------------------------
// d) 流结束时没有尾随空行 —— 最后一个事件仍然产出
// ---------------------------------------------------------------------------
{
    // d1) 完全没有尾随换行
    const noTrailingNewline = parseChunks([
        'event: DONE\ndata: {"conversation_id": 42}'
    ]);
    assertEvents(
        noTrailingNewline,
        [{ event: 'DONE', data: '{"conversation_id": 42}' }],
        'd1) EOF 无尾随换行时最后一行与事件都要产出'
    );

    // d2) 有换行但无空行
    const noBlankLine = parseChunks(['event: DONE\ndata: {"conversation_id": 42}\n']);
    assertEvents(
        noBlankLine,
        [{ event: 'DONE', data: '{"conversation_id": 42}' }],
        'd2) EOF 有换行无空行时事件仍要产出'
    );

    // d3) 事件跨分片，且流在未闭合时结束
    const splitAtEof = parseChunks(['event: STEP_OUTPUT\n', 'data: {"id":"s1"}']);
    assertEvents(
        splitAtEof,
        [{ event: 'STEP_OUTPUT', data: '{"id":"s1"}' }],
        'd3) 状态跨分片保留，EOF flush 补出最后一个事件'
    );
}

// ---------------------------------------------------------------------------
// CRLF（\r\n）换行，包括切在 \r 与 \n 之间
// ---------------------------------------------------------------------------
{
    const events = parseChunks([
        'event: META\r',
        '\ndata: {"a":1}\r',
        '\n\r\n'
    ]);
    assertEvents(
        events,
        [{ event: 'META', data: '{"a":1}' }],
        'CRLF 换行（含切在 \\r 与 \\n 之间）必须正确解析'
    );
}

// ---------------------------------------------------------------------------
// 注释行忽略、无事件名的 data 行按原行为丢弃
// ---------------------------------------------------------------------------
{
    const events = parseChunks([': keep-alive\n\n', 'data: orphan\n\n']);
    assertEvents(events, [], '注释行忽略；缺少 event 名的 data 行不产出事件');
}

console.log(`SSE 分片解析回归测试通过（共 ${checked} 项断言）。`);
