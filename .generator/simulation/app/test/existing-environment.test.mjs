import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runPipeline} from '../pipeline-runtime.mjs';

test('data preparation reuses a deployment without executing provisioning', () => {
  const root = mkdtempSync(join(tmpdir(), 'reuse-env-'));
  try {
    writeFileSync(join(root, 'instance.json'), JSON.stringify({status: 'ready', target: 'kubernetes', environment: 'test', deploymentId: 'existing'}));
    const config = {existingEnvironment: {manifest: 'instance.json'}, steps: [
      {id: 'deploy', phase: 'deployment', command: ['must-not-run']},
      {id: 'data', phase: 'data-preparation', dependsOn: ['deploy'], command: [process.execPath, '-e', 'if(!process.env.MEDOL_ENVIRONMENT_MANIFEST)process.exit(1)']}
    ]};
    const report = runPipeline({services: []}, config, {root, stage: 'data-preparation'});
    assert.equal(report.status, 'passed');
    assert.deepEqual(report.steps.map(s => s.id), ['data']);
    assert.equal(report.existingEnvironment.deploymentId, 'existing');
    assert.equal(JSON.parse(readFileSync(join(root, 'simulation/reports', report.runId, 'report.json'))).existingEnvironment.environment, 'test');
    config.steps.push({id: 'verify', phase: 'test-execution', dependsOn: ['data'], command: ['must-not-run']});
    assert.throws(() => runPipeline({services: []}, config, {root, stage: 'test-execution', plan: true}), /Stage requires data/);
    config.reuseCompletedSteps = ['data'];
    assert.deepEqual(runPipeline({services: []}, config, {root, stage: 'test-execution', plan: true}).steps.map(s => s.id), ['verify']);
    config.hosts = {worker: {transport: 'ssh', target: 'test-host', workDir: '/srv/test'}};
    config.steps[2].host = 'worker';
    assert.throws(() => runPipeline({services: []}, config, {root, stage: 'test-execution', plan: true}), /remoteManifestPaths/);
    config.existingEnvironment.remoteManifestPaths = {worker: '/srv/test/instance.json'};
    assert.equal(runPipeline({services: []}, config, {root, stage: 'test-execution', plan: true}).status, 'planned');
    writeFileSync(join(root, 'instance.json'), JSON.stringify({status: 'ready', target: 'kubernetes', environment: 'test'}));
    assert.throws(() => runPipeline({services: []}, config, {root, plan: true}), /deployment instance/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
