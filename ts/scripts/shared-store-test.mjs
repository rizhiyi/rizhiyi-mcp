#!/usr/bin/env node
/**
 * 共享结果存储（M1 / M2）自检脚本（TypeScript 侧）。
 *
 * 覆盖两层：
 *   1. 功能层：过期时间编码进文件名、旧格式兼容、写路径清理降频、
 *      损坏文件隔离后 save / list / read 仍可用（CODE_REVIEW.md M1 / M2）。
 *   2. 契约层：生成 / 解析结果文件名的约定，写入 `config/shared-store-parity.golden.json`，
 *      由 `python/tests/test_shared_result_store.py` 读取同一份黄金文件做逐字节比对，
 *      保证 TS 与 Python 对同一 storeDir 混用时不互相「看不见」。
 *
 * 用法：
 *   npm run test:shared-store              # 校验
 *   npm run test:shared-store -- --write   # 重新生成黄金文件
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ANALYSIS_CONSTANTS } from '../dist/modules/analysis-constants.js';
import {
    SharedResultStoreError,
    buildSharedResultFileName,
    cleanupExpiredResults,
    deleteSharedResult,
    listSharedResults,
    parseSharedResultFileName,
    readSharedResult,
    resetSharedResultCleanupThrottle,
    saveSharedResult
} from '../dist/shared-result-store.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const goldenPath = path.join(repoRoot, 'config', 'shared-store-parity.golden.json');
const shouldWrite = process.argv.includes('--write');

const CORRUPT_DIR_NAME = ANALYSIS_CONSTANTS.sharedResultStore.corruptDirName;

function makeConfig(storeDir) {
    return {
        storeDir,
        defaultTtlSeconds: 60,
        inlineMaxBytes: 1024,
        maxFileBytes: 5 * 1024 * 1024
    };
}

function save(config, { ttlSeconds = 60, payload = { value: 1 } } = {}) {
    return saveSharedResult(
        {
            toolName: 'trend_summary',
            resultKind: 'timeseries',
            payload,
            summary: { title: 't', text: 't' },
            ttlSeconds
        },
        config
    );
}

function writeEnvelope(filePath, { handle, expiresAt, routeName = 'log-tools' }) {
    const now = Date.now();
    const payload = { value: 1 };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
        handle,
        resource_uri: `logease://shared-result/${handle}`,
        resource_title: 't',
        resource_type: 'timeseries',
        resource_mime_type: 'application/json',
        created_at: new Date(now - 5 * 60 * 1000).toISOString(),
        expires_at: expiresAt,
        tool_name: 'trend_summary',
        result_kind: 'timeseries',
        payload_bytes: JSON.stringify(payload).length,
        summary: { title: 't', text: 't', key_metrics: {}, preview_fields: [], warnings: [] },
        payload,
        route_name: routeName
    }), 'utf8');
}

function listJsonFiles(storeDir) {
    return fs.readdirSync(storeDir).filter((name) => name.endsWith('.json'));
}

// ---------------------------------------------------------------------------
// 契约层：文件名约定
// ---------------------------------------------------------------------------

function buildGoldenSnapshot() {
    const samples = [
        [1759000000000, '0123456789abcdef0123456789abcdef'],
        [1700000000000, 'a1b2c3d4'],
        [9999999999999, 'ABCDEFGH_ij-klmnop']
    ];
    return {
        version: 1,
        cleanupIntervalSeconds: ANALYSIS_CONSTANTS.sharedResultStore.cleanupIntervalSeconds,
        corruptDirName: ANALYSIS_CONSTANTS.sharedResultStore.corruptDirName,
        fileNameSamples: samples.map(([expiresAtEpochMilliseconds, handle]) => ({
            expiresAtEpochMilliseconds,
            handle,
            fileName: buildSharedResultFileName(expiresAtEpochMilliseconds, handle)
        })),
        legacyFileNames: [
            '0123456789abcdef0123456789abcdef.json',
            'a1b2c3d4.json',
            '0123456789abcdef0123456789abcdef.expired.json'
        ]
    };
}

function verifyFileNameContract() {
    const snapshot = buildGoldenSnapshot();
    for (const sample of snapshot.fileNameSamples) {
        assert.deepStrictEqual(
            parseSharedResultFileName(sample.fileName),
            { expiresAtEpochMilliseconds: sample.expiresAtEpochMilliseconds, handle: sample.handle },
            `无法解析新格式文件名：${sample.fileName}`
        );
    }
    for (const legacyName of snapshot.legacyFileNames) {
        assert.equal(parseSharedResultFileName(legacyName), null, `旧格式文件名不应被识别为新格式：${legacyName}`);
    }
    return snapshot;
}

// ---------------------------------------------------------------------------
// 功能层
// ---------------------------------------------------------------------------

async function runFunctionalTests() {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-store-test-'));
    const config = makeConfig(storeDir);
    try {
        // --- M2：保存使用「过期时间前缀」文件名 ---
        resetSharedResultCleanupThrottle();
        const saved = await save(config);
        const files = listJsonFiles(storeDir);
        assert.equal(files.length, 1, `保存后应只有 1 个结果文件，实际 ${files.length}`);
        const parsed = parseSharedResultFileName(files[0]);
        assert.ok(parsed, `新写入的文件名应为新格式，实际：${files[0]}`);
        assert.equal(parsed.handle, saved.handle);
        assert.equal(
            parsed.expiresAtEpochMilliseconds,
            Math.floor(Date.parse(saved.expires_at)),
            '文件名中的过期时间应为 expires_at 的毫秒时间戳'
        );

        // --- 读 / 列表往返 ---
        const roundTrip = await readSharedResult(saved.resource_uri, config);
        assert.equal(roundTrip.handle, saved.handle);
        assert.deepStrictEqual((await listSharedResults(config)).map((item) => item.handle), [saved.handle]);
        assert.equal(await deleteSharedResult(saved.resource_uri, config), true);
        assert.equal(await deleteSharedResult(saved.resource_uri, config), false);

        // --- M2：过期的旧格式文件走慢路径被清理，未过期的不被误删 ---
        const legacyActiveHandle = 'c'.repeat(32);
        const legacyActivePath = path.join(storeDir, `${legacyActiveHandle}.json`);
        writeEnvelope(legacyActivePath, {
            handle: legacyActiveHandle,
            expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
        });
        const legacyExpiredHandle = 'd'.repeat(32);
        const legacyExpiredPath = path.join(storeDir, `${legacyExpiredHandle}.json`);
        writeEnvelope(legacyExpiredPath, {
            handle: legacyExpiredHandle,
            expiresAt: new Date(Date.now() - 3600 * 1000).toISOString()
        });

        await cleanupExpiredResults(config);
        assert.ok(fs.existsSync(legacyActivePath), '未过期的旧格式文件不应被清理');
        assert.ok(!fs.existsSync(legacyExpiredPath), '过期的旧格式文件应被清理');
        assert.ok(fs.existsSync(path.join(storeDir, `${legacyExpiredHandle}.expired.json`)), '应写入过期标记');
        const legacyRead = await readSharedResult(`logease://shared-result/${legacyActiveHandle}`, config);
        assert.equal(legacyRead.handle, legacyActiveHandle);

        // --- M2：新格式过期文件按文件名清理（内容故意写坏也应清理）---
        const expiredHandle = 'a'.repeat(32);
        const expiredName = buildSharedResultFileName(Date.now() - 100 * 1000, expiredHandle);
        fs.writeFileSync(path.join(storeDir, expiredName), '{ not json', 'utf8');
        await cleanupExpiredResults(config);
        assert.ok(!fs.existsSync(path.join(storeDir, expiredName)), '过期的结果文件应按文件名被清理');

        // --- M1：损坏文件隔离后，save / list / read 仍可用 ---
        resetSharedResultCleanupThrottle();
        const good = await save(config);
        const badHandle = 'f'.repeat(32);
        const badName = buildSharedResultFileName(Date.now() + 3600 * 1000, badHandle);
        const badPath = path.join(storeDir, badName);
        fs.writeFileSync(badPath, '{ this is not json', 'utf8');

        const another = await save(config); // 保存不应被坏文件拖垮

        const listed = await listSharedResults(config); // 列表不应报错
        const handles = new Set(listed.map((item) => item.handle));
        assert.ok(handles.has(good.handle) && handles.has(another.handle), '列表应返回正常结果');
        assert.ok(!handles.has(badHandle), '列表不应包含损坏文件');

        await assert.rejects(
            readSharedResult(`logease://shared-result/${badHandle}`, config),
            (error) => error instanceof SharedResultStoreError && error.code === 'HANDLE_NOT_FOUND',
            '读取损坏文件应按不存在处理（HANDLE_NOT_FOUND）'
        );

        assert.ok(!fs.existsSync(badPath), '损坏文件应被移出 storeDir 根目录');
        const corruptDir = path.join(storeDir, CORRUPT_DIR_NAME);
        assert.ok(fs.statSync(corruptDir).isDirectory(), '应创建 corrupt/ 隔离目录');
        assert.ok(fs.readdirSync(corruptDir).length >= 1, '损坏文件应被隔离到 corrupt/');

        // --- M1：隔离目录不会被当成结果文件重复扫描 ---
        await cleanupExpiredResults(config);
        await cleanupExpiredResults(config);
        assert.equal(fs.readdirSync(corruptDir).length, 1, '隔离目录不应被重复扫描');

        // --- M2：写路径清理降频 ---
        resetSharedResultCleanupThrottle();
        await save(config); // 触发一次写路径清理
        const throttledHandle = 'e'.repeat(32);
        const throttledName = buildSharedResultFileName(Date.now() - 100 * 1000, throttledHandle);
        const throttledPath = path.join(storeDir, throttledName);
        fs.writeFileSync(throttledPath, '{ not json', 'utf8');
        await save(config); // 降频窗口内，不应清理
        assert.ok(fs.existsSync(throttledPath), '降频窗口内保存不应触发全目录清理');
        resetSharedResultCleanupThrottle();
        await save(config); // 重置后应清理
        assert.ok(!fs.existsSync(throttledPath), '降频窗口过后保存应触发清理');
    } finally {
        fs.rmSync(storeDir, { recursive: true, force: true });
    }
}

async function main() {
    const snapshot = verifyFileNameContract();

    if (shouldWrite) {
        fs.writeFileSync(goldenPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
        console.log(`已写入黄金文件：${path.relative(repoRoot, goldenPath)}`);
        return;
    }

    if (!fs.existsSync(goldenPath)) {
        console.error(`缺少黄金文件 ${path.relative(repoRoot, goldenPath)}，请先运行：npm run test:shared-store -- --write`);
        process.exit(1);
    }
    const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    try {
        assert.deepStrictEqual(snapshot, golden);
    } catch (error) {
        console.error('TS 侧共享结果文件名约定与黄金文件不一致：');
        console.error(error.message);
        console.error('\n若确认约定已按预期变更，请运行：npm run test:shared-store -- --write');
        process.exit(1);
    }

    await runFunctionalTests();
    console.log('共享结果存储自检通过（TS 侧：文件名契约 + M1/M2 功能用例）。');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
