import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { checkCases } from './case-design.mjs';

export function validateDataPlan(plan, options = {}) {
  const mode = plan.mode ?? 'baseline';
  if (!['baseline', 'case'].includes(mode)) throw new Error('Data mode must be baseline or case');
  if (!Array.isArray(plan.steps) || !plan.steps.length) throw new Error('Data plan requires steps');
  if (mode === 'case') {
    if (!Array.isArray(plan.caseIds) || !plan.caseIds.length) throw new Error('Case data requires caseIds');
    const selected = plan.caseIds.map(id => {
      const item = options.casePlan?.cases?.find(c => c.id === id);
      if (!item) throw new Error(`Unknown data case: ${id}`);
      return item;
    });
    checkCases({schemaVersion: options.casePlan.schemaVersion, cases: selected}, {model: options.model});
    for (const item of selected) for (const requirement of item.dataRequirements) {
      if (!requirement.id || !plan.fulfillments?.[item.id]?.[requirement.id]?.length) {
        throw new Error(`Unmapped data requirement: ${item.id}/${requirement.id}`);
      }
      const steps = plan.fulfillments[item.id][requirement.id];
      if (!Array.isArray(steps) || steps.some(id => !plan.steps.some(s => s.id === id))) throw new Error('Data fulfillment must reference plan step IDs');
    }
  }
  return mode;
}

function materialize(value, context) {
  if (Array.isArray(value)) return value.map(item => materialize(item, context));
  if (!value || typeof value !== 'object') return value;
  if (Object.hasOwn(value, '$ref')) {
    let result = context;
    for (const part of value.$ref.split('.')) result = result?.[part];
    if (result === undefined) throw new Error(`Unresolved reference: ${value.$ref}`);
    return result;
  }
  if (Object.hasOwn(value, '$uuid')) {
    const hex = createHash('sha256').update(`${context.seed}:${context.index}:${value.$uuid}`).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materialize(item, context)]));
}

export async function seedData(plan, environment, options = {}) {
  const mode = validateDataPlan(plan, options);
  const count = plan.count ?? 1;
  if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');
  const ids = new Set();
  for (const step of plan.steps || []) {
    if (!step.id || ids.has(step.id)) throw new Error('Step ids must be unique');
    ids.add(step.id);
    if (!['command', 'wait'].includes(step.kind)) throw new Error(`Unknown step kind: ${step.kind}`);
    if (!environment.endpoints?.[step.endpoint]) throw new Error(`Missing endpoint: ${step.endpoint}`);
    if (step.kind === 'wait' && !step.expect) throw new Error('wait requires expect');
  }
  const results = [];
  for (let index = 0; index < count; index++) {
    const context = { seed: plan.seed ?? 1001, index, variables: plan.variables || {}, steps: {} };
    for (const step of plan.steps || []) {
      const request = materialize(step, context);
      const base = environment.endpoints[step.endpoint].replace(/\/$/, '');
      if (!request.path?.startsWith('/') || request.path.startsWith('//')) throw new Error('path must be relative to its configured endpoint');
      const url = base + request.path;
      const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
      const deadline = Date.now() + (step.timeoutMs ?? 30000);
      while (true) {
        const response = await (options.fetch || fetch)(url, {
          method: step.kind === 'wait' ? 'GET' : 'POST', headers,
          body: step.kind === 'command' ? JSON.stringify(request.body) : undefined,
          signal: AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now())))
        });
        if (!response.ok) throw new Error(`${step.id}: HTTP ${response.status}`);
        const text = await response.text();
        const body = text ? JSON.parse(text) : null;
        if (step.kind === 'command') {
          context.steps[step.id] = { request: request.body, response: body };
          break;
        }
        let actual = body;
        for (const part of request.expect.path.split('.').filter(Boolean)) actual = actual?.[part];
        if (JSON.stringify(actual) === JSON.stringify(request.expect.equals)) {
          context.steps[step.id] = { response: body };
          break;
        }
        if (Date.now() >= deadline) throw new Error(`${step.id}: projection wait timed out`);
        await new Promise(done => setTimeout(done, Math.min(step.pollIntervalMs ?? 500, Math.max(1, deadline - Date.now()))));
      }
    }
    results.push(context);
  }
  const manifest = {schemaVersion: 1, mode, environment: environment.environment,
    deploymentId: environment.deploymentId, seed: plan.seed ?? 1001,
    caseIds: mode === 'case' ? plan.caseIds : [],
    planFingerprint: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
    status: plan.steps.some(s => s.kind === 'wait') ? 'ready' : 'prepared',
    records: results.map(context => materialize(plan.exports || {}, context)),
    readinessChecks: plan.steps.filter(s => s.kind === 'wait').map(s => s.id)};
  return { status: 'passed', count: results.length, results, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [planPath, suppliedEnvironment, outputPath, casePlanPath] = process.argv.slice(2);
    const environmentPath = suppliedEnvironment || process.env.MEDOL_ENVIRONMENT_MANIFEST;
    if (!planPath || !environmentPath) throw new Error('Usage: node src/data-plan.mjs <plan> <environment> [output-manifest] [approved-case-plan]');
    if (outputPath && existsSync(outputPath)) throw new Error('Data manifest already exists; use a new output path');
    const read = path => JSON.parse(readFileSync(path, 'utf8'));
    const environment = read(environmentPath);
    if (outputPath && (!environment.environment || !environment.deploymentId)) throw new Error('Persisted data requires environment and deploymentId');
    const result = await seedData(read(planPath), environment, {
      casePlan: casePlanPath ? read(casePlanPath) : undefined,
      headers: JSON.parse(process.env.BUSINESS_HEADERS || '{}')
    });
    if (outputPath) {
      mkdirSync(dirname(resolve(outputPath)), {recursive: true});
      writeFileSync(outputPath, JSON.stringify(result.manifest, null, 2), {flag: 'wx'});
    }
    console.log(JSON.stringify(result.manifest, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
