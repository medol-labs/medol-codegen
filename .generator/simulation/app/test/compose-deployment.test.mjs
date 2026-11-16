import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createComposeDeployment} from '../compose-deployment.mjs';

test('Compose uses explicit context/project, existing native images and no cleanup', async t => {
  const root = mkdtempSync(join(tmpdir(), 'compose-deploy-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  writeFileSync(join(root, '.env'), 'PASSWORD=private\n');
  const calls = [];
  const config = {target: 'docker-compose', dockerContext: 'test', composeProject: 'app', files: ['compose.yml'],
    envFile: '.env', platform: 'linux/amd64', instances: [{service: 'backend', replicas: 1}]};
  const execute = (_cmd, args) => {
    calls.push(args);
    if (args.includes('info')) return JSON.stringify({ID: 'daemon', Architecture: 'x86_64', Name: 'test'});
    if (args.includes('config')) return JSON.stringify({services: {backend: {image: 'test:1'}}});
    if (args.includes('image')) return JSON.stringify([{Architecture: 'amd64', Id: 'image-id'}]);
    if (args.includes('ps')) return 'container';
    if (args.includes('inspect')) return JSON.stringify([{State: {Running: true, Health: {Status: 'healthy'}}}]);
    return '';
  };
  const adapter = createComposeDeployment(config, {root, execute});
  await adapter.validateConnection(); await adapter.prepareImages(); await adapter.deploy(); await adapter.waitDeploymentReady();
  assert.equal(adapter.deploymentSnapshot().nodes[0].architecture, 'amd64');
  assert.ok(calls.some(args => args.includes('--pull') && args.includes('never')));
  assert.ok(calls.every(args => args[1] === 'test' && !args.includes('down')));
  const wrong = createComposeDeployment({...config, platform: 'linux/arm64'}, {root, execute});
  await assert.rejects(wrong.prepareImages(), /architecture/);
});
