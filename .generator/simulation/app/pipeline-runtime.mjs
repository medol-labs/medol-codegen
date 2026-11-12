import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const phases = ['validate', 'test', 'build', 'publish', 'deploy', 'ready', 'seed', 'verify'];

const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";

export function executionCommand(step, host, runId) {
  if (!host || host.transport === 'local') return step.command;
  if (host.transport !== 'ssh') throw new Error('Unsupported host transport');
  if (!/^[a-zA-Z0-9_.@-]+$/.test(host.target || '') || host.target.startsWith('-')) throw new Error('Invalid SSH target; use an SSH config alias');
  if (!host.workDir?.startsWith('/')) throw new Error('SSH workDir must be an absolute remote path');
  if (step.cwd?.startsWith('/') || step.cwd?.split('/').includes('..')) throw new Error('Remote step cwd must stay within workDir');
  const cwd = host.workDir + (step.cwd ? '/' + step.cwd : '');
  return ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', host.target,
    `cd ${quote(cwd)} && exec env MEDOL_PIPELINE_RUN_ID=${quote(runId)} ${step.command.map(quote).join(' ')}`];
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
    if (!Array.isArray(step.command) || !step.command.length || step.command.some(v => typeof v !== 'string')) throw new Error(`command must be an argv array: ${step.id}`);
    if (step.host && !config.hosts?.[step.host]) throw new Error(`Unknown host: ${step.host}`);
    executionCommand(step, step.host ? config.hosts[step.host] : undefined, 'plan');
    if (step.service && !services.has(step.service)) throw new Error(`Unknown service: ${step.service}`);
    if (step.timeoutMs !== undefined && (!Number.isFinite(step.timeoutMs) || step.timeoutMs <= 0)) throw new Error(`Invalid timeout: ${step.id}`);
  }
  return phases.flatMap(phase => steps.filter(step => step.phase === phase));
}

export function runPipeline(catalog, config, options = {}) {
  const steps = planPipeline(catalog, config);
  if (options.plan) return { status: 'planned', steps };
  if (!steps.length) throw new Error('No pipeline steps configured.');
  const root = resolve(options.root || '.');
  const runId = randomUUID();
  const reportDir = resolve(options.reportRoot || resolve(root, 'simulation/reports'), runId);
  mkdirSync(reportDir, { recursive: true });
  const report = { runId, status: 'running', startedAt: new Date().toISOString(), steps: [] };
  const save = () => writeFileSync(resolve(reportDir, 'report.json'), JSON.stringify(report, null, 2));
  save();
  for (const step of steps) {
    const host = step.host ? config.hosts[step.host] : undefined;
    const command = executionCommand(step, host, runId);
    const result = spawnSync(command[0], command.slice(1), {
      cwd: host?.transport === 'ssh' ? root : resolve(root, step.cwd || '.'), stdio: 'inherit',
      env: { ...process.env, MEDOL_PIPELINE_RUN_ID: runId },
      timeout: step.timeoutMs || 1800000
    });
    report.steps.push({ id: step.id, phase: step.phase, exitCode: result.status, signal: result.signal, error: result.error?.message });
    save();
    if (result.status !== 0 || result.error) { report.status = 'failed'; break; }
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
