import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executeTask} from '../task-entry.mjs';
import {syncWorker, collectEvidence, validateTransfer} from '../worker-transfer.mjs';

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'simulation-task-'));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    mkdirSync(join(root, 'simulation/extensions'), {recursive: true});
    writeFileSync(join(root, 'simulation/extensions/actions.mjs'), `export async function run(inputs) { return {status: 'ready', inputs}; }
      export async function fail() {throw new Error('credential=never-persist');}
      export async function rejected() {return {status:'failed'};}
      export async function incomplete() {return {status:'running'};}
      export async function custom() {return {status:'verified'};}`);
    writeFileSync(join(root, 'environment.json'), JSON.stringify({status: 'ready', deploymentId: 'existing'}));
    return root;
}
const plan = () => ({tasks: {initialize: {module: 'simulation/extensions/actions.mjs', export: 'run',
    inputs: {environment: {path: 'environment.json', status: 'ready'}}, output: 'baseline.json'}}});

test('generic task loads declared inputs, writes once and supports existing environment override', async t => {
    const root = fixture(t), config = plan();
    config.tasks.initialize.inputs.environment = {artifact: 'deployment.json', env: 'ENV_MANIFEST', status: 'ready'};
    const result = await executeTask(config, 'initialize', {root, runId: 'run-1', env: {ENV_MANIFEST: 'environment.json'}});
    assert.equal(JSON.parse(readFileSync(result.output)).inputs.environment.deploymentId, 'existing');
    await assert.rejects(executeTask(config, 'initialize', {root, runId: 'run-1'}), /already exists/);
    assert.equal(existsSync(`${result.output}.lock`), false);
});
test('task preflight blocks traversal, symlink escapes, unready inputs and concurrent lock', async t => {
    const root = fixture(t), config = plan();
    await assert.rejects(executeTask(config, 'initialize', {root, runId: '../other'}), /safe/);
    writeFileSync(join(root, 'outside.mjs'), 'throw new Error("must not import")');
    symlinkSync(join(root, 'outside.mjs'), join(root, 'simulation/extensions/escape.mjs'));
    config.tasks.initialize.module = 'simulation/extensions/escape.mjs';
    await assert.rejects(executeTask(config, 'initialize', {root, runId: 'run'}), /under simulation/);
    config.tasks.initialize.module = 'simulation/extensions/actions.mjs';
    writeFileSync(join(root, 'environment.json'), '{"status":"failed"}');
    await assert.rejects(executeTask(config, 'initialize', {root, runId: 'run'}), /status mismatch/);
    config.tasks.initialize.inputs = {};
    mkdirSync(join(root, 'simulation/reports/workflows/run'), {recursive: true});
    writeFileSync(join(root, 'simulation/reports/workflows/run/baseline.json.lock'), '');
    await assert.rejects(executeTask(config, 'initialize', {root, runId: 'run'}), /EEXIST/);
});
test('extension failures are sanitized and failed results remain failures', async t => {
    const root = fixture(t), config = plan();
    config.tasks.initialize.export = 'fail';
    await assert.rejects(executeTask(config, 'initialize', {root, runId: 'run'}), /Task initialize failed/);
    const failure = readFileSync(join(root, 'simulation/reports/workflows/run/initialize.failure.json'), 'utf8');
    assert.equal(failure.includes('credential'), false);
    assert.equal(existsSync(join(root, 'simulation/reports/workflows/run/baseline.json')), false);
    config.tasks.initialize.export = 'rejected';
    assert.equal((await executeTask(config, 'initialize', {root, runId: 'retry'})).failed, true);
    config.tasks.initialize.export = 'incomplete';
    assert.equal((await executeTask(config, 'initialize', {root, runId: 'incomplete'})).failed, true);
    config.tasks.initialize.export = 'custom';
    config.tasks.initialize.successStatuses = ['verified'];
    assert.equal((await executeTask(config, 'initialize', {root, runId: 'custom'})).failed, false);
    config.tasks.initialize.successStatuses = ['failed'];
    await assert.rejects(executeTask(config, 'initialize', {root, runId: 'bad'}), /successStatuses/);
});
const worker = {host: {transport: 'ssh', target: 'worker', workDir: '/srv/test'}, inputs: ['simulation/'], artifacts: ['deployment.json'], required: ['deployment.json']};
test('worker references the pipeline host instead of copying connection settings', t => {
    const root = fixture(t);
    writeFileSync(join(root, 'pipeline.json'), JSON.stringify({hosts: {remote: worker.host}}));
    assert.deepEqual(validateTransfer({hostRef: {pipeline: 'pipeline.json', host: 'remote'}}, root), worker.host);
    assert.throws(() => validateTransfer({...worker, hostRef: {}}, root), /exactly one/);
    assert.throws(() => validateTransfer({hostRef: {pipeline: 'pipeline.json', host: 'missing'}}, root), /does not exist/);
});
test('worker sync is explicit, preserves remote state and always excludes private inputs', t => {
    const root = fixture(t), calls = [];
    syncWorker(worker, {root, execute: (cmd, args) => {calls.push([cmd, args]); return cmd === 'rsync' && args[0] === '--version' ? 'rsync version 3.2.7' : '';}});
    const args = calls.at(-1)[1];
    assert(args.includes('--safe-links'));
    assert(args.includes('--exclude=.env'));
    assert(args.includes('--exclude=*.private.*'));
    assert(!args.includes('--delete'));
    assert.throws(() => syncWorker({...worker, inputs: ['../outside']}, {root}), /project-relative/);
    assert.throws(() => syncWorker({...worker, host: {...worker.host, target: '-oProxyCommand=bad'}}, {root}), /Invalid SSH/);
});
test('evidence collection is repeatable and never replaces conflicting local evidence', t => {
    const root = fixture(t);
    let body = '{"status":"ready"}';
    const execute = (_cmd, args) => writeFileSync(args.at(-1), body);
    assert.equal(collectEvidence(worker, {root, runId: 'run', execute}).status, 'collected');
    assert.equal(collectEvidence(worker, {root, runId: 'run', execute}).status, 'collected');
    body = '{"status":"different"}';
    assert.equal(collectEvidence(worker, {root, runId: 'run', execute}).status, 'failed');
    assert.equal(JSON.parse(readFileSync(join(root, 'simulation/reports/workflows/run/deployment.json'))).status, 'ready');
    assert.throws(() => collectEvidence({...worker, artifacts: ['../private.json']}, {root, runId: 'run', execute}), /filenames/);
});
