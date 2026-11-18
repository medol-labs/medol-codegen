import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {selectCases, checkCases, checkApproval, checkCaseEnvironment, loadCaseLibrary} from './case-design.mjs';
import {createHttpExecutor} from './http-case-executor.mjs';
import {executeCases} from './case-executor.mjs';
import {prepareData} from './prepare-data-entry.mjs';
import {createHash} from 'node:crypto';
import {validateBaselineManifest} from './data-plan-runtime.mjs';

export function select({library, selection, environment}, {root = '.'}) {
  const plan = selectCases(loadCaseLibrary(library, root), selection, selection.failedReport
    ? JSON.parse(readFileSync(resolve(root, selection.failedReport), 'utf8')) : undefined);
  if (environment) checkCaseEnvironment(plan, environment);
  return plan;
}

export function test({environment, data, cases, config}, {directory}) {
  return executeCases(cases, environment, data, createHttpExecutor(config), {
    record: report => writeFileSync(resolve(directory, 'case-progress.json'), JSON.stringify(report, null, 2), {mode: 0o600}),
  });
}

// A self-contained case needs a bound data manifest, not project-specific fixture creation.
export function prepareWithoutFixtures(environment, baseline, cases) {
  validateBaselineManifest(baseline, environment);
  checkCases(cases); checkApproval(cases); checkCaseEnvironment(cases, environment);
  if (cases.cases.some(item => item.dataRequirements.length)) return undefined;
  return {schemaVersion: 1, mode: 'case', status: 'ready', environment: environment.environment,
    deploymentId: environment.deploymentId, caseIds: cases.cases.map(item => item.id),
    casePlanFingerprint: createHash('sha256').update(JSON.stringify(cases)).digest('hex'), records: []};
}

export function prepare({environment, plan, baseline, cases, config}) {
  return prepareData(plan.mode, plan, environment, {baseline, casePlan: cases, adapter: createHttpExecutor(config)});
}

// Reviewed preparation workflows use the same executor, but produce data evidence,
// never a test verdict for the selected business cases.
export async function prepareWorkflow({environment, workflow, baseline, cases, config, inputs = {}, fulfillments}, {directory}) {
  if (baseline) validateBaselineManifest(baseline, environment);
  checkCases(workflow); checkApproval(workflow);
  if (cases) {
    checkCases(cases); checkApproval(cases);
    for (const item of cases.cases) for (const requirement of item.dataRequirements) {
      const provider = fulfillments?.[item.id]?.[requirement.id];
      if (!provider || !workflow.cases.some(c => c.id === provider && c.exports)) throw new Error(`Missing preparation workflow for ${item.id}/${requirement.id}`);
    }
  }
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const input = {schemaVersion: 1, status: 'ready', environment: environment.environment,
    deploymentId: environment.deploymentId, records: baseline?.records || [], inputs, casePlanFingerprint: hash(workflow)};
  const report = await executeCases(workflow, environment, input, createHttpExecutor(config), {
    record: value => writeFileSync(resolve(directory, 'preparation-progress.json'), JSON.stringify(value, null, 2), {mode: 0o600}),
  });
  if (report.status !== 'passed') return {status: 'failed', report};
  return {schemaVersion: 1, mode: cases ? 'case' : 'baseline', status: 'ready',
    environment: environment.environment, deploymentId: environment.deploymentId,
    records: report.cases.map(item => item.exports || {}),
    ...(cases ? {casePlanFingerprint: hash(cases), caseIds: cases.cases.map(c => c.id)} : {}),
    preparationPlanFingerprint: hash(workflow), preparationReport: report};
}
