import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const calls = [];
const pending = [];
const modules = new Map();
const logger = { error() {} };
function load(filename) {
    filename = resolve(filename);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText;
    const localRequire = name => {
        if (name === 'node:child_process') return {
            execFile(executable, args, options, callback) {
                const call = { executable, args, options, stdinClosed: false };
                calls.push(call);
                pending.push(callback);
                return { stdin: { end() { call.stdinClosed = true; } } };
            }
        };
        if (name === '@elgato/streamdeck') return { logger };
        if (name.startsWith('.')) return load(resolve(dirname(filename), `${name}.ts`));
        return require(name);
    };
    vm.runInNewContext(source, { module, exports: module.exports, require: localRequire, process, Buffer }, { filename });
    return module.exports;
}

const cli = load('src/providers/agy-cli.ts');
const { AgyQuotaProvider, selectAgyBucket } = load('src/providers/agy-quota.ts');
const bucket = (id, remaining_fraction, extra = {}) => ({ id, name: id, window: id.endsWith('weekly') ? 'weekly' : '5h', remaining_fraction, reset_time: '2026-10-19T00:00:00Z', ...extra });
const envelope = (name, data) => ({ status: 'SUCCESS', num_turns: 0, command: { name, data } });
const fixture = envelope('usage', { groups: [
    { name: 'Gemini', buckets: [bucket('gemini-weekly', 0.8), bucket('gemini-5h', 0)] },
    { name: 'Claude and GPT', buckets: [bucket('3p-weekly', 0.5), bucket('3p-5h', 1)] },
    { name: 'Gemini 4 Argon', buckets: [bucket('gemini-argon-wtu-weekly', 0.95)] }
] });
const parsed = cli.parseAgyUsage(fixture);
assert.equal(parsed.length, 5);
assert.equal(parsed[1].remainingFraction, 0);
assert.equal(parsed[4].window, 'weekly');
assert.equal(parsed[4].resetTime, '2026-10-19T00:00:00Z');
assert.equal(cli.parseAgyUsage(envelope('quota', fixture.command.data)).length, 5);
assert.equal(cli.parseAgyUsage(envelope('usage', { groups: [{ name: 'Disabled', buckets: [bucket('off', 0.5, { disabled: true }), bucket('missing', undefined)] }] }))[0].remainingFraction, undefined);
assert.equal(cli.parseAgyUsage(envelope('usage', { groups: [{ name: 'Missing', buckets: [bucket('missing', undefined)] }] }))[0].remainingFraction, undefined);
for (const fraction of [-1, 1.1, NaN, Infinity, '0.5']) {
    assert.throws(() => cli.parseAgyUsage(envelope('usage', { groups: [{ name: 'Bad', buckets: [bucket('bad', fraction)] }] })), /invalid quota fraction/);
}
for (const invalid of [null, {}, { ...fixture, status: 'ERROR' }, { ...fixture, num_turns: 1 }, envelope('chat', fixture.command.data), envelope('usage', {})]) {
    assert.throws(() => cli.parseAgyUsage(invalid));
}
assert.equal(cli.parseAgyCredits(envelope('credits', { remaining_credits: 0 })), 0);
for (const credits of [undefined, null, -1, '12', NaN]) {
    assert.throws(() => cli.parseAgyCredits(envelope('credits', { remaining_credits: credits })));
}
assert.equal(selectAgyBucket(parsed, {}).id, 'gemini-5h');
assert.equal(selectAgyBucket(parsed, { modelLabel: 'claude-sonnet' }).id, '3p-weekly');
assert.equal(selectAgyBucket(parsed, { modelLabel: 'GPT' }).id, '3p-weekly');
assert.equal(selectAgyBucket(parsed, { modelLabel: 'Gemini Pro' }).id, 'gemini-5h');
assert.equal(selectAgyBucket(parsed, { modelLabel: 'Gemini Argon' }).id, 'gemini-argon-wtu-weekly');
assert.equal(selectAgyBucket(parsed, { bucketId: 'missing', modelLabel: 'gemini' }), undefined);
assert.equal(selectAgyBucket(parsed, { modelLabel: 'unknown' }), undefined);

const first = cli.getAgyBuckets();
assert.equal(cli.getAgyBuckets(), first);
assert.equal(calls.length, 1);
assert.deepEqual(Array.from(calls[0].args), ['-p', '/usage', '--output-format', 'json', '--print-timeout', '20s']);
assert.equal(calls[0].options.windowsHide, true);
assert.equal(calls[0].options.timeout, 30000);
assert.equal(calls[0].options.env.AGY_CLI_DISABLE_AUTO_UPDATE, 'true');
assert.equal(calls[0].options.cwd, require('node:os').tmpdir());
assert.equal(calls[0].stdinClosed, true);
pending.shift()(null, JSON.stringify(fixture));
await first;
await cli.getAgyBuckets();
assert.equal(calls.length, 1, 'staggered buttons reuse the short snapshot');
const forced = cli.getAgyBuckets(true);
const creditsRequest = cli.getAgyCredits();
assert.equal(calls.length, 3, 'manual refresh bypasses snapshot and credits use their own command');
assert.equal(calls[2].args[1], '/credits');
pending.shift()(null, JSON.stringify(fixture));
pending.shift()(null, JSON.stringify(envelope('credits', { remaining_credits: 0 })));
await forced;
assert.equal(await creditsRequest, 0);

let settings = { bucketId: 'gemini-5h' };
let image;
let display;
const action = { id: 'test', async getSettings() { return settings; }, async setTitle() {}, async setImage(value) { image = Buffer.from(value.split(',')[1], 'base64').toString(); } };
const provider = new AgyQuotaProvider((_action, value) => { display = value; });
await provider.check(action);
assert.match(image, />100%<\/text>/);
assert.match(image, /5H USED/);
assert.match(image, /AGY GEMINI/);
assert.match(display, /resets/);
async function refresh(response) {
    const checking = provider.check(action, true);
    await new Promise(setImmediate);
    pending.shift()(null, JSON.stringify(response));
    await checking;
}
const changed = structuredClone(fixture);
changed.command.data.groups[0].buckets[1].remaining_fraction = 0.5;
await refresh(changed);
assert.match(image, /-50%/);
assert.match(image, /fill="#10b981"[^>]*>-50%/);
changed.command.data.groups[0].buckets[1].remaining_fraction = 0.3;
await refresh(changed);
assert.match(image, /fill="#ef4444"[^>]*>\+20%/);
settings = { bucketId: '3p-weekly' };
await provider.check(action);
assert.match(image, /AGY 3P/);
assert.doesNotMatch(image, /\+20%/);
settings = { bucketId: 'gemini-5h' };
changed.command.data.groups[0].buckets[1].disabled = true;
await refresh(changed);
assert.match(image, /No Data/);
assert.match(display, /unavailable/);
settings = { bucketId: 'missing' };
await provider.check(action);
assert.match(image, /No Data/);
assert.match(display, /unavailable/);
settings = { displayMode: 'aiCredits' };
await provider.check(action);
assert.match(image, />0<\/text>/);
assert.equal(display, '0 Credits');
assert.doesNotMatch(image, /\+20%/);

settings = {};
const failedButton = provider.check(action, true);
await new Promise(setImmediate);
pending.shift()(Object.assign(new Error('private stderr'), { code: 'ETIMEDOUT' }), 'private stdout');
await failedButton;
assert.match(image, /Error/);
assert.match(display, /AGY query failed/);
assert.doesNotMatch(display, /private|remaining|Credits/);

const failed = cli.getAgyBuckets(true);
pending.shift()(Object.assign(new Error('secret stderr'), { code: 'ENOENT' }), '');
await assert.rejects(failed, /not installed/);
const invalidJson = cli.getAgyBuckets(true);
pending.shift()(null, 'private diagnostic, not JSON');
await assert.rejects(invalidJson, /invalid JSON/);

settings = { bucketId: 'gemini-weekly' };
const olderUsage = provider.check(action, true);
await new Promise(setImmediate);
const completeUsage = pending.shift();
settings = { displayMode: 'aiCredits' };
const newerCredits = provider.check(action, true);
await new Promise(setImmediate);
pending.shift()(null, JSON.stringify(envelope('credits', { remaining_credits: 24 })));
await newerCredits;
const creditsImage = image;
assert.equal(display, '24 Credits');
completeUsage(null, JSON.stringify(fixture));
await olderUsage;
assert.equal(image, creditsImage, 'superseded usage cannot overwrite newer credits');
assert.equal(display, '24 Credits');

settings = { bucketId: 'gemini-weekly' };
const olderError = provider.check(action, true);
await new Promise(setImmediate);
const failOldUsage = pending.shift();
settings = { displayMode: 'aiCredits' };
await provider.check(action);
const currentImage = image;
failOldUsage(Object.assign(new Error('private old failure'), { code: 'ETIMEDOUT' }), '');
await olderError;
assert.equal(image, currentImage, 'superseded failure cannot overwrite newer credits');
assert.equal(display, '24 Credits');
assert.equal(pending.length, 0);
console.log('AGY parser, selection, subprocess sharing and button checks passed.');
