import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {approveCases, newCase, selectCases, checkCases, loadCaseLibrary} from '../case-design.mjs';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {executeCases} from '../case-executor.mjs';

const library = () => approveCases({schemaVersion: 2, cases: ['a', 'b', 'c'].map(id => ({
  ...newCase(id), tags: id === 'c' ? ['slow'] : ['smoke'], suites: ['core'],
  reviewIssues: [], steps: [{id: 'read', type: 'query', query: 'Read'}],
  assertions: [{type: 'query', stepId: 'read', path: 'ok', operator: 'equals', expected: true}]
}))}, 'reviewer');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('catalog rejects duplicate ids, unreviewed edits and paths outside approved files', t => {
  const root = mkdtempSync(join(tmpdir(), 'case-catalog-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const dir = join(root,'simulation/cases/approved'); mkdirSync(dir,{recursive:true});
  const source = library(), put = () => writeFileSync(join(dir,'scenario.json'),JSON.stringify(source));
  const load = (...scenarioFiles) => loadCaseLibrary({schemaVersion:1,scenarioFiles},root);
  put();
  assert.equal(load('scenario.json').cases.length,3);
  assert.throws(()=>load('scenario.json','scenario.json'),/duplicate/);
  assert.throws(()=>load('../scenario.json'),/filename/);
  source.cases[0].environmentRequirements = [{path:'workers',minItems:2}]; put();
  assert.throws(()=>load('scenario.json'),/stale/);
});

test('reused approved plan checks current manifest before any adapter call', async()=>{
  const source = library();
  source.cases[0].environmentRequirements = [{path:'resources.workers',minItems:2}];
  const plan = selectCases(approveCases(source,'review'),{ids:['a']});
  const environment = {deploymentId:'d',environment:'local',status:'ready',resources:{workers:[{}]}};
  const data = {...environment,schemaVersion:1,records:[],casePlanFingerprint:digest(plan)};
  const report = await executeCases(plan,environment,data,{capabilities:{steps:['query'],assertions:['query']}});
  assert.equal(report.status,'failed');
  assert.match(report.error,/resources.workers.*found 1/);
});

test('selection intersects dimensions, preserves order and case approvals', () => {
  const plan = selectCases(library(), {ids: ['c', 'a', 'b'], tags: ['smoke'], suites: ['core'], excludeIds: ['b']});
  assert.deepEqual(plan.cases.map(c => c.id), ['a']);
  assert.equal(checkCases(plan).caseCount, 1);
  plan.cases[0].title = 'changed';
  assert.throws(() => checkCases(plan), /fingerprint/);
});
test('invalid, empty and unapproved selections fail closed', () => {
  assert.throws(() => selectCases(library(), {ids: ['missing']}), /Unknown/);
  assert.throws(() => selectCases(library(), {tags: ['absent']}), /no cases/);
  assert.throws(() => selectCases(library(), {ids: []}), /nonempty/);
  assert.throws(() => selectCases(library(), {tag: ['smoke']}), /Unknown/);
  const draft = library();
  draft.cases[0].status = 'draft';
  assert.throws(() => selectCases(draft, {ids: ['a']}), /approval/);
  assert.equal(selectCases(draft, {ids: ['b']}).cases.length, 1);
});
test('failed retry excludes skipped cases and refuses changed versions', () => {
  const source = library();
  const report = {cases: [{id: 'a', status: 'failed'}, {id: 'b', status: 'skipped'}],
    caseFingerprints: Object.fromEntries(source.cases.map(c => [c.id, digest(c)]))};
  assert.deepEqual(selectCases(source, {failedReport: 'previous.json'}, report).cases.map(c => c.id), ['a']);
  source.cases[0].title = 'edited';
  assert.throws(() => selectCases(source, {failedReport: 'previous.json'}, report), /changed/);
});
test('execution requires data for the exact selected plan and emits retry evidence', async () => {
  const plan = selectCases(library(), {ids: ['b']});
  const environment = {status: 'ready', environment: 'test', deploymentId: 'deployment'};
  const data = {...environment, schemaVersion: 1, records: [], casePlanFingerprint: digest(plan)};
  let calls = 0;
  const adapter = {capabilities: {steps: ['query'], assertions: ['query']},
    validateEnvironment: async () => {}, validateData: async () => {},
    execute: async () => { calls++; return {status: 'ok', body: {ok: true}}; }};
  assert.equal((await executeCases(plan, environment, {...data, casePlanFingerprint: 'other'}, adapter)).status, 'failed');
  assert.equal(calls, 0);
  const report = await executeCases(plan, environment, data, adapter);
  assert.equal(report.status, 'passed');
  assert.equal(calls, 1);
  assert.equal(report.caseFingerprints.b, digest(plan.cases[0]));
});
