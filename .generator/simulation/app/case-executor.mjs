import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import {checkCases, checkApproval} from './case-design.mjs';

const at = (value, path) => path.split('.').filter(Boolean).reduce((v, key) => v?.[key], value);
export function resolveInputs(value, context) {
  if (Array.isArray(value)) return value.map(v => resolveInputs(v, context));
  if (!value || typeof value !== 'object') return value;
  if (Object.hasOwn(value, '$ref')) {
    const found = at(context, value.$ref);
    if (found === undefined) throw new Error(`Unresolved input reference: ${value.$ref}`);
    return structuredClone(found);
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveInputs(v, context)]));
}

export function validateDataManifest(data, environment) {
  if (environment.status !== 'ready') throw new Error('Deployment must be ready');
  if (data.schemaVersion !== 1) throw new Error('Unsupported data manifest schemaVersion');
  if (!environment.environment || !environment.deploymentId || data.environment !== environment.environment
    || data.deploymentId !== environment.deploymentId) throw new Error('Data belongs to a different or unidentified deployment');
  if (data.status !== 'ready' || !Array.isArray(data.records)) throw new Error('Data manifest must be ready with records');
}

export async function executeCases(plan, environment, data, adapter, options = {}) {
  const report = {runId: randomUUID(), status: 'running', cases: []};
  const save = () => options.record?.(structuredClone(report));
  try {
    if (!adapter.capabilities) throw new Error('Executor must declare capabilities');
    checkCases(plan, {model: options.model, capabilities: adapter.capabilities});
    checkApproval(plan);
    validateDataManifest(data, environment);
    if (typeof adapter.validateEnvironment !== 'function' || typeof adapter.validateData !== 'function') throw new Error('Executor requires live environment and data validators');
    if (typeof adapter.execute !== 'function') throw new Error('Executor requires execute');
    if (plan.cases.some(c => c.cleanupPolicy === 'cleanup') && typeof adapter.cleanup !== 'function') throw new Error('Cleanup is not supported by executor');
    if (plan.cases.some(c => c.assertions.some(a => a.type === 'event')) && typeof adapter.observe !== 'function') throw new Error('Event observation is not supported by executor');
    await adapter.validatePlan?.(plan);
    await adapter.validateEnvironment(environment);
    await adapter.validateData(data, environment);
    for (const item of plan.cases) {
      const result = {id: item.id, status: 'running', steps: [], assertions: []};
      report.cases.push(result);
      const context = {data, steps: {}};
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), item.timeoutMs);
      const bounded = async operation => {
        controller.signal.throwIfAborted();
        let onAbort;
        try {
          return await Promise.race([operation(), new Promise((_, reject) => {
            onAbort = () => reject(new Error('Case timed out'));
            controller.signal.addEventListener('abort', onAbort, {once: true});
          })]);
        } finally { controller.signal.removeEventListener('abort', onAbort); }
      };
      try {
        for (const step of item.steps) {
          const stepResult = {id: step.id, status: 'running'};
          result.steps.push(stepResult);
          save();
          const value = await bounded(() => adapter.execute(resolveInputs(step, context), {environment, context, signal: controller.signal}));
          // Rejections must be explicit business responses; transport errors fail the case.
          if (!value || !['ok', 'rejected'].includes(value.status)) throw new Error(`Invalid executor response: ${step.id}`);
          context.steps[step.id] = value;
          if (value.status === 'rejected' && !item.assertions.some(a => a.stepId === step.id && a.type === 'rejection')) throw new Error(`Unexpected rejection: ${step.id}`);
          for (const assertion of item.assertions.filter(a => a.stepId === step.id)) {
            const expected = resolveInputs(assertion, context);
            let passed;
            if (expected.type === 'rejection') passed = value.status === 'rejected' && value.reason === expected.reason;
            else if (expected.type === 'event') passed = await bounded(() => adapter.observe(expected, {environment, context, signal: controller.signal})) === true;
            else {
              const actual = at(value.body, expected.path);
              passed = expected.operator === 'exists' ? actual !== undefined && actual !== null
                : expected.operator === 'equals' ? isDeepStrictEqual(actual, expected.expected)
                : Array.isArray(actual) ? actual.some(v => isDeepStrictEqual(v, expected.expected))
                : typeof actual === 'string' && typeof expected.expected === 'string' && actual.includes(expected.expected);
            }
            result.assertions.push({stepId: step.id, type: expected.type, status: passed ? 'passed' : 'failed'});
            save();
            if (!passed) throw new Error(`Assertion failed: ${step.id}/${expected.type}`);
          }
          stepResult.status = 'passed';
        }
        result.status = 'passed';
      } catch (error) {
        result.status = 'failed';
        result.error = error.message;
        for (const step of result.steps) if (step.status === 'running') step.status = 'failed';
      } finally {
        clearTimeout(timer);
        controller.abort();
        if (item.cleanupPolicy === 'cleanup') {
          try { await adapter.cleanup({environment, context}); }
          catch { result.status = 'failed'; result.cleanupError = 'Cleanup failed'; }
        }
      }
      save();
      if (result.status !== 'passed') break;
    }
    for (const item of plan.cases.slice(report.cases.length)) report.cases.push({id: item.id, status: 'skipped'});
    report.status = report.cases.every(c => c.status === 'passed') ? 'passed' : 'failed';
  } catch (error) { report.status = 'failed'; report.error = error.message; }
  save();
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [plan, environment, data, adapterPath, output, model] = process.argv.slice(2);
    if (!output) throw new Error('Usage: execute-cases.mjs <cases> <environment> <data-manifest> <trusted-adapter.mjs> <new-report> [model]');
    const read = path => JSON.parse(readFileSync(path, 'utf8'));
    const inputs = {plan: read(plan), environment: read(environment), data: read(data), model: model ? read(model) : undefined};
    const adapter = (await import(pathToFileURL(resolve(adapterPath)).href)).default;
    mkdirSync(dirname(resolve(output)), {recursive: true});
    writeFileSync(output, JSON.stringify({status: 'running'}), {flag: 'wx', mode: 0o600});
    const report = await executeCases(inputs.plan, inputs.environment, inputs.data, adapter, {
      model: inputs.model,
      record: report => writeFileSync(output, JSON.stringify(report, null, 2))
    });
    if (report.status !== 'passed') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
