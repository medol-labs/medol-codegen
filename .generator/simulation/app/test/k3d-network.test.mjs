import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pinNetwork, assertStaticNetwork} from '../k3d-network.mjs';

test('dynamic addresses fail closed instead of editing Kubernetes status', () => {
    assert.throws(() => assertStaticNetwork({containers: [{name: 'worker', ip: '172.20.0.2'}]}), /dynamic/);
});

test('pin preserves IDs, addresses and aliases, backs up before stopping and is idempotent', () => {
    const root = mkdtempSync(join(tmpdir(), 'k3d-pin-'));
    let pinned = false;
    const calls = [];
    const file = join(root, 'backup.json');
    const execute = (cmd, args) => {
        calls.push([cmd, args]);
        if (cmd === 'k3d' && args[1] === 'stop') assert.equal(JSON.parse(readFileSync(file)).containers[0].id, 'node-id');
        if (cmd === 'docker' && args[0] === 'ps') return 'node-id';
        if (cmd === 'docker' && args[0] === 'inspect') return JSON.stringify([{Id: 'node-id', Name: '/worker', State: {Running: true}, NetworkSettings: {Networks: {net: {IPAddress: '172.20.0.2', Aliases: ['worker-alias'], IPAMConfig: pinned ? {IPv4Address: '172.20.0.2'} : null}}}}]);
        if (args[1] === 'inspect') return JSON.stringify([{Id: 'net-id', Name: 'net', Driver: 'bridge', IPAM: {Config: []}}]);
        if (args[1] === 'connect') pinned = true;
        return '';
    };
    try {
        pinNetwork('test', file, execute);
        assert.ok(calls.some(([, a]) => a.join(' ') === 'network connect --ip 172.20.0.2 --alias worker-alias net-id node-id'));
        assert.ok(!calls.some(([, a]) => a.includes('rm') || a.includes('delete')));
        calls.length = 0;
        pinNetwork('test', file, execute);
        assert.ok(calls.every(([cmd, a]) => cmd === 'docker' && (a[0] === 'ps' || a.includes('inspect'))));
    } finally {rmSync(root, {recursive: true, force: true});}
});
