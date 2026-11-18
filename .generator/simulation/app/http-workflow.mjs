import {executeCases} from './case-executor.mjs';
import {createHttpExecutor} from './http-case-executor.mjs';

export async function runHttpWorkflow(plan, environment, inputs, config, options) {
  const data = {schemaVersion:1, status:'ready', environment:environment.environment, deploymentId:environment.deploymentId, records:[], inputs};
  const report = await executeCases(plan, environment, data, createHttpExecutor(config, options));
  if (report.status !== 'passed') throw new Error(report.error || report.cases.find(c => c.status === 'failed')?.error || 'Workflow failed');
  return report;
}
