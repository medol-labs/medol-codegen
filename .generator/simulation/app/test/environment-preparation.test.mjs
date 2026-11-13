import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareEnvironment, planEnvironment} from '../environment-preparation.mjs';

const nodes = {items: [{metadata: {name: 'worker', labels: {}}, status: {nodeInfo: {architecture: 'arm64'}, conditions: [{type: 'Ready', status: 'True'}]}}]};
const base = {environment: 'test', target: 'kubernetes', provisioner: 'existing', kubeconfigFile: '/tmp/existing-config', workerNodes: 1};
test('existing infrastructure performs read-only Kubernetes checks without k3d', async () => {
    const calls = [];
    const result = await prepareEnvironment(base, {execute: (cmd, args, env) => {
        calls.push([cmd, args]);
        assert.equal(env.KUBECONFIG, base.kubeconfigFile);
        return args.includes('nodes') ? JSON.stringify(nodes) : 'ok';
    }});
    assert.equal(result.status, 'ready');
    assert.ok(calls.every(([cmd, args]) => cmd === 'kubectl' && args[0] === 'get'));
});
test('k3d creates only a missing cluster and keeps worker count explicit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'environment-'));
    try {
        for (const exists of [false, true]) {
            const calls = [];
            await prepareEnvironment({...base, provisioner: 'k3d', clusterName: 'test', clusterConfig: 'operations/cluster.yaml', kubeconfigFile: join(root, 'config')}, {
                execute: (cmd, args) => {
                    calls.push([cmd, args]);
                    if (cmd === 'k3d' && args[1] === 'list') return JSON.stringify(exists ? [{name: 'test'}] : []);
                    if (cmd === 'k3d' && args[0] === 'kubeconfig') return 'kubeconfig';
                    return args.includes('nodes') ? JSON.stringify(nodes) : 'ok';
                }
            });
            assert.equal(calls.some(([, args]) => args[1] === 'create'), !exists);
            assert.equal(readFileSync(join(root, 'config'), 'utf8'), 'kubeconfig');
        }
    } finally { rmSync(root, {recursive: true, force: true}); }
});
test('capacity mismatch does not trigger infrastructure mutation', async () => {
    await assert.rejects(prepareEnvironment({...base, workerNodes: 20}, {execute: (cmd, args) => {
        assert.equal(cmd, 'kubectl');
        return args.includes('nodes') ? JSON.stringify(nodes) : 'ok';
    }}), /Insufficient/);
    assert.throws(() => planEnvironment({...base, provisioner: 'unknown'}), /provisioner/);
});
