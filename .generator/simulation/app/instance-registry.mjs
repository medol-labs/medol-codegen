import {readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hostname} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const safe = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value) && value !== '..';
const fail = message => { throw new Error(message); };
const executeDefault = (cmd, args) => execFileSync(cmd, args, {encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe']});
const id = value => { if (!safe(value)) fail('Invalid registry identifier'); return value; };
const fileFor = (root, kind, key) => resolve(root, 'simulation/instances', kind, id(key) + '.json');
const seal = value => ({...value, fingerprint: hash(value)});
function verify(value) {
  const {fingerprint, ...body} = value;
  if (fingerprint !== hash(body)) fail('Registry snapshot fingerprint mismatch');
  return value;
}
function create(file, value) {
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  return value;
}
function noCredentials(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(password|token|secret|privateKey|authorization|kubeconfigContent)$/i.test(key)) fail('Use credential references, not inline credentials');
    if (typeof child === 'string' && /^https?:\/\//.test(child)) {
      const url = new URL(child);
      if (url.username || url.password || url.search || url.hash) fail('Endpoints cannot contain credentials or query parameters');
    }
    noCredentials(child);
  }
}
export function registerEnvironment(root, definition, readiness) {
  if (definition.kubeContext || readiness.kubeContext) fail('Use a dedicated kubeconfig with the intended current context');
  id(definition.id);
  if (!['managed', 'existing'].includes(definition.mode)) fail('Environment mode must be managed or existing');
  if (!['kubernetes', 'docker-compose'].includes(definition.target)) fail('Unsupported environment target');
  if (!safe(definition.environment)) fail('Operations environment profile is required');
  if (definition.target === 'kubernetes' && (!definition.kubeconfigFile || !readiness.kubeconfigFile)) fail('A dedicated kubeconfig is required');
  if (definition.target === 'docker-compose' && (!definition.dockerContext || !readiness.dockerContext)) fail('An explicit Docker context is required');
  if (definition.target === 'kubernetes' && !['k3d', 'existing'].includes(definition.provisioner)) fail('Invalid Kubernetes provisioner');
  if (definition.mode === 'managed' && definition.provisioner !== 'k3d') fail('Only K3d creation is currently managed');
  if (definition.mode === 'existing' && definition.provisioner !== 'existing') fail('Existing environments must not provision infrastructure');
  if (readiness.status !== 'ready' || readiness.target !== definition.target || readiness.environment !== definition.environment) fail('Environment readiness does not match definition');
  if (!readiness.infrastructureId) fail('Prepare the environment with infrastructure identity before registration');
  if (definition.target === 'kubernetes' && resolve(definition.kubeconfigFile || '') !== resolve(readiness.kubeconfigFile || '')) fail('Kubeconfig mismatch');
  if (definition.clusterName && definition.clusterName !== readiness.clusterName) fail('Cluster name mismatch');
  if (definition.target === 'docker-compose' && definition.dockerContext !== readiness.dockerContext) fail('Docker context mismatch');
  noCredentials(definition);
  noCredentials(readiness);
  return create(fileFor(root, 'environments', definition.id), seal({schemaVersion: 1, kind: 'environment',
    id: definition.id, definition, readiness, workerHost: hostname(), registeredAt: new Date().toISOString()}));
}
export function getRecord(root, kind, key) {
  if (!['environments', 'deployments'].includes(kind)) fail('Unknown registry kind');
  return verify(read(fileFor(root, kind, key)));
}
export function deploymentConfiguration(root, declaration) {
  id(declaration.id);
  const environment = getRecord(root, 'environments', declaration.environmentId);
  const config = read(resolve(root, declaration.configFile));
  const prepared = environment.readiness;
  if (prepared.target === 'kubernetes' ? !safe(declaration.namespace) : !safe(declaration.composeProject)) fail('An isolated namespace or Compose project is required');
  if (config.target !== prepared.target || config.environment !== prepared.environment) fail('Deployment configuration target mismatch');
  const connection = prepared.target === 'kubernetes'
    ? {kubeconfigFile: prepared.kubeconfigFile, kubeContext: prepared.kubeContext, clusterName: prepared.clusterName, namespace: declaration.namespace}
    : {dockerContext: prepared.dockerContext, composeProject: declaration.composeProject};
  return {...config, ...connection, environmentId: environment.id, instanceId: declaration.id, infrastructureId: prepared.infrastructureId};
}
export function registerDeployment(root, declaration, manifest, execute = executeDefault) {
  id(declaration.id);
  const environment = getRecord(root, 'environments', declaration.environmentId);
  const target = environment.definition.target;
  if (manifest.status !== 'ready' || !manifest.deploymentId || manifest.target !== target
    || manifest.environment !== environment.definition.environment) fail('Deployment does not match environment');
  if (target === 'kubernetes' && (!safe(declaration.namespace) || declaration.namespace !== manifest.namespace
    || resolve(manifest.kubeconfigFile || '') !== resolve(environment.readiness.kubeconfigFile))) fail('Deployment namespace or cluster mismatch');
  if (target === 'docker-compose' && (!safe(declaration.composeProject) || declaration.composeProject !== manifest.composeProject
    || manifest.dockerContext !== environment.readiness.dockerContext)) fail('Compose project or context mismatch');
  if (manifest.infrastructureId && manifest.infrastructureId !== environment.readiness.infrastructureId) fail('Infrastructure identity mismatch');
  noCredentials(declaration);
  noCredentials(manifest);
  checkRunInfrastructure({environment}, execute);
  if (target === 'kubernetes') {
    const args = ['--kubeconfig', environment.readiness.kubeconfigFile];
    if (environment.readiness.kubeContext) args.push('--context', environment.readiness.kubeContext);
    const namespaceUid = JSON.parse(execute('kubectl', [...args, 'get', 'namespace', declaration.namespace, '-o', 'json'])).metadata?.uid;
    if (!namespaceUid) fail('Deployment namespace identity is missing');
    manifest = {...manifest, namespaceUid};
  }
  // Registration captures an observed instance, never a mutable pointer to a manifest file.
  return create(fileFor(root, 'deployments', declaration.id), seal({schemaVersion: 1, kind: 'deployment',
    id: declaration.id, environmentId: environment.id, environmentFingerprint: environment.fingerprint,
    declaration, manifest, registeredAt: new Date().toISOString()}));
}
export function createRun(root, runId, instanceId, artifacts = {}) {
  const deployment = getRecord(root, 'deployments', instanceId);
  const environment = getRecord(root, 'environments', deployment.environmentId);
  if (environment.fingerprint !== deployment.environmentFingerprint) fail('Environment was replaced');
  const selected = {};
  for (const [key, file] of Object.entries(artifacts)) {
    if (!['baseline', 'data', 'plan'].includes(key)) fail('Unsupported reusable artifact');
    const value = read(resolve(root, file));
    if (key !== 'plan' && (value.status !== 'ready' || value.deploymentId !== deployment.manifest.deploymentId
      || value.environment !== deployment.manifest.environment)) fail('Reusable data belongs to another deployment');
    selected[key] = value;
  }
  return create(resolve(root, 'simulation/reports/workflows', id(runId), 'run.json'), seal({schemaVersion: 1,
    kind: 'run', id: runId, environmentId: environment.id, instanceId, deploymentId: deployment.manifest.deploymentId,
    environment, deployment, artifacts: selected, createdAt: new Date().toISOString()}));
}
export function loadRun(root, runId) {
  const file = resolve(root, 'simulation/reports/workflows', id(runId), 'run.json');
  if (!existsSync(file)) return undefined;
  const run = verify(read(file));
  verify(run.environment); verify(run.deployment);
  if (run.id !== runId) fail('Run identifier mismatch');
  return run;
}
export function checkRunInfrastructure(run, execute = executeDefault) {
  if (run.environment.workerHost !== hostname()) fail('Run must execute on its registered worker host; use the SSH worker transport');
  const prepared = run.environment.readiness;
  let actual;
  if (prepared.target === 'kubernetes') {
    const args = ['--kubeconfig', prepared.kubeconfigFile];
    if (prepared.kubeContext) args.push('--context', prepared.kubeContext);
    execute('kubectl', [...args, 'get', '--raw=/readyz']);
    actual = JSON.parse(execute('kubectl', [...args, 'get', 'namespace', 'kube-system', '-o', 'json'])).metadata.uid;
    if (run.deployment?.manifest.namespaceUid) {
      const current = JSON.parse(execute('kubectl', [...args, 'get', 'namespace', run.deployment.manifest.namespace, '-o', 'json'])).metadata?.uid;
      if (current !== run.deployment.manifest.namespaceUid) fail('Deployment namespace was replaced; register a new instance');
    }
  } else {
    actual = JSON.parse(execute('docker', ['--context', prepared.dockerContext, 'info', '--format', '{{json .}}'])).ID;
  }
  if (!actual || actual !== prepared.infrastructureId) fail('Infrastructure identity changed; register the rebuilt environment and prepare fresh data');
}
export function listRecords(root, kind) {
  if (!['environments', 'deployments', 'runs'].includes(kind)) fail('Unknown registry kind');
  const dir = resolve(root, kind === 'runs' ? 'simulation/reports/workflows' : 'simulation/instances/' + kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => {
    const file = kind === 'runs' ? resolve(dir, name, 'run.json') : resolve(dir, name);
    if (!existsSync(file) || (kind !== 'runs' && !name.endsWith('.json'))) return [];
    const value = verify(read(file));
    return [{id: value.id, kind: value.kind, environmentId: value.environmentId,
      instanceId: value.instanceId, target: value.definition?.target || value.manifest?.target,
      namespace: value.manifest?.namespace, composeProject: value.manifest?.composeProject,
      status: value.manifest?.status || value.readiness?.status || 'bound', at: value.registeredAt || value.createdAt}];
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [action, first, second, ...rest] = process.argv.slice(2);
    const root = process.cwd();
    let result;
    if (action === 'register-environment' && first && second && !rest.length) result = registerEnvironment(root, read(first), read(second));
    else if (action === 'register-deployment' && first && second && !rest.length) result = registerDeployment(root, read(first), read(second));
    else if (action === 'create-run' && first && second) {
      const artifacts = {};
      while (rest.length) {
        const key = rest.shift(); const value = rest.shift();
        if (!['--baseline', '--data', '--plan'].includes(key) || !value || artifacts[key.slice(2)]) fail('Invalid artifact option');
        artifacts[key.slice(2)] = value;
      }
      result = createRun(root, first, second, artifacts);
    } else if (action === 'resolve-deployment' && first && second && !rest.length) result = create(resolve(second), deploymentConfiguration(root, read(first)));
    else if (action === 'list' && first && !second) result = listRecords(root, first);
    else if (action === 'show' && first && second && !rest.length) result = first === 'runs' ? loadRun(root, second) : getRecord(root, first, second);
    else if (action === 'check-run' && first && !second) {
      const run = loadRun(root, first);
      if (!run) fail('Run not found');
      checkRunInfrastructure(run); result = {id: first, status: 'connected'};
    } else fail('Usage: instance-registry.mjs register-environment <definition> <readiness> | resolve-deployment <declaration> <new-config> | register-deployment <declaration> <manifest> | create-run <runId> <instanceId> [--baseline file] [--data file] [--plan file] | list environments|deployments|runs | show <kind> <id> | check-run <runId>');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
