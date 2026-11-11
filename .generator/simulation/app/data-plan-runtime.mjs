import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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
  return { status: 'passed', count: results.length, results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [planPath, environmentPath] = process.argv.slice(2);
    if (!planPath || !environmentPath) throw new Error('Usage: node src/data-plan.mjs scenarios/seed.json environments/test.json');
    const read = path => JSON.parse(readFileSync(path, 'utf8'));
    const result = await seedData(read(planPath), read(environmentPath), {
      headers: JSON.parse(process.env.BUSINESS_HEADERS || '{}')
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
