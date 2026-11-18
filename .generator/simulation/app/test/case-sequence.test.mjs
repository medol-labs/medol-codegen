import test from 'node:test';
import assert from 'node:assert/strict';
import {runCaseSequence} from '../case-sequence.mjs';

test('result adapters are explicit, run before later input resolution and are checked before dispatch', async () => {
  const sequence=[{case:'one',endpoint:'api',inputs:{},onResult:'capture'},{case:'two',endpoint:'api',inputs:{$ref:'seed.id'}}];
  const context={seed:{}}, calls=[];
  const execute=async(id,endpoint,inputs)=>{calls.push(id);return id==='one'?{id:42}:inputs;};
  await assert.rejects(runCaseSequence(sequence,context,execute),/Unknown result adapter/);
  assert.deepEqual(calls,[]);
  const result=await runCaseSequence(sequence,context,execute,{capture:({id})=>{context.seed.id=id;}});
  assert.equal(result.two,42);
});

test('configuration controls order, conditions and references to earlier exports', async () => {
  const calls = [];
  const execute = async (id, endpoint, input) => {calls.push(id); return input;};
  const first = {case:'first',endpoint:'api',inputs:{id:42}};
  const second = {case:'second',endpoint:'api',inputs:{id:{$ref:'outputs.first.id'}}};
  const skipped = {case:'disabled',endpoint:'api',when:false};
  assert.deepEqual((await runCaseSequence([first,skipped,second],{},execute)).second,{id:42});
  assert.deepEqual(calls,['first','second']);
  await assert.rejects(runCaseSequence([second,first],{},execute),/Unresolved input reference/);
});
