import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createHttpExecutor} from './http-case-executor.mjs';
import {seedData, validateDataPlan, validateBaselineManifest} from './data-plan-runtime.mjs';
import {checkApproval, checkCases} from './case-design.mjs';

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function prepareData(mode, plan, environment, options = {}) {
    if (mode === 'case' && options.casePlan?.execution) {
        checkCases(options.casePlan);
        checkApproval(options.casePlan);
        plan = {...plan, caseIds: options.casePlan.cases.map(item => item.id)};
    }
    if (!['baseline', 'case'].includes(mode) || plan.mode !== mode) throw new Error('Explicit baseline/case mode must match the data plan');
    if (environment.status !== 'ready' || !environment.environment || !environment.deploymentId) throw new Error('A ready deployment manifest is required');
    if (mode === 'baseline' && (options.baseline || options.casePlan || plan.requiresBaseline)) throw new Error('Baseline initialization must be independent of cases and baseline inputs');
    const effectivePlan = mode === 'case' ? {...plan, requiresBaseline: plan.requiresBaseline !== false} : plan;
    validateDataPlan(effectivePlan, options);
    if (mode === 'case') {
        checkApproval({cases: options.casePlan.cases.filter(item => plan.caseIds.includes(item.id))});
        if (effectivePlan.requiresBaseline || options.baseline) validateBaselineManifest(options.baseline, environment);
    }
    if (!plan.steps.some(step => step.kind === 'wait')) throw new Error('Data preparation requires an explicit readiness wait');
    // Validate operation support before invoking any project hook.
    for (const step of plan.steps) {
        if (step.operation && (options.adapter?.operations?.[step.operation]?.kind !== step.kind
            || typeof options.adapter.operations[step.operation].execute !== 'function')) throw new Error(`Unsupported adapter operation: ${step.operation}`);
    }
    try {
        await options.adapter?.validateEnvironment?.(environment);
        if (options.baseline) await options.adapter?.validateBaseline?.(options.baseline, environment);
        const result = await seedData(effectivePlan, environment, options);
        return {...result.manifest,
            ...(mode === 'case' ? {casePlanFingerprint: fingerprint(options.casePlan)} : {})};
    } finally { await options.adapter?.cleanup?.(); }
}

export function parseArguments(args) {
    const [mode, ...rest] = args;
    if (!['baseline', 'case'].includes(mode)) throw new Error('Usage: prepare-data.mjs baseline|case --plan <file> --environment <deployment> --output <file> [--baseline <file>] [--cases <file>] [--adapter <module>]');
    const values = {mode};
    while (rest.length) {
        const key = rest.shift();
        if (!['--plan', '--environment', '--output', '--baseline', '--cases', '--adapter'].includes(key) || Object.hasOwn(values, key.slice(2))) throw new Error(`Invalid or duplicate argument: ${key}`);
        const value = rest.shift();
        if (!value || value.startsWith('--')) throw new Error(`Missing value: ${key}`);
        values[key.slice(2)] = value;
    }
    values.environment ||= process.env.MEDOL_ENVIRONMENT_MANIFEST;
    if (mode === 'case') values.baseline ||= process.env.MEDOL_BASELINE_DATA_MANIFEST;
    if (!values.plan || !values.environment || !values.output) throw new Error('plan, environment and output are required');
    if (mode === 'case' && !values.cases) throw new Error('Case preparation requires --cases');
    if (mode === 'baseline' && (values.baseline || values.cases)) throw new Error('Baseline preparation does not accept case/baseline inputs');
    return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const args = parseArguments(process.argv.slice(2));
        if (existsSync(args.output)) throw new Error('Output already exists; choose a new manifest path');
        const read = file => JSON.parse(readFileSync(file, 'utf8'));
        const plan = read(args.plan), environment = read(args.environment);
        const adapter = args.adapter ? (args.adapter.endsWith('.json') ? createHttpExecutor(read(args.adapter)) : (await import(pathToFileURL(resolve(args.adapter)).href)).default) : undefined;
        const result = await prepareData(args.mode, plan, environment, {
            adapter, casePlan: args.cases ? read(args.cases) : undefined,
            baseline: args.baseline ? read(args.baseline) : undefined,
            headers: JSON.parse(process.env.BUSINESS_HEADERS || '{}')
        });
        mkdirSync(dirname(resolve(args.output)), {recursive: true});
        writeFileSync(args.output, JSON.stringify(result, null, 2) + '\n', {flag: 'wx', mode: 0o600});
        console.log(`Prepared ${args.mode} data: ${args.output}`);
    } catch (error) {
        // Adapter errors may include credentials; don't persist or echo their raw text.
        console.error('Data preparation failed. No new ready manifest was produced. Validate inputs and inspect trusted adapter diagnostics.');
        process.exitCode = 1;
    }
}
