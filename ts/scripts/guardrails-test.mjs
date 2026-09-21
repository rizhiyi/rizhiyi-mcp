import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { getRuntimeConfig } from '../dist/config.js';
import {
    applyOutputGuardrails,
    assessGeneratedSpl,
    assessToolArguments,
    extractCommandSegments,
    parseTimeRangeToHours
} from '../dist/spl-guardrails.js';
import { saveSharedResult } from '../dist/shared-result-store.js';

function config(extra = {}) {
    return getRuntimeConfig({
        LOGEASE_BASE_URL: 'https://example.invalid',
        MCP_GUARDRAILS_ENABLED: 'true',
        ...extra
    }).guardrails;
}

const nested = assessToolArguments(
    config({ MCP_GUARDRAIL_ENFORCE_MODE: 'enforce' }),
    'log-tools',
    'log_search_sheet',
    {
        query: 'appname:web | append [[ search index=prod | delete ]]',
        time_range: 'now-1h,now'
    }
);
assert.equal(nested.action, 'blocked');
assert.deepEqual(nested.deniedCommands, ['delete']);

const commands = extractCommandSegments('| inputlookup safe.csv | stats count() as cnt')
    .map(([command]) => command);
assert.equal(commands.includes('inputlookup'), true);
assert.equal(commands.includes('outputlookup'), false);
assert.equal(
    extractCommandSegments('delete error_message:"failed" | stats count() as cnt')
        .map(([command]) => command)
        .includes('delete'),
    false
);

const dashboard = assessToolArguments(
    config({ MCP_GUARDRAIL_ENFORCE_MODE: 'enforce' }),
    'dashboard',
    'create_dashboard_from_spec',
    {
        tabs: [{ panels: [{ query: 'index=prod | outputlookup override=true export.csv', time_range: '-1h,now' }] }]
    }
);
assert.equal(dashboard.shouldBlock, true);
assert.deepEqual(dashboard.deniedCommands, ['outputlookup']);

const output = applyOutputGuardrails({
    hits: [
        { card: '4111 1111 1111 1111', ssn: '123-45-6789' },
        { card: '5555-5555-5555-4444', timestamp: '1690000000000' }
    ]
}, config({ MCP_GUARDRAIL_MAX_EVENTS: '1' }));
assert.equal(output.sanitizedValues, 2);
assert.equal(output.truncatedEvents, 1);
assert.deepEqual(output.truncatedPaths, ['result.hits']);
assert.deepEqual(output.data.hits, [{ card: '****-****-****-1111', ssn: '***-**-****' }]);
const timestampOutput = applyOutputGuardrails({ timestamp: '1690000000000' }, config());
assert.equal(timestampOutput.sanitizedValues, 0);
assert.equal(timestampOutput.data.timestamp, '1690000000000');
assert.equal(parseTimeRangeToHours('-5min'), 5 / 60);

const scoredOnly = assessToolArguments(
    config({ MCP_GUARDRAIL_ENFORCE_MODE: 'enforce' }),
    'log-tools',
    'log_search_sheet',
    { query: '* | transaction request_id | join host [ search * ]', time_range: 'all' }
);
assert.equal(scoredOnly.riskScore, 100);
assert.equal(scoredOnly.action, 'audit');

const generated = assessGeneratedSpl(
    config({ MCP_GUARDRAIL_ENFORCE_MODE: 'enforce' }),
    'chatspl',
    'chat_spl',
    { spl: 'index=prod | outputlookup export.csv' }
);
assert.equal(generated.shouldBlock, true);

const storeDir = await mkdtemp(path.join(tmpdir(), 'rizhiyi-guardrail-store-'));
try {
    const envelope = await saveSharedResult({
        toolName: 'log_search_sheet',
        resultKind: 'rows',
        payload: { hits: [] },
        summary: { title: 'test', text: 'test' },
        sourceQuery: 'card:"4111 1111 1111 1111"',
        guardrailConfig: config()
    }, {
        storeDir,
        defaultTtlSeconds: 60,
        inlineMaxBytes: 24 * 1024,
        maxFileBytes: 5 * 1024 * 1024
    });
    assert.equal(envelope.source_query, 'card:"****-****-****-1111"');
} finally {
    await rm(storeDir, { recursive: true, force: true });
}

console.log('SPL guardrails test passed');
