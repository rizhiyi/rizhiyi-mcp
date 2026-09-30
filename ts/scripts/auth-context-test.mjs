#!/usr/bin/env node
/**
 * auth-context-test.mjs
 *
 * 认证上下文的 username 派生规则（与 python/tests/test_auth_context.py 对称）。
 *
 * 回归点：`username` 只应在 **apikey** 场景被注入 query params（那类日志易部署要求
 * 把 username 作为参数传，避免中文用户名写不进 HTTP header）。
 *
 * **Basic** 认证必须保持干净：凭据已在 Authorization 头里，而另一类日志易版本
 * （实测 192.168.43.196）会直接拒绝该参数——
 * `4104 Parameters 中不支持传入 username`——注入反而把请求打挂。
 *
 * 用法：cd ts && npm run build && node scripts/auth-context-test.mjs
 */

import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(__dirname, '..', 'dist');
const require = createRequire(import.meta.url);

let buildAuthContextFromAuthorization;
try {
    ({ buildAuthContextFromAuthorization } = require(resolve(distRoot, 'auth-context.js')));
} catch (error) {
    console.error('[FATAL] 无法加载 ts/dist/auth-context.js，请先 `cd ts && npm run build`。');
    console.error('  details:', String(error?.message || error));
    process.exit(2);
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

const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

console.log('=== apikey：从 user:secret 派生 username ===');
{
    const context = buildAuthContextFromAuthorization('apikey demo-user:demo-secret');
    assert(context.username === 'demo-user', `应派生 demo-user，实际 ${context.username}`);
    assert(context.headers.Authorization === 'apikey demo-secret', 'header 里只应放 secret');
}

console.log('\n=== apikey：没有 user 段 ===');
{
    const context = buildAuthContextFromAuthorization('apikey demo-secret');
    assert(context.username === undefined, `不应派生 username，实际 ${context.username}`);
}

console.log('\n=== Basic：不得派生 username（否则新版日志易报 4104）===');
{
    const header = basic('admin', 'All#123456');
    const context = buildAuthContextFromAuthorization(header);
    assert(context.username === undefined, `Basic 不应派生 username，实际 ${context.username}`);
    assert(context.headers.Authorization === header, 'Authorization 头应原样保留');
    assert(
        context.authorization && context.authorization.username === 'admin',
        '身份仍可从凭据里取到（供使用日志使用）'
    );
}

console.log('\n=== 显式 username 优先于两种 scheme ===');
{
    const viaApiKey = buildAuthContextFromAuthorization('apikey demo-user:demo-secret', 'override');
    assert(viaApiKey.username === 'override', `apikey + 显式 username 应取 override，实际 ${viaApiKey.username}`);
    const viaBasic = buildAuthContextFromAuthorization(basic('admin', 'pw'), 'override');
    assert(viaBasic.username === 'override', `basic + 显式 username 应取 override，实际 ${viaBasic.username}`);
}

console.log('\n=== 缺少 Authorization 头 ===');
{
    const context = buildAuthContextFromAuthorization(undefined, 'only');
    assert(context.authorization === undefined, 'authorization 应为空');
    assert(context.username === 'only', '应保留显式 username');
    assert(Object.keys(context.headers).length === 0, 'headers 应为空');
}

console.log('');
if (failures === 0) {
    console.log('auth-context-test: ALL PASSED ✓');
    process.exit(0);
}
console.log(`auth-context-test: FAILURES=${failures}`);
process.exit(1);
