import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createKubernetesDeployment} from '../kubernetes-deployment.mjs';

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'kube-deploy-'));
    mkdirSync(join(root, 'base')); writeFileSync(join(root, 'secrets.yaml'), 'private'); writeFileSync(join(root, 'kube'), 'test');
    const bundle = {schemaVersion: 1, namespace: 'test', workspace: 'work', resources: ['base'], secrets: ['secrets.yaml'], images: [{service: 'api', alias: 'example/api', reference: 'registry.test/api:v1'}]};
    const config = {environment: 'test', kubeconfigFile: 'kube', platform: 'linux/arm64', instances: [{service: 'api', replicas: 1}]};
    return {root, bundle, config, catalog: {services: [{name: 'api'}]}};
}
test('wrong image architecture prevents apply and no cluster provisioner is invoked', async () => {
    const f = fixture(); const calls = [];
    try {
        const adapter = createKubernetesDeployment(f.bundle, f.config, {...f, execute(command, args) {
            calls.push([command, ...args]);
            if (command === 'docker' && args[0] === 'pull') return '';
            return JSON.stringify([{Id: 'id', Os: 'linux', Architecture: 'amd64'}]);
        }});
        await assert.rejects(adapter.deploy(), /Verify images/);
        await assert.rejects(adapter.prepareImages(), /architecture/);
        await assert.rejects(adapter.deploy(), /Verify images/);
        assert.ok(calls.every(([command]) => command === 'docker'));
    } finally { rmSync(f.root, {recursive: true, force: true}); }
});
test('render failure never applies secrets or workloads; mirror overrides are explicit', async () => {
    const f = fixture(); const calls = [];
    try {
        const adapter = createKubernetesDeployment(f.bundle, {...f.config, images: {api: 'mirror.test/api:v2'}}, {...f, execute(command, args) {
            calls.push([command, ...args]);
            if (command === 'docker' && args[0] === 'pull') return '';
            if (command === 'docker') return JSON.stringify([{Id: 'id', Os: 'linux', Architecture: 'arm64', RepoDigests: ['mirror.test/api@sha256:' + 'b'.repeat(64)]}]);
            throw new Error('render failed');
        }});
        await adapter.prepareImages();
        assert.equal(adapter.images().api, 'mirror.test/api@sha256:' + 'b'.repeat(64));
        await assert.rejects(adapter.deploy(), /render failed/);
        assert.ok(!calls.some(call => call.includes('apply')));
    } finally { rmSync(f.root, {recursive: true, force: true}); }
});
