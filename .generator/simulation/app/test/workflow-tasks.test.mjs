import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {approveCases} from '../case-design.mjs';
import {prepareWorkflow} from '../workflow-tasks.mjs';

const plan = approveCases({schemaVersion:2,cases:[{id:'prepare-record',title:'Prepare record',status:'draft',origin:'manual',reviewIssues:[],prerequisites:[],dataRequirements:[],cleanupPolicy:'retain',timeoutMs:1000,assertions:[],steps:[{id:'record',type:'assert',value:{id:{$ref:'data.inputs.id'}},assertions:[{type:'query',path:'id',operator:'exists'}]}],exports:{id:{$ref:'steps.record.body.id'}}}]},'test');
const environment = {status:'ready',environment:'test',deploymentId:'deployment',endpoints:{service:'http://service.test'}};
const config = {endpoints:{service:{anonymous:true}},probes:[{endpoint:'service',path:'/health',expect:{status:'UP'}}]};
test('preparation binds reviewed exports to deployment and selected requirements', async t => {
  const directory = mkdtempSync(join(tmpdir(),'workflow-preparation-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  t.mock.method(globalThis,'fetch',async()=>({ok:true,status:200,json:async()=>({status:'UP'})}));
  const cases = structuredClone(plan); delete cases.cases[0].approval;
  cases.cases[0].dataRequirements=[{id:'record'}];
  const selected = approveCases(cases,'test');
  const result = await prepareWorkflow({environment,workflow:plan,cases:selected,inputs:{id:'existing-id'},config,fulfillments:{'prepare-record':{record:'prepare-record'}}},{directory});
  assert.equal(result.mode,'case'); assert.equal(result.status,'ready');
  assert.deepEqual(result.records,[{id:'existing-id'}]);
  assert.equal(result.deploymentId,'deployment');
  assert.deepEqual(result.caseIds,['prepare-record']);
  assert.ok(result.casePlanFingerprint);
  assert.equal(result.preparationReport.status,'passed');
});
test('stale approvals and unmapped data needs reject before any request', async t => {
  const fetcher = t.mock.method(globalThis,'fetch',()=>{throw new Error('unexpected I/O');});
  const changed = structuredClone(plan); changed.cases[0].title='Changed';
  await assert.rejects(prepareWorkflow({environment,workflow:changed,config},{}),/stale/);
  const cases = structuredClone(plan); cases.cases[0].dataRequirements=[{id:'required'}];
  await assert.rejects(prepareWorkflow({environment,workflow:plan,cases:approveCases(cases,'test'),config},{}),/Missing preparation/);
  assert.equal(fetcher.mock.callCount(),0);
});
