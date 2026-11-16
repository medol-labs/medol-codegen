import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {instanceSlot, instanceOverlay, createKubernetesInstances, renderBindings} from '../kubernetes-instances.mjs';

const bundle = {
    schemaVersion: 1, namespaceTemplate: '{{parentNamespace}}-worker-{{slot}}',
    service: 'processor', endpointTemplate: 'http://processor.{{namespace}}:9090',
    workspace: '.work/instances', resources: ['deployment.yaml'],
    images: [{name: 'processor', source: 'example/processor'}],
    patches: [], privatePatches: [], publicPatches: [], secrets: ['worker-secret'], readiness: ['processor'],
    enrollment: {configMap: 'identity', immutableKeys: ['INSTANCE_ID'], deployment: 'processor',
        podSpec: {nodeSelector: {'kubernetes.io/hostname': '{{nodeName}}'}}}
};
test('unrelated service package renders and deploys without business names', () => {
    const root = mkdtempSync(join(tmpdir(), 'instances-'));
    try {
        writeFileSync(join(root, 'deployment.yaml'), 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: processor\n');
        const options = {root, environment: 'test', namespace: 'example', kubeconfigFile: '/explicit/config',
            count: 2, timeoutMs: 1000, imagePrefix: 'registry', imageVersion: 'v1'};
        const overlay = instanceOverlay(bundle, {...options, slot: 2});
        assert.equal(overlay.namespace, 'example-worker-2');
        assert.equal(overlay.images[0].newName, 'registry/processor');
        assert.equal(instanceSlot(bundle, 'example', 2).endpoint, 'http://processor.example-worker-2:9090');
        const calls = [];
        const instances = createKubernetesInstances(bundle, {...options, execute: (args, input) => {
            calls.push({args, input});
            return args.includes('secret') ? JSON.stringify({type: 'Opaque', data: {key: 'dmFsdWU='}}) : '';
        }});
        instances.deploy(); instances.waitReady();
        assert.equal(calls.filter(c => c.args.includes('restart')).length, 0);
        assert.equal(calls.filter(c => c.args.includes('status')).length, 2);
        assert.throws(() => instances.enroll(1, {}, 'node-a'), /incomplete/);
        instances.enroll(1, {INSTANCE_ID: 'one'}, 'node-a');
        assert(calls.some(c => c.args.includes('restart')));
        assert(!JSON.stringify(calls).includes('federation'));
    } finally {rmSync(root, {recursive: true, force: true});}
});
test('missing bindings, namespace collisions and invalid workload names fail closed', () => {
    assert.throws(() => renderBindings('{{missing}}', {}), /Missing/);
    assert.equal(renderBindings('{{port}}', {port: 31000}), 31000);
    const options = {root: '/tmp', environment: 'test', namespace: 'example', kubeconfigFile: '/config', count: 2, timeoutMs: 1000};
    assert.throws(() => createKubernetesInstances({...bundle, namespaceTemplate: 'same'}, options), /distinct/);
    assert.throws(() => instanceSlot({...bundle, readiness: ['']}, 'example', 1), /readiness/);
    assert.throws(() => instanceSlot(bundle, 'example', 1, {publicUrl: 'https://host', capacity: 1, hostPortStart: 31000, nodePortStart: 29999}), /range/);
});
test('registration cannot overwrite an existing identity', () => {
    let mutations = 0;
    const instances = createKubernetesInstances(bundle, {root: '/tmp', environment: 'test', namespace: 'example',
        kubeconfigFile: '/config', count: 1, timeoutMs: 1000, execute: args => {
            if (args.includes('apply') || args.includes('patch')) mutations++;
            return args.includes('configmap') ? JSON.stringify({data: {INSTANCE_ID: 'old'}}) : '';
        }});
    assert.throws(() => instances.enroll(1, {INSTANCE_ID: 'new'}, 'node-a'), /another registration/);
    assert.equal(mutations, 0);
});
