import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareData, parseArguments} from '../prepare-data-entry.mjs';
import {approveCases} from '../case-design.mjs';

const environment = {status: 'ready', environment: 'test', deploymentId: 'one', endpoints: {api: 'http://example.test'}};
const ready = {id: 'ready', kind: 'wait', endpoint: 'api', path: '/ready', expect: {path: 'ok', equals: true}};
const baseline = {mode: 'baseline', status: 'ready', environment: 'test', deploymentId: 'one', records: [{id: 'shared'}]};
const cases = () => approveCases({schemaVersion: 2, cases: [{id: 'case', title: 'Case', origin: 'manual', status: 'draft', reviewIssues: [], prerequisites: [], dataRequirements: [{id: 'entity'}], timeoutMs: 1000, cleanupPolicy: 'retain', steps: [{id: 'verify', type: 'query', query: 'Get'}], assertions: [{type: 'query', stepId: 'verify', path: 'ok', operator: 'equals', expected: true}]}]}, 'reviewer');
const casePlan = () => ({mode: 'case', caseIds: ['case'], fulfillments: {case: {entity: ['create']}}, steps: [
  {id: 'create', kind: 'command', endpoint: 'api', path: '/case', body: {id: {$ref: 'baseline.records.0.id'}}}, ready
], exports: {id: {$ref: 'baseline.records.0.id'}}});

test('baseline preparation works independently of test cases', async () => {
  const result = await prepareData('baseline', {mode: 'baseline', steps: [ready]}, environment,
    {fetch: async () => new Response('{"ok":true}')});
  assert.equal(result.status, 'ready');
  assert.equal(result.mode, 'baseline');
});

test('case preparation reuses existing baseline without initialization', async () => {
  const paths = [];
  const result = await prepareData('case', casePlan(), environment, {baseline, casePlan: cases(), fetch: async (url, request) => {
    paths.push(url);
    if (request.method === 'POST') assert.deepEqual(JSON.parse(request.body), {id: 'shared'});
    return new Response('{"ok":true}');
  }});
  assert.deepEqual(paths, ['http://example.test/case', 'http://example.test/ready']);
  assert.deepEqual(result.records, [{id: 'shared'}]);
  assert.ok(result.baselineFingerprint);
  assert.ok(result.casePlanFingerprint);
});

test('invalid baseline and stale approval fail before requests', async () => {
  let calls = 0;
  const options = {casePlan: cases(), fetch: async () => {calls++; throw new Error('unexpected');}};
  await assert.rejects(prepareData('case', casePlan(), environment, options), /baseline/);
  await assert.rejects(prepareData('case', casePlan(), environment, {...options, baseline: {...baseline, deploymentId: 'other'}}), /different/);
  options.casePlan.cases[0].title = 'changed';
  await assert.rejects(prepareData('case', casePlan(), environment, {...options, baseline}), /stale/);
  assert.equal(calls, 0);
});

test('declared adapters support generic operations and cleanup on failure', async () => {
  let cleaned = 0;
  const adapter = {operations: {check: {kind: 'wait', execute: async () => ({ok: true})}}, cleanup: async () => {cleaned++;}};
  const plan = {mode: 'baseline', steps: [{...ready, operation: 'check'}]};
  assert.equal((await prepareData('baseline', plan, environment, {adapter})).status, 'ready');
  adapter.operations.check.execute = async () => {throw new Error('failed');};
  await assert.rejects(prepareData('baseline', plan, environment, {adapter}), /failed/);
  assert.equal(cleaned, 2);
  await assert.rejects(prepareData('baseline', plan, environment), /Unsupported/);
});

test('strict entry requires readiness, matching mode and separate CLI inputs', async () => {
  await assert.rejects(prepareData('baseline', {mode: 'baseline', steps: [{id: 'create', kind: 'command'}]}, environment), /readiness/);
  await assert.rejects(prepareData('case', {mode: 'baseline'}, environment), /match/);
  assert.equal(parseArguments(['baseline', '--plan', 'plan', '--environment', 'env', '--output', 'out']).mode, 'baseline');
  assert.throws(() => parseArguments(['baseline', '--plan', 'plan', '--environment', 'env', '--output', 'out', '--cases', 'cases']), /does not accept/);
  assert.throws(() => parseArguments(['case', '--plan', 'plan', '--environment', 'env', '--output', 'out']), /--cases/);
});
