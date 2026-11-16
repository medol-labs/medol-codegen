import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerEnvironment, registerDeployment, createRun, loadRun, listRecords, checkRunInfrastructure, deploymentConfiguration} from '../instance-registry.mjs';
import {executeTask} from '../task-entry.mjs';
import {prepareEnvironment, planEnvironment} from '../environment-preparation.mjs';
import {runPipeline, executionCommand} from '../pipeline-runtime.mjs';

const fixture = t => {
  const root = mkdtempSync(join(tmpdir(), 'registry-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const definition = {id: 'cluster-a', mode: 'existing', target: 'kubernetes', environment: 'test', provisioner: 'existing', kubeconfigFile: '/tmp/cluster-a'};
  const readiness = {...definition, status: 'ready', infrastructureId: 'uid-a'};
  const probe = (cmd, args) => args.includes('--raw=/readyz') ? 'ok' : JSON.stringify({metadata: {uid: args.includes('kube-system') ? 'uid-a' : 'ns-1'}});
  registerEnvironment(root, definition, readiness);
  const declaration = {id: 'instance-a', environmentId: 'cluster-a', namespace: 'test-a', configFile: 'deployment.json'};
  const manifest = {status: 'ready', deploymentId: 'deployment-a', target: 'kubernetes', environment: 'test', namespace: 'test-a', kubeconfigFile: '/tmp/cluster-a', images: [{reference: 'registry/app@sha256:example'}], endpoints: {api: 'http://test-a:8080'}};
  registerDeployment(root, declaration, manifest, probe);
  return {root, definition, readiness, declaration, manifest, probe};
};
test('independent instance snapshots and runs reuse the same infrastructure without global selection', t => {
  const f = fixture(t);
  registerDeployment(f.root, {...f.declaration, id: 'instance-b', namespace: 'test-b'}, {...f.manifest, deploymentId: 'deployment-b', namespace: 'test-b'}, f.probe);
  createRun(f.root, 'run-a', 'instance-a'); createRun(f.root, 'run-b', 'instance-b');
  assert.equal(loadRun(f.root, 'run-a').deploymentId, 'deployment-a');
  assert.equal(loadRun(f.root, 'run-b').deploymentId, 'deployment-b');
  assert.equal(listRecords(f.root, 'deployments').length, 2);
  assert.throws(() => createRun(f.root, 'run-a', 'instance-b'), /EEXIST/);
  assert.throws(() => loadRun(f.root, '../escape'), /identifier/);
});
test('same environment profile can identify different clusters and rejects cross-cluster registration', t => {
  const f = fixture(t);
  registerEnvironment(f.root, {...f.definition, id: 'cluster-b', kubeconfigFile: '/tmp/cluster-b'}, {...f.readiness, kubeconfigFile: '/tmp/cluster-b', infrastructureId: 'uid-b'});
  assert.equal(listRecords(f.root, 'environments').length, 2);
  assert.throws(() => registerDeployment(f.root, {...f.declaration, id: 'bad', environmentId: 'cluster-b'}, f.manifest, f.probe), /cluster mismatch/);
});
test('changed cluster or namespace fails before business operations', t => {
  const f = fixture(t);
  const run = createRun(f.root, 'test-run', 'instance-a');
  checkRunInfrastructure(run, f.probe);
  assert.throws(() => checkRunInfrastructure(run, () => JSON.stringify({metadata: {uid: 'replacement'}})), /replaced|identity changed/);
});
test('existing Docker environment preparation never invokes k3d and registry supports Compose projects', async t => {
  const root = mkdtempSync(join(tmpdir(), 'compose-registry-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const definition = {id: 'docker-a', mode: 'existing', provisioner: 'existing', target: 'docker-compose', environment: 'local', dockerContext: 'desktop-linux'};
  const execute = (cmd, args) => { assert.equal(cmd, 'docker'); assert.equal(args[1], 'desktop-linux'); return JSON.stringify({ID: 'daemon-a', Architecture: 'aarch64'}); };
  const readiness = await prepareEnvironment(definition, {execute});
  registerEnvironment(root, definition, readiness);
  registerDeployment(root, {id: 'app-a', environmentId: 'docker-a', composeProject: 'app-a'}, {...readiness, deploymentId: 'compose-a', composeProject: 'app-a'}, execute);
  checkRunInfrastructure(createRun(root, 'run', 'app-a'), execute);
  assert.throws(() => planEnvironment({...definition, mode: 'managed'}), /existing Docker/);
});
test('credentials, data mismatch and snapshot edits are rejected', t => {
  const f = fixture(t);
  assert.throws(() => registerEnvironment(f.root, {...f.definition, id: 'secret', password: 'secret'}, f.readiness), /credential/);
  writeFileSync(join(f.root, 'bad-data.json'), JSON.stringify({status: 'ready', deploymentId: 'other'}));
  assert.throws(() => createRun(f.root, 'bad', 'instance-a', {baseline: 'bad-data.json'}), /another deployment/);
  createRun(f.root, 'run', 'instance-a');
  const file = join(f.root, 'simulation/reports/workflows/run/run.json');
  const value = JSON.parse(readFileSync(file)); value.instanceId = 'other'; writeFileSync(file, JSON.stringify(value));
  assert.throws(() => loadRun(f.root, 'run'), /fingerprint/);
});
test('declaration resolves connection from environment not stale workload defaults', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'deployment.json'), JSON.stringify({target: 'kubernetes', environment: 'test', kubeconfigFile: '/wrong', namespace: 'wrong'}));
  const config = deploymentConfiguration(f.root, f.declaration);
  assert.equal(config.kubeconfigFile, '/tmp/cluster-a'); assert.equal(config.namespace, 'test-a');
});
test('task consumes selected instance and reusable baseline, records binding, rejects override and lifecycle tasks', async t => {
  const f = fixture(t);
  const baseline = {status: 'ready', environment: 'test', deploymentId: 'deployment-a'};
  writeFileSync(join(f.root, 'baseline.json'), JSON.stringify(baseline));
  createRun(f.root, 'run', 'instance-a', {baseline: 'baseline.json'});
  mkdirSync(join(f.root, 'simulation/extensions'), {recursive: true});
  writeFileSync(join(f.root, 'simulation/extensions/check.mjs'), 'export const check = ({environment, baseline}) => ({status: "passed", deploymentId: environment.deploymentId, baseline: baseline.deploymentId});');
  const task = {scope: 'execution', module: 'simulation/extensions/check.mjs', export: 'check', output: 'test.json', inputs: {
    environment: {artifact: 'deployment.json', binding: 'deployment', env: 'OVERRIDE'}, baseline: {artifact: 'baseline.json', binding: 'baseline'}
  }};
  const options = {root: f.root, env: {MEDOL_SIMULATION_RUN_ID: 'run'}, executeInfrastructure: f.probe};
  assert.equal((await executeTask({tasks: {test: task}}, 'test', options)).failed, false);
  const binding = JSON.parse(readFileSync(join(f.root, 'simulation/reports/workflows/run/test.binding.json')));
  assert.equal(binding.instanceId, 'instance-a');
  await assert.rejects(executeTask({tasks: {deploy: {...task, scope: 'deployment', output: 'deploy.json'}}}, 'deploy', options), /execution-scoped/);
  writeFileSync(join(f.root, 'other.json'), JSON.stringify({...f.manifest, deploymentId: 'other'}));
  await assert.rejects(executeTask({tasks: {test: {...task, output: 'other-result.json'}}}, 'test', {...options, env: {...options.env, OVERRIDE: 'other.json'}}), /conflicts/);
});
test('bound remote pipelines propagate explicit run selection and refuse deployment phases', () => {
  const command = executionCommand({command: ['node', 'task.mjs']}, {transport: 'ssh', target: 'test-worker', workDir: '/work'}, 'run-a', undefined, true);
  assert.match(command.at(-1), /MEDOL_SIMULATION_RUN_ID='run-a'/);
  assert.throws(() => runPipeline({services: []}, {steps: [{id: 'deploy', phase: 'deployment', command: ['false']}]}, {runId: 'run-a', plan: true}), /cannot prepare/);
});
