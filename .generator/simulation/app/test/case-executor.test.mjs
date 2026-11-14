import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executeCases, resolveInputs} from '../case-executor.mjs';
import {newCase, approveCases} from '../case-design.mjs';

const environment = {status: 'ready', environment: 'test', deploymentId: 'one'};
const data = {...environment, schemaVersion: 1, status: 'ready', records: [{id: 'existing'}]};
const plan = () => approveCases({schemaVersion: 2, cases: [{...newCase('read'), status: 'approved', reviewIssues: [],
  steps: [{id: 'read', type: 'query', query: 'Lookup', input: {id: {$ref: 'data.records.0.id'}}}],
  assertions: [{type: 'query', stepId: 'read', path: 'id', operator: 'equals', expected: 'existing'}]}]}, 'test');
const adapter = () => ({capabilities: {steps: ['query'], assertions: ['query']},
  validateEnvironment: async () => {}, validateData: async () => {},
  execute: async step => ({status: 'ok', body: {id: step.input.id}})});

test('approved case executes with existing data and records assertions', async () => {
  const reports = [];
  const report = await executeCases(plan(), environment, data, adapter(), {record: r => reports.push(r)});
  assert.equal(report.status, 'passed');
  assert.equal(report.cases[0].assertions[0].status, 'passed');
  assert.ok(reports.length >= 2);
});
test('wrong deployment and unsupported executors cause no command execution', async () => {
  const a = adapter();
  a.execute = () => assert.fail('must not execute');
  assert.match((await executeCases(plan(), environment, {...data, deploymentId: 'other'}, a)).error, /deployment/);
  a.capabilities.steps = [];
  assert.match((await executeCases(plan(), environment, data, a)).error, /Unsupported/);
});
test('failed assertions fail the run and skip subsequent cases', async () => {
  const p = plan();
  p.cases.push({...p.cases[0], id: 'later'});
  const a = adapter();
  a.execute = async () => ({status: 'ok', body: {id: 'wrong'}});
  const report = await executeCases(approveCases(p, 'test'), environment, data, a);
  assert.equal(report.status, 'failed');
  assert.equal(report.cases[0].assertions[0].status, 'failed');
  assert.equal(report.cases[1].status, 'skipped');
});
test('unresolved inputs and case timeouts fail instead of silently passing', async () => {
  assert.throws(() => resolveInputs({$ref: 'missing'}, {}), /Unresolved/);
  const p = plan();
  p.cases[0].timeoutMs = 10;
  const a = adapter();
  a.execute = () => new Promise(() => {});
  const report = await executeCases(approveCases(p, 'test'), environment, data, a);
  assert.equal(report.cases[0].error, 'Case timed out');
});
test('missing observed events cannot pass', async () => {
  const p = plan();
  p.cases[0].assertions = [{type: 'event', stepId: 'read', event: 'Created'}];
  const a = adapter();
  a.capabilities.assertions = ['event'];
  a.observe = async () => false;
  assert.equal((await executeCases(approveCases(p, 'test'), environment, data, a)).status, 'failed');
});
test('editing an approved case invalidates approval before any execution', async () => {
  const p = plan();
  p.cases[0].title = 'Changed';
  assert.match((await executeCases(p, environment, data, adapter())).error, /stale/);
});
test('unready deployment and unsupported data format are rejected before I/O', async () => {
  const a = adapter();
  a.validateEnvironment = () => assert.fail('must not connect');
  assert.match((await executeCases(plan(), {...environment, status: 'failed'}, data, a)).error, /Deployment must be ready/);
  assert.match((await executeCases(plan(), environment, {...data, schemaVersion: 9}, a)).error, /schemaVersion/);
});
