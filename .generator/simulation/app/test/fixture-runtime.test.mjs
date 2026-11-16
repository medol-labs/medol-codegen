import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {provisionFixtures} from '../fixture-runtime.mjs';

test('fixture identity is arbitrary; configured source and destinations drive transfer', () => {
  const root = mkdtempSync(join(tmpdir(), 'fixture-'));
  try {
    writeFileSync(join(root, 'sample.bin'), 'test-content');
    const sha256 = createHash('sha256').update('test-content').digest('hex');
    const calls = [];
    const execute = (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === 'kubectl') return JSON.stringify({items: [{metadata: {name: 'k3d-demo-agent-0'}}]});
      return args.includes('sha256sum') ? sha256 + '  /data/input.bin' : '';
    };
    const fixture = {id: 'arbitrary-name', source: 'sample.bin', sha256, localPath: 'cache/input.bin',
      destinations: [{transport: 'k3d-node-file', nodeSelector: 'purpose=test', path: '/data/input.bin'}]};
    const environment = {clusterName: 'demo', kubeconfigFile: '/config'};
    const result = provisionFixtures([fixture], environment, {root, execute});
    assert.equal(result[0].id, 'arbitrary-name');
    assert.equal(readFileSync(join(root, 'cache/input.bin'), 'utf8'), 'test-content');
    assert(calls.some(([cmd, args]) => cmd === 'docker' && args[0] === 'cp' && args[2] === 'k3d-demo-agent-0:/data/input.bin'));
    calls.length = 0;
    assert.throws(() => provisionFixtures([fixture, {...fixture, id: 'bad', sha256: '0'.repeat(64)}], environment, {root, execute}), /digest/);
    assert(!calls.some(([cmd]) => cmd === 'docker'));
    assert.throws(() => provisionFixtures([{...fixture, destinations: [{transport: 'unknown'}]}], environment, {root, execute}), /transport/);
    assert.throws(() => provisionFixtures([fixture], environment, {root, execute: () => JSON.stringify({items: [{metadata: {name: 'other-node'}}]})}), /destination nodes/);
    assert.throws(() => provisionFixtures([fixture], environment, {root, execute: (cmd) => cmd === 'kubectl' ? JSON.stringify({items: [{metadata: {name: 'k3d-demo-agent-0'}}]}) : 'wrong'}), /Transferred/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
