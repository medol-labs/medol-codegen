import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHttpExecutor} from '../http-case-executor.mjs';
import {approveCases} from '../case-design.mjs';
import {executeCases} from '../case-executor.mjs';
import {createHash} from 'node:crypto';

const environment = {status: 'ready', environment: 'test', deploymentId: 'one', endpoints: {api: 'http://test.invalid/api'}};
const data = {...environment, schemaVersion: 1, records: [{ids: ['a', 'b']}]};
const config = {endpoints: {api: {bearerTokenEnv: 'TEST_TOKEN'}}, probes: [{endpoint: 'api', path: '/health'}]};

test('inline multipart sends the actual bytes and text responses retain their media type', async () => {
  const executor = createHttpExecutor(config, {env: {TEST_TOKEN: 'secret'}, fetchImpl: async (_, options) => {
    const request = new Request('http://test.invalid', options);
    assert.match(request.headers.get('content-type'), /^multipart\/form-data; boundary=/);
    const form = await request.formData();
    assert.equal(form.get('note'), 'fixture');
    assert.equal(form.get('part').name, 'sample.txt');
    assert.equal(await form.get('part').text(), 'sample\n');
    return new Response('count\n1\n', {headers: {'content-type': 'text/csv'}});
  }});
  const result = await executor.execute({type: 'command', request: {endpoint: 'api', path: '/files',
    body: {note: 'fixture'}, multipart: [{name: 'part', filename: 'sample.txt', text: 'sample\n'}],
    responseType: 'text'}}, {environment});
  assert.deepEqual(result.body, {text: 'count\n1\n', contentType: 'text/csv'});
});
const fixture = () => approveCases({schemaVersion: 2, cases: [{id: 'flow', title: 'Flow', origin: 'manual', status: 'draft', reviewIssues: [], prerequisites: [], dataRequirements: [], timeoutMs: 1000, cleanupPolicy: 'retain', assertions: [],
  variables: {id: {$uuid: true}}, steps: [{id: 'each', type: 'foreach', items: {$ref: 'data.records.0.ids'}, as: 'entity',
    steps: [{id: 'post', type: 'command', command: 'CreateEntity', request: {endpoint: 'api', path: '/entities', body: {id: {$ref: 'entity'}}}},
      {id: 'get', type: 'query', query: 'Entities', request: {endpoint: 'api', path: '/entities', query: {'id.equals': {$ref: 'entity'}}, expect: {id: {$ref: 'entity'}}, pollIntervalMs: 1}, assertions: [{type: 'query', path: 'id', operator: 'equals', expected: {$ref: 'entity'}}]}],
    exports: {id: {$ref: 'steps.get.body.id'}}, assertions: [{type: 'query', path: 'items.length', operator: 'equals', expected: 2}]}]}]}, 'test');

test('configuration runs ordered requests and nested loops with isolated iteration results', async () => {
  const calls = [], seen = new Set();
  const adapter = createHttpExecutor(config, {env: {TEST_TOKEN: 'secret'}, fetchImpl: async (url, options) => {
    calls.push([url.href, options.method]);
    assert.equal(options.headers.Authorization, 'Bearer secret');
    assert.equal(options.redirect, 'error');
    const id = url.searchParams.get('id.equals');
    let body = options.method === 'POST' ? JSON.parse(options.body) : {id};
    if (id && !seen.has(id)) {seen.add(id);body = {};}
    return {ok: true, status: 200, json: async () => body};
  }});
  const result = await executeCases(fixture(), environment, data, adapter);
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(calls.filter(c => c[1] === 'POST').length, 2);
  assert.equal(result.cases[0].steps[0].iterations.length, 2);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('invalid paths and unknown endpoints fail before command side effects', async () => {
  let calls = 0;
  const adapter = createHttpExecutor(config, {env: {TEST_TOKEN: 'secret'}, fetchImpl: async () => {calls++; throw Error('unexpected');}});
  const plan = fixture(); plan.cases[0].steps[0].steps[0].request.path = '//evil.invalid';
  const result = await executeCases(approveCases(plan, 'test'), environment, data, adapter);
  assert.equal(result.status, 'failed'); assert.equal(calls, 0);
});

test('401 is not retried and command response is never fabricated', async () => {
  const adapter = createHttpExecutor(config, {env: {TEST_TOKEN: 'secret'}, fetchImpl: async () => ({ok: false, status: 401})});
  await assert.rejects(adapter.execute({type: 'command', request: {endpoint: 'api', path: '/entities', body: {id: 'a'}}}, {environment}), /401/);
});

test('commands may explicitly ignore an empty success body but not an HTTP failure', async () => {
  let status = 202;
  const adapter = createHttpExecutor(config, {env: {TEST_TOKEN: 'secret'}, fetchImpl: async () => new Response(null, {status})});
  const step = {type: 'command', request: {endpoint:'api', path:'/entities', ignoreResponseBody:true}};
  assert.deepEqual(await adapter.execute(step, {environment}), {status:'ok', httpStatus:202, body:null});
  status = 400;
  await assert.rejects(adapter.execute(step, {environment}), /400/);
});

test('artifact download checks digest and blocks other origins before sending credentials', async () => {
  let calls = 0;
  const content = Buffer.from('artifact'), digest = createHash('sha256').update(content).digest('hex');
  const adapter = createHttpExecutor(config, {env: {TEST_TOKEN: 'secret'}, fetchImpl: async () => {calls++; return {ok: true, body: (async function*(){yield content;})()};}});
  const step = {type: 'query', request: {endpoint: 'api', path: '/', download: {url: 'http://test.invalid/api/file', digest}}};
  assert.equal((await adapter.execute(step, {environment})).body.verified, true);
  step.request.download.url = 'http://other.invalid/file';
  await assert.rejects(adapter.execute(step, {environment}), /escapes/);
  assert.equal(calls, 1);
});
