import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedData, validateDataPlan } from '../data-plan-runtime.mjs';
import { draftCases } from '../case-design.mjs';
import { planPipeline, runPipeline } from '../pipeline-runtime.mjs';

test('command operations honor their configured timeout instead of a ten-second probe cap', async t => {
  const durations = [];
  const original = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', ms => { durations.push(ms); return original(ms); });
  await seedData({steps: [{id: 'long-command', kind: 'command', operation: 'Initialize', timeoutMs: 600000}]}, {}, {
    adapter: {operations: {Initialize: {kind: 'command', execute: async () => ({ready: true})}}}
  });
  assert(durations[0] > 590000 && durations[0] <= 600000);
});

test('custom services merge, collisions and unknown placements fail', () => {
  const catalog = { services: [{ name: 'api' }] };
  assert.throws(() => planPipeline(catalog, { services: [{ name: 'api' }] }), /Duplicate/);
  assert.throws(() => planPipeline(catalog, { placements: [{ service: 'missing' }] }), /Unknown service/);
  const steps = planPipeline(catalog, { services: [{ name: 'worker', source: 'custom' }], steps: [
    { id: 'deploy', phase: 'deploy', command: ['true'], service: 'worker' },
    { id: 'build', phase: 'build', command: ['true'] }
  ] });
  assert.deepEqual(steps.map(step => step.id), ['build', 'deploy']);
});

test('pipeline stops on failure and writes a run report', () => {
  const root = mkdtempSync(join(tmpdir(), 'delivery-test-'));
  try {
    const report = runPipeline({ services: [] }, { steps: [
      { id: 'fail', phase: 'test', command: [process.execPath, '-e', 'process.exit(2)'] },
      { id: 'never', phase: 'build', command: [process.execPath, '-e', 'process.exit(0)'] }
    ] }, { root });
    assert.equal(report.status, 'failed');
    assert.equal(report.steps.length, 2);
    assert.equal(report.steps[0].status, 'failed');
    assert.equal(report.steps[1].status, 'skipped');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('seed plan repeats with stable distinct IDs and waits for projections', async () => {
  const plan = { count: 2, steps: [
    { id: 'create', kind: 'command', endpoint: 'api', path: '/create', body: { id: { $uuid: 'entity' } } },
    { id: 'ready', kind: 'wait', endpoint: 'api', path: '/query', expect: { path: 'ready', equals: true } },
    { id: 'use', kind: 'command', endpoint: 'api', path: '/use', body: { id: { $ref: 'steps.create.request.id' } } }
  ] };
  const environment = { endpoints: { api: 'http://example.test/api' } };
  const options = { fetch: async () => new Response(JSON.stringify({ ready: true })) };
  const first = await seedData(plan, environment, options);
  assert.deepEqual(first, await seedData(plan, environment, options));
  assert.notEqual(first.results[0].steps.create.request.id, first.results[1].steps.create.request.id);
  assert.equal(first.results[0].steps.use.request.id, first.results[0].steps.create.request.id);
});

test('command failure is not retried', async () => {
  let calls = 0;
  await assert.rejects(seedData({ steps: [{ id: 'create', kind: 'command', endpoint: 'api', path: '/create' }] },
    { endpoints: { api: 'http://example.test' } },
    { fetch: async () => { calls++; return new Response('', { status: 400 }); } }), /HTTP 400/);
  assert.equal(calls, 1);
});

test('baseline data is independent and exports a minimal prepared manifest', async () => {
  const result = await seedData({steps: [{id: 'create', kind: 'command', endpoint: 'api', path: '/create', body: {id: 'entity'}}],
    exports: {id: {$ref: 'steps.create.request.id'}}}, {environment: 'dev', deploymentId: 'one', endpoints: {api: 'http://example.test'}},
    {fetch: async () => new Response(JSON.stringify({secret: 'not-exported'}))});
  assert.equal(result.manifest.mode, 'baseline');
  assert.equal(result.manifest.status, 'prepared');
  assert.deepEqual(result.manifest.records, [{id: 'entity'}]);
  assert.ok(!JSON.stringify(result.manifest).includes('not-exported'));
});

test('case data requires approved cases and explicit requirement mappings', () => {
  const casePlan = draftCases({scenarios: [{id: 'sample', steps: [{command: 'Create', expectedEvents: ['Created']}]}]});
  const plan = {mode: 'case', caseIds: ['sample'], steps: [{id: 'prepare'}]};
  assert.throws(() => validateDataPlan(plan), /Unknown data case/);
  assert.throws(() => validateDataPlan(plan, {casePlan}), /approval/);
  Object.assign(casePlan.cases[0], {status: 'approved', reviewIssues: [], dataRequirements: [{id: 'entities'}]});
  assert.throws(() => validateDataPlan(plan, {casePlan}), /Unmapped/);
  plan.fulfillments = {sample: {entities: ['missing']}};
  assert.throws(() => validateDataPlan(plan, {casePlan}), /step IDs/);
  plan.fulfillments.sample.entities = ['prepare'];
  assert.equal(validateDataPlan(plan, {casePlan}), 'case');
});

test('case plans can consume an existing baseline without executing its initialization', async () => {
  const environment = {environment: 'test', deploymentId: 'deployment', endpoints: {api: 'http://example.test'}};
  const baseline = {mode: 'baseline', status: 'ready', environment: 'test', deploymentId: 'deployment', records: [{catalogId: 'existing'}]};
  const casePlan = {schemaVersion: 2, cases: [{id: 'case', title: 'Case', origin: 'manual', status: 'approved', reviewIssues: [], prerequisites: [], dataRequirements: [{id: 'entity'}], timeoutMs: 1000, cleanupPolicy: 'retain', steps: [{id: 'verify', type: 'query', query: 'Get'}], assertions: [{type: 'query', stepId: 'verify', path: 'ok', operator: 'equals', expected: true}]}]};
  const plan = {mode: 'case', requiresBaseline: true, caseIds: ['case'], fulfillments: {case: {entity: ['create']}}, steps: [{id: 'create', kind: 'command', endpoint: 'api', path: '/case', body: {catalogId: {$ref: 'baseline.records.0.catalogId'}}}], exports: {catalogId: {$ref: 'baseline.records.0.catalogId'}}};
  let calls = 0;
  const options = {casePlan, baseline, fetch: async (_url, request) => { calls++; assert.equal(JSON.parse(request.body).catalogId, 'existing'); return new Response('{}'); }};
  const result = await seedData(plan, environment, options);
  assert.equal(calls, 1);
  assert.equal(result.manifest.mode, 'case');
  assert.ok(result.manifest.baselineFingerprint);
  await assert.rejects(seedData(plan, environment, {...options, baseline: undefined}), /baseline/);
  await assert.rejects(seedData(plan, environment, {...options, baseline: {...baseline, deploymentId: 'other'}}), /different/);
  assert.equal(calls, 1);
});
