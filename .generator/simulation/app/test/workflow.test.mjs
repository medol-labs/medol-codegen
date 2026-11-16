import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planPipeline, runPipeline} from '../pipeline-runtime.mjs';
import {draftCases, checkCases, importCases, compareCases, aiContext, newCase} from '../case-design.mjs';

const catalog = {services: []};
test('build and publish are independently selectable stages', () => {
  const config = {steps: [step('build', 'build'), step('publish', 'publish', ['build'])]};
  assert.equal(runPipeline(catalog, config, {plan: true, stage: 'build'}).steps[0].id, 'build');
  assert.throws(() => runPipeline(catalog, config, {plan: true, stage: 'publish'}), /requires build/);
  assert.equal(runPipeline(catalog, {...config, reuseCompletedSteps: ['build']}, {plan: true, stage: 'publish'}).steps[0].id, 'publish');
});

test('failure skips business steps but still collects results without masking failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'pipeline-report-'));
  try {
    const result = runPipeline(catalog, {steps: [
      {id: 'build', phase: 'build', command: [process.execPath, '-e', 'process.exit(1)']},
      {id: 'deploy', phase: 'deployment', dependsOn: ['build'], command: [process.execPath, '-e', 'process.exit(0)']},
      {id: 'report', phase: 'reporting', dependsOn: ['deploy'], command: [process.execPath, '-e', 'process.exit(0)']}
    ]}, {root});
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.steps.map(s => s.status), ['failed', 'skipped', 'passed']);
    assert.equal(JSON.parse(readFileSync(join(root, 'simulation/reports', result.runId, 'report.json'))).status, 'failed');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('report collection failure fails pipeline and cannot be a business prerequisite', () => {
  assert.throws(() => planPipeline(catalog, {steps: [step('report', 'reporting'), step('deploy', 'deployment', ['report'])]}), /terminal/);
  const root = mkdtempSync(join(tmpdir(), 'pipeline-report-'));
  try {
    assert.equal(runPipeline(catalog, {steps: [{id: 'report', phase: 'reporting', command: [process.execPath, '-e', 'process.exit(1)']}]}, {root}).status, 'failed');
  } finally { rmSync(root, {recursive: true, force: true}); }
});
const step = (id, phase, dependsOn = []) => ({id, phase, dependsOn, command: ['node', '--version']});
const config = {steps: [step('execute', 'test-execution', ['data']), step('data', 'data-preparation', ['deploy', 'cases']),
  step('cases', 'case-design'), step('deploy', 'deployment', ['environment']), step('environment', 'environment')]};

test('five stages order explicit dependencies without imposing deployment on case design', () => {
  const plan = planPipeline(catalog, config);
  assert.ok(plan.findIndex(s => s.id === 'cases') < plan.findIndex(s => s.id === 'data'));
  assert.ok(plan.findIndex(s => s.id === 'deploy') < plan.findIndex(s => s.id === 'data'));
  assert.deepEqual(runPipeline(catalog, config, {plan: true, stage: 'case-design'}).steps.map(s => s.id), ['cases']);
  assert.throws(() => runPipeline(catalog, config, {plan: true, stage: 'test-execution'}), /requires data/);
  assert.equal(runPipeline(catalog, {...config, reuseCompletedSteps: ['data']}, {plan: true, stage: 'test-execution'}).steps.length, 1);
});
test('invalid dependencies fail before commands execute', () => {
  assert.throws(() => planPipeline(catalog, {steps: [step('a', 'environment', ['missing'])]}), /Unknown dependency/);
  assert.throws(() => planPipeline(catalog, {steps: [step('a', 'environment', ['b']), step('b', 'deployment', ['a'])]}), /Cyclic/);
});
test('model candidates are drafts, not automatically approved or passed tests', () => {
  const plan = draftCases({scenarios: [{id: 'sample', name: 'Sample', steps: [{command: 'Create'}]}]});
  assert.throws(() => checkCases(plan), /approval/);
  Object.assign(plan.cases[0], {status: 'approved', reviewIssues: [], assertions: [{type: 'event', stepId: 'step-1', event: 'Created'}]});
  assert.deepEqual(checkCases(plan), {status: 'approved', caseCount: 1});
});

test('model expectations, AI and manual cases share a reviewed contract', () => {
  const model = {scenarios: [{id: 'create', kind: 'SPECIFICATION', steps: [{command: 'Create', expectedEvents: ['Created']}]}]};
  const plan = draftCases(model);
  assert.equal(plan.cases[0].assertions[0].basis, 'specification');
  Object.assign(plan.cases[0], {status: 'approved', reviewIssues: []});
  assert.equal(checkCases(plan, {model}).status, 'approved');
  const imported = importCases(plan, 'ai');
  assert.equal(imported.cases[0].origin, 'ai');
  assert.throws(() => checkCases(imported), /approval/);
  assert.equal(plan.cases[0].status, 'approved');
  assert.equal(aiContext(model).candidates.cases.length, 1);
  assert.equal(checkCases({schemaVersion: 2, cases: [newCase('manual')]}, {draft: true}).status, 'draft-valid');
  model.scenarios[0].steps[0].expectedEvents = ['Other'];
  assert.throws(() => checkCases(plan, {model}), /Model changed/);
  assert.equal(compareCases(plan, model).changed.length, 1);
  assert.equal(plan.cases[0].assertions[0].event, 'Created');
});

test('invalid references and unsupported executor capabilities are rejected', () => {
  const plan = draftCases({scenarios: [{id: 'create', steps: [{command: 'Create', expectedRejection: {reason: 'Invalid'}}]}]});
  Object.assign(plan.cases[0], {status: 'approved', reviewIssues: []});
  assert.throws(() => checkCases(plan, {capabilities: {steps: [], assertions: []}}), /Unsupported executor step/);
  assert.throws(() => checkCases(plan, {capabilities: {steps: ['command'], assertions: []}}), /Unsupported executor assertion/);
  plan.cases[0].assertions[0].stepId = 'missing';
  assert.throws(() => checkCases(plan), /step reference/);
});
