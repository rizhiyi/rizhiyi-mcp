import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createUsageLogEntry, UsageLogger } from '../dist/usage-log.js';

const directory = await mkdtemp(path.join(tmpdir(), 'rizhiyi-usage-log-'));
const now = new Date(2026, 8, 21, 10, 0, 0);

try {
    const logger = new UsageLogger({
        directory,
        namePrefix: 'audit',
        rotateBytes: 1,
        rotateInterval: '1d',
        keepFiles: 2
    }, () => now);

    for (const status of ['ok', 'ok-limited', 'error']) {
        await logger.write(createUsageLogEntry({
            session_id: 'session-1',
            serverName: 'manage',
            tool: 'select_module',
            routeName: 'manage',
            status,
            duration_ms: 3,
            user: 'demo-user',
            error_code: status === 'ok-limited' ? 'RATE_LIMIT_EXCEEDED' : null
        }, now));
    }

    const names = (await readdir(directory)).sort();
    assert.deepEqual(names, ['audit-20260921.1.log', 'audit-20260921.2.log']);

    const latest = JSON.parse((await readFile(path.join(directory, names[1]), 'utf8')).trim());
    assert.equal(latest.status, 'error');
    assert.equal(latest.user, 'demo-user');
    assert.equal(latest.session_id, 'session-1');
    assert.equal('query' in latest, false);

    const hourlyDirectory = path.join(directory, 'hourly');
    const hourlyNow = [new Date(2026, 8, 21, 10, 0, 0)];
    const hourlyLogger = new UsageLogger({
        directory: hourlyDirectory,
        namePrefix: 'hourly',
        rotateBytes: 0,
        rotateInterval: '1h',
        keepFiles: 7
    }, () => hourlyNow[0]);
    const hourlyEntry = createUsageLogEntry({
        session_id: 'session-2',
        serverName: 'manage',
        tool: 'select_module',
        routeName: 'manage',
        status: 'ok',
        duration_ms: 1,
        user: 'demo-user',
        error_code: null
    }, hourlyNow[0]);
    await hourlyLogger.write(hourlyEntry);
    const firstHourlyPath = path.join(hourlyDirectory, 'hourly-20260921.log');
    await utimes(firstHourlyPath, hourlyNow[0], hourlyNow[0]);
    hourlyNow[0] = new Date(2026, 8, 21, 11, 0, 0);
    await hourlyLogger.write(hourlyEntry);
    assert.deepEqual(
        (await readdir(hourlyDirectory)).sort(),
        ['hourly-20260921.1.log', 'hourly-20260921.log']
    );
    console.log('Usage log rotation test passed');
} finally {
    await rm(directory, { recursive: true, force: true });
}
