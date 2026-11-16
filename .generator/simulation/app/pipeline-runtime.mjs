import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const stages = ['environment', 'build', 'publish', 'deployment', 'case-design', 'data-preparation', 'test-execution', 'reporting'];
export const phases = ['validate', 'test', 'environment', 'build', 'publish', 'deploy', 'ready', 'deployment', 'case-design', 'seed', 'data-preparation', 'verify', 'test-execution', 'reporting'];
export function stageOf(step) {
  return step.stage || ({deploy: 'deployment', ready: 'deployment', seed: 'data-preparation', verify: 'test-execution'}[step.phase])
    || (stages.includes(step.phase) ? step.phase : undefined);
}

const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";

export function executionCommand(step, host, runId, environmentRef) {
  if (!host || host.transport === 'local') return step.command;
  if (host.transport !== 'ssh') throw new Error('Unsupported host transport');
  if (!/^[a-zA-Z0-9_.@-]+$/.test(host.target || '') || host.target.startsWith('-')) throw new Error('Invalid SSH target; use an SSH config alias');
  if (!host.workDir?.startsWith('/')) throw new Error('SSH workDir must be an absolute remote path');
  if (step.cwd?.startsWith('/') || step.cwd?.split('/').includes('..')) throw new Error('Remote step cwd must stay within workDir');
  const cwd = host.workDir + (step.cwd ? '/' + step.cwd : '');
  return ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', host.target,
    `cd ${quote(cwd)} && exec env MEDOL_PIPELINE_RUN_ID=${quote(runId)} ${environmentRef ? `MEDOL_ENVIRONMENT_MANIFEST=${quote(environmentRef)} ` : ''}${step.command.map(quote).join(' ')}`];
}

export function loadExistingEnvironment(config, root) {
  if (!config.existingEnvironment) return undefined;
  const {manifest, remoteManifestPaths = {}} = config.existingEnvironment;
  if (!remoteManifestPaths || typeof remoteManifestPaths !== 'object' || Array.isArray(remoteManifestPaths)) throw new Error('remoteManifestPaths must be a host-to-path object');
  if (typeof manifest !== 'string' || !manifest) throw new Error('existingEnvironment.manifest is required');
  const path = resolve(root, manifest);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data.status !== 'ready' || !data.environment || !data.target) throw new Error('Existing environment manifest must describe a ready environment');
  return {path, data, remoteManifestPaths};
}

export function planPipeline(catalog, config) {
  const services = new Map();
  for (const service of [...catalog.services, ...(config.services || [])]) {
    if (!service.name || services.has(service.name)) throw new Error(`Duplicate or missing service name: ${service.name}`);
    services.set(service.name, service);
  }
  for (const placement of config.placements || []) {
    if (!services.has(placement.service)) throw new Error(`Unknown service: ${placement.service}`);
    if (!config.hosts?.[placement.host]) throw new Error(`Unknown host: ${placement.host}`);
  }
  const seen = new Set();
  const steps = config.steps || [];
  for (const step of steps) {
    if (!step.id || seen.has(step.id)) throw new Error(`Duplicate or missing step id: ${step.id}`);
    seen.add(step.id);
    if (!phases.includes(step.phase)) throw new Error(`Unknown phase: ${step.phase}`);
    if (step.stage && !stages.includes(step.stage)) throw new Error(`Unknown stage: ${step.stage}`);
    if (!Array.isArray(step.command) || !step.command.length || step.command.some(v => typeof v !== 'string')) throw new Error(`command must be an argv array: ${step.id}`);
    if (step.host && !config.hosts?.[step.host]) throw new Error(`Unknown host: ${step.host}`);
    executionCommand(step, step.host ? config.hosts[step.host] : undefined, 'plan');
    if (step.service && !services.has(step.service)) throw new Error(`Unknown service: ${step.service}`);
    if (step.timeoutMs !== undefined && (!Number.isFinite(step.timeoutMs) || step.timeoutMs <= 0)) throw new Error(`Invalid timeout: ${step.id}`);
  }
  const ordered = phases.flatMap(phase => steps.filter(step => step.phase === phase));
  const result = [];
  const visiting = new Set();
  const added = new Set();
  const byId = new Map(steps.map(step => [step.id, step]));
  function visit(step) {
    if (added.has(step.id)) return;
    if (visiting.has(step.id)) throw new Error(`Cyclic dependency: ${step.id}`);
    visiting.add(step.id);
    if (step.dependsOn !== undefined && !Array.isArray(step.dependsOn)) throw new Error(`dependsOn must be an array: ${step.id}`);
    for (const id of step.dependsOn || []) {
      if (!byId.has(id)) throw new Error(`Unknown dependency: ${id}`);
      visit(byId.get(id));
    }
    visiting.delete(step.id);
    added.add(step.id);
    result.push({...step, ...(stageOf(step) ? {stage: stageOf(step)} : {})});
  }
  ordered.forEach(visit);
  for (const step of result) {
    if (stageOf(step) !== 'reporting' && (step.dependsOn || []).some(id => stageOf(byId.get(id)) === 'reporting')) {
      throw new Error(`Reporting must be terminal: ${step.id}`);
    }
  }
  return result;
}

export function runPipeline(catalog, config, options = {}) {
  const planned = planPipeline(catalog, config);
  const root = resolve(options.root || '.');
  const existing = loadExistingEnvironment(config, root);
  const byId = new Map(planned.map(step => [step.id, step]));
  if (options.stage && !stages.includes(options.stage)) throw new Error(`Unknown stage: ${options.stage}`);
  const steps = (options.stage ? planned.filter(step => stageOf(step) === options.stage) : planned)
    .filter(step => !existing || !['environment', 'deployment'].includes(stageOf(step)));
  if (options.stage) {
    const selected = new Set(steps.map(step => step.id));
    const reused = new Set(config.reuseCompletedSteps || []);
    if (existing) for (const step of planned) {
      if (stageOf(step) === 'environment' || (stageOf(step) === 'deployment' && existing.data.deploymentId)) reused.add(step.id);
    }
    for (const step of steps) for (const id of step.dependsOn || []) {
      if (!selected.has(id) && !reused.has(id)) throw new Error(`Stage requires ${id}; run the full pipeline or explicitly declare reuseCompletedSteps after verifying its artifacts`);
    }
  }
  if (existing) for (const step of steps) {
    if (['data-preparation', 'test-execution'].includes(stageOf(step)) && !existing.data.deploymentId) throw new Error('Data preparation and test execution require a ready deployment instance, not just infrastructure');
    for (const id of step.dependsOn || []) {
      if (stageOf(byId.get(id)) === 'deployment' && !existing.data.deploymentId) throw new Error('An environment-only manifest cannot satisfy a deployment dependency; provide a ready deployment instance');
    }
    const remotePath = existing.remoteManifestPaths[step.host];
    if (config.hosts?.[step.host]?.transport === 'ssh' && (typeof remotePath !== 'string' || !remotePath.startsWith('/'))) {
      throw new Error(`Existing environment requires an absolute remoteManifestPaths entry for host ${step.host}`);
    }
  }
  if (!steps.length) throw new Error('No pipeline steps configured for the requested stage.');
  if (options.plan) return { status: 'planned', steps };
  if (!steps.length) throw new Error('No pipeline steps configured.');
  const runId = randomUUID();
  const reportDir = resolve(options.reportRoot || resolve(root, 'simulation/reports'), runId);
  mkdirSync(reportDir, { recursive: true });
  const report = { runId, status: 'running', startedAt: new Date().toISOString(), steps: [],
    ...(existing ? {existingEnvironment: {manifest: existing.path, deploymentId: existing.data.deploymentId, environment: existing.data.environment}} : {}) };
  const save = () => writeFileSync(resolve(reportDir, 'report.json'), JSON.stringify(report, null, 2));
  save();
  for (const step of steps) {
    if (report.status === 'failed' && stageOf(step) !== 'reporting') {
      report.steps.push({id: step.id, phase: step.phase, stage: stageOf(step), status: 'skipped', reason: 'Earlier step failed'});
      save();
      continue;
    }
    const host = step.host ? config.hosts[step.host] : undefined;
    const environmentRef = existing && (host?.transport === 'ssh' ? existing.remoteManifestPaths[step.host] : existing.path);
    const command = executionCommand(step, host, runId, environmentRef);
    const result = spawnSync(command[0], command.slice(1), {
      cwd: host?.transport === 'ssh' ? root : resolve(root, step.cwd || '.'), stdio: 'inherit',
      env: { ...process.env, MEDOL_PIPELINE_RUN_ID: runId, ...(environmentRef ? {MEDOL_ENVIRONMENT_MANIFEST: environmentRef} : {}) },
      timeout: step.timeoutMs || 1800000
    });
    report.steps.push({ id: step.id, phase: step.phase, stage: stageOf(step), status: result.status === 0 && !result.error ? 'passed' : 'failed', exitCode: result.status, signal: result.signal, error: result.error?.message });
    save();
    if (result.status !== 0 || result.error) report.status = 'failed';
  }
  if (report.status === 'running') report.status = 'passed';
  report.finishedAt = new Date().toISOString();
  save();
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, configPath] = process.argv.slice(2);
    if (!['plan', 'run'].includes(action) || !configPath) throw new Error('Run from the project root: node simulation/src/pipeline.mjs plan|run simulation/pipelines/pipeline.json');
    const root = process.cwd();
    const catalog = JSON.parse(readFileSync(resolve(root, 'operations/model/services.json'), 'utf8'));
    const config = JSON.parse(readFileSync(resolve(configPath), 'utf8'));
    const reportRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../reports');
    const result = runPipeline(catalog, config, { root, reportRoot, plan: action === 'plan' });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'failed') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
