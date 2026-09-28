#!/usr/bin/env node
/**
 * 验证 OpenAPI server 的 spec 解析是「进程级一次性缓存」（见 CODE_REVIEW.md M3）。
 *
 * 断言：
 *   1. 仅导入模块不会解析 spec；
 *   2. 并发创建多个 server 时 spec 只解析一次（memoized Promise，无 cache stampede）；
 *   3. 之后再次创建 server 仍复用同一份解析结果，不重新解析约 4 万行 YAML；
 *   4. 创建路径可用时，各 session 的 McpServer 实例彼此独立，且暴露同一套工具。
 *
 * 关于「已知既有缺陷」：当前仓库里 createOpenapiServer 在注册工具阶段会抛错，原因是
 * ts/src/mcp-tool-helpers.ts 的 jsonSchemaObjectToZodShape 假定 JSON Schema 的 `required`
 * 一定是数组，而 openapi2mcptools 对部分请求体属性产出了布尔 `required`（如 Create_apps.basic）。
 * 该缺陷与本缓存改造无关——用 git 原始代码同样能复现。因此本脚本容忍「创建失败」，但只容忍
 * 这一个已知错误：出现任何其它错误都会让脚本失败，避免把新的回归悄悄放过。
 */
import assert from 'node:assert/strict';
import process from 'node:process';

import { createOpenapiServer, getOpenapiSpecLoadCount } from '../dist/openapi_server.js';
import { createServerContextForStdio } from '../dist/config.js';

const KNOWN_PREEXISTING_ERROR = /boolean true is not iterable/;

function buildContext(username) {
    return createServerContextForStdio({
        ...process.env,
        LOGEASE_BASE_URL: 'https://127.0.0.1:8090',
        LOGEASE_AUTH_HEADER: `apikey ${username}:secret`
    }, 'openapi');
}

async function tryCreate(username) {
    try {
        return { server: await createOpenapiServer(buildContext(username)) };
    } catch (error) {
        return { error };
    }
}

function assertOnlyKnownError(result) {
    if (result.error) {
        assert.match(
            String(result.error?.message ?? result.error),
            KNOWN_PREEXISTING_ERROR,
            `createOpenapiServer 出现未知错误（缓存改造可能引入回归）: ${result.error?.stack ?? result.error}`
        );
    }
}

async function listToolNames(server) {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'openapi-cache-test', version: '1.0.0' }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
        const { tools } = await client.listTools();
        return tools.map((tool) => tool.name).sort();
    } finally {
        await client.close();
    }
}

async function main() {
    assert.equal(getOpenapiSpecLoadCount(), 0, '导入模块阶段不应解析 spec');

    // 1) 并发创建多个不同身份的 server：memoized Promise 应保证只解析一次。
    const identities = ['alice', 'bob', 'carol', 'dave', 'erin'];
    const concurrent = await Promise.all(identities.map(tryCreate));
    concurrent.forEach(assertOnlyKnownError);

    const afterConcurrent = getOpenapiSpecLoadCount();
    assert.equal(
        afterConcurrent,
        1,
        `并发创建 ${identities.length} 个 server 后 spec 应只解析 1 次（memoized Promise），实际 ${afterConcurrent} 次`
    );

    // 2) 串行再创建一个：必须命中缓存。
    const extra = await tryCreate('frank');
    assertOnlyKnownError(extra);
    assert.equal(getOpenapiSpecLoadCount(), 1, '再次创建 server 不应重新解析 spec');

    const created = concurrent.filter((item) => item.server);
    const canInspect = created.length === concurrent.length && Boolean(extra.server);

    if (canInspect) {
        // 3) 创建路径可用时，进一步校验 session 之间实例隔离、工具集合一致。
        assert.equal(
            new Set(created.map((item) => item.server)).size,
            created.length,
            '不同 session 不应复用同一个 McpServer 实例'
        );
        assert.ok(!created.includes(extra.server), '新 session 不应复用已有 McpServer 实例');

        const first = await listToolNames(created[0]);
        const last = await listToolNames(created[created.length - 1]);
        const cached = await listToolNames(extra.server);

        assert.ok(first.length > 0, 'openapi server 应至少注册一个工具');
        assert.deepEqual(first, last, '不同 session 暴露的工具集合应一致');
        assert.deepEqual(first, cached, '缓存命中后的工具集合应与首个 session 一致');

        console.log(`OpenAPI spec 缓存验证通过：spec 仅解析 1 次，${created.length + 1} 个 session 共享，工具数 ${first.length}。`);
        return;
    }

    console.log('OpenAPI spec 缓存验证通过：spec 仅解析 1 次，后续 session 均复用缓存。');
    console.log('（注意：当前仓库存在既有的 mcp-tool-helpers 布尔 required 缺陷，工具注册阶段会抛错，故未做工具集合校验；该缺陷与本缓存改造无关。）');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
