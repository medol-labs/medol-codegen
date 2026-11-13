import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {planDeployment, runDeployment, deploymentSteps, workloadPatches} from '../deployment-runtime.mjs';

test('explicit workload selection excludes unselected manifests without deleting live objects', () => {
    const patches = workloadPatches(['api', 'worker'], [{service: 'api', replicas: 2}]).map(item => JSON.parse(item.patch));
    assert.equal(patches[0].spec.replicas, 2);
    assert.deepEqual(patches.slice(1).map(item => [item.kind, item.metadata.name, item.$patch]), [
        ['Deployment', 'worker', 'delete'], ['Service', 'worker', 'delete']
    ]);
    assert.throws(() => workloadPatches(['api'], []), /Explicit/);
    assert.throws(() => workloadPatches(['api'], [{service: 'missing', replicas: 1}]), /Invalid/);
});

const config = {target: 'k3d', environment: 'test', platform: 'linux/arm64', computeNodes: 2,
    instances: [{service: 'worker', replicas: 20}]};
const catalog = {services: [{name: 'worker'}]};

test('node count is independent of replicas and services are validated', () => {
    assert.equal(planDeployment(config, catalog).instances[0].replicas, 20);
    assert.throws(() => planDeployment(config), /Unknown service/);
    assert.throws(() => planDeployment({...config, computeNodes: 0}, catalog), /computeNodes/);
    assert.throws(() => planDeployment({...config, externalServices: [{name: 'worker'}]}, catalog), /Duplicate/);
});

test('writes a ready instance only after infrastructure stages, without arbitrary snapshot fields', async () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-'));
    const calls = [];
    try {
        const result = await runDeployment(config, async (_, plan) => {
            assert.equal(plan.computeNodes, 2);
            return {...Object.fromEntries(deploymentSteps.map(step => [step, async () => calls.push(step)])),
                deploymentSnapshot: () => ({status: 'fake', token: 'secret', nodes: [{name: 'node', architecture: 'arm64', ready: true}]}),
                cleanup: async () => calls.push('cleanup')};
        }, {catalog, reportRoot: root});
        assert.deepEqual(calls, [...deploymentSteps, 'cleanup']);
        assert.equal(result.status, 'ready');
        assert.equal(result.token, undefined);
        assert.equal(JSON.parse(readFileSync(join(root, `${result.attemptId}.steps.json`))).status, 'ready');
    } finally { rmSync(root, {recursive: true, force: true}); }
});

test('failure writes no ready instance and does not persist secret exception text', async () => {
    const root = mkdtempSync(join(tmpdir(), 'deployment-'));
    try {
        await assert.rejects(runDeployment(config, async () => {
            throw new Error('secret credential');
        }, {catalog, reportRoot: root}), /secret credential/);
        const files = readdirSync(root);
        assert.equal(files.length, 1);
        const text = readFileSync(join(root, files[0]), 'utf8');
        assert.equal(JSON.parse(text).status, 'failed');
        assert.equal(text.includes('secret credential'), false);
    } finally { rmSync(root, {recursive: true, force: true}); }
});

test('generator emits the runtime, entry, guide and generic config', () => {
    const require = createRequire(import.meta.url);
    const {generateSimulationFiles} = require('../simulation-generator.js');
    const files = generateSimulationFiles({name: 'example', scenarios: []}, {target: 'runtime'});
    assert.equal(files['src/runtime/deployment.mjs'], readFileSync(new URL('../deployment-runtime.mjs', import.meta.url), 'utf8'));
    assert.ok(files['src/deploy.mjs']);
    assert.ok(files['DEPLOYMENT.md']);
    assert.deepEqual(JSON.parse(files['pipelines/deployment-config.json-example']).instances, []);
});
