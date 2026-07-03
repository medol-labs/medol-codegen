#!/usr/bin/env node

import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const modelPath = resolve(process.cwd(), args.model ?? 'codegen-model.json');

if (!existsSync(modelPath)) {
    fail(`Cannot find ${modelPath}. Run this script from the generated backend root or pass --model.`);
}

if (typeof fetch !== 'function') {
    fail('This script requires Node.js 18 or newer because it uses global fetch.');
}

const model = JSON.parse(await readFile(modelPath, 'utf8'));
const count = positiveInt(args.count, 1);
const mode = args.mode ?? 'minimal';
const dryRun = Boolean(args['dry-run']);
const strict = Boolean(args.strict);
const deployments = selectedDeployments(model, args.deployment);
const valueTypes = collectValueTypes(model);
const idPool = new Map();
let posted = 0;
let failed = 0;

for (const deployment of deployments) {
    const baseUrl = deploymentBaseUrl(deployment, deployments);
    const slices = slicesForDeployment(model, deployment);
    const commandPlans = commandPlansFor(model, slices, mode);

    if (commandPlans.length === 0) {
        console.log(`[seed] ${deployment.name}: no commands selected for mode=${mode}`);
        continue;
    }

    console.log(`[seed] ${deployment.name}: ${commandPlans.length} command route(s), baseUrl=${baseUrl}`);

    for (let index = 1; index <= count; index += 1) {
        for (const plan of commandPlans) {
            const payload = payloadFor(plan.command.fields ?? [], index, valueTypes, idPool);
            const url = `${baseUrl}${plan.path}`;
            if (dryRun) {
                console.log(`DRY ${plan.label} -> ${url}`);
                console.log(JSON.stringify(payload, null, 2));
                continue;
            }
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {'content-type': 'application/json'},
                    body: JSON.stringify(payload)
                });
                const body = await response.text();
                if (!response.ok) {
                    failed += 1;
                    console.warn(`[seed] ${response.status} ${plan.label}: ${compact(body)}`);
                    if (strict) process.exitCode = 1;
                    if (strict) break;
                    continue;
                }
                posted += 1;
                console.log(`[seed] OK ${plan.label}`);
            } catch (error) {
                failed += 1;
                console.warn(`[seed] ERROR ${plan.label}: ${errorSummary(error)}`);
                if (strict) process.exitCode = 1;
                if (strict) break;
            }
        }
        if (strict && process.exitCode) break;
    }
}

if (dryRun) {
    console.log('[seed] dry run complete');
} else {
    console.log(`[seed] complete: posted=${posted}, failed=${failed}`);
}

function parseArgs(argv) {
    const result = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            result[key] = true;
        } else {
            result[key] = next;
            i += 1;
        }
    }
    return result;
}

function positiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function selectedDeployments(model, selectedName) {
    const configured = (model.deployments ?? []).map((deployment, index) => ({
        ...deployment,
        index,
        name: deployment.name ?? deployment.title ?? `deployment-${index + 1}`
    }));
    const deployments = configured.length > 0
        ? configured
        : [{name: model.deployment ?? model.domain ?? 'application', title: model.domain ?? 'Application', contexts: [], index: 0}];
    if (!selectedName) return deployments;
    const selected = deployments.filter((deployment) =>
        sameName(deployment.name, selectedName) || sameName(deployment.title, selectedName)
    );
    if (selected.length === 0) {
        fail(`Unknown deployment "${selectedName}". Available: ${deployments.map((item) => item.name).join(', ')}`);
    }
    return selected;
}

function deploymentBaseUrl(deployment, deployments) {
    const keys = [
        `${envName(deployment.name)}_URL`,
        `${envName(deployment.title)}_URL`,
        'AXON_API_URL'
    ];
    for (const key of keys) {
        if (process.env[key]) return trimSlash(process.env[key]);
    }
    return `http://localhost:${8080 + (deployment.index ?? deployments.indexOf(deployment))}`;
}

function slicesForDeployment(model, deployment) {
    const allSlices = collectSlices(model);
    const contexts = new Set((deployment.contexts ?? []).map((context) => context.name ?? context.title));
    if (contexts.size === 0) return allSlices;
    return allSlices.filter((slice) => contexts.has(slice.context ?? slice.chapter));
}

function collectSlices(model) {
    const slices = [];
    const seen = new Set();
    const add = (slice, contextName) => {
        if (!slice || seen.has(slice.id ?? slice.name)) return;
        seen.add(slice.id ?? slice.name);
        slices.push({...slice, context: slice.context ?? slice.chapter ?? contextName});
    };
    for (const slice of model.slices ?? []) add(slice);
    for (const domain of model.domains ?? []) {
        for (const context of domain.contexts ?? []) {
            for (const slice of context.slices ?? []) add(slice, context.name);
        }
    }
    for (const context of model.contexts ?? []) {
        for (const slice of context.slices ?? []) add(slice, context.name);
    }
    return slices;
}

function commandPlansFor(model, slices, mode) {
    const transitions = model.transitions ?? [];
    const plans = [];
    for (const slice of slices) {
        const concept = (slice.concepts ?? [slice.name])[0] ?? slice.name;
        for (const command of slice.commands ?? []) {
            const transition = transitions.find((candidate) =>
                candidate.command?.id === command.id || candidate.command?.name === command.name
            );
            const lifecycle = Boolean(command.startsLifecycle || slice.startsLifecycle || transition?.startsLifecycle);
            const commandName = command.title ?? command.name;
            const path = `/${routeSegment(concept)}/${routeSegment(commandName)}`;
            if (mode !== 'workflow' && !lifecycle) continue;
            plans.push({
                slice,
                command,
                lifecycle,
                path,
                label: `${slice.title ?? slice.name} / ${commandName}`
            });
        }
    }
    return plans.sort((left, right) => Number(!left.lifecycle) - Number(!right.lifecycle));
}

function payloadFor(fields, index, valueTypes, idPool) {
    const payload = {};
    for (const field of fields) {
        payload[field.name] = valueForField(field, index, valueTypes, idPool);
    }
    return payload;
}

function valueForField(field, index, valueTypes, idPool) {
    if (field.cardinality === 'Multiple') {
        return [valueForField({...field, cardinality: 'Single'}, index, valueTypes, idPool)];
    }

    const typeName = String(field.type ?? 'String');
    const valueType = valueTypes.get(typeName) ?? valueTypes.get(typeName.split('.').pop());
    if (valueType?.kind === 'enum') return enumValue(valueType);
    if (valueType?.kind === 'object') return payloadFor(valueType.fields ?? [], index, valueTypes, idPool);
    if (valueType?.baseType) {
        return scalarValue(field.name, valueType.baseType, index, idPool, valueType);
    }

    return scalarValue(field.name, typeName, index, idPool);
}

function scalarValue(name, type, index, idPool, valueType) {
    const lowerName = String(name ?? '').toLowerCase();
    const lowerType = String(type ?? 'string').toLowerCase();

    if (lowerType === 'uuid' || lowerName.endsWith('id')) {
        return stableId(name, index, idPool);
    }
    if (['int', 'integer', 'long'].includes(lowerType)) {
        if (lowerName.includes('minimum') || lowerName.includes('count')) return Math.max(2, index + 1);
        return index;
    }
    if (['float', 'double', 'number', 'decimal', 'bigdecimal'].includes(lowerType)) return index + 0.5;
    if (lowerType === 'boolean') return true;
    if (lowerType === 'date') return `2026-07-${String(Math.min(28, index)).padStart(2, '0')}`;
    if (lowerType === 'datetime' || lowerType === 'localdatetime') {
        return `2026-07-${String(Math.min(28, index)).padStart(2, '0')}T09:00:00`;
    }

    if (lowerName.includes('email')) return `demo${index}@example.test`;
    if (lowerName.includes('url') || lowerName.includes('endpoint')) return `https://example.test/${kebab(name)}-${index}`;
    if (lowerName.includes('region')) return 'us-east-1';
    if (lowerName.includes('status') || lowerName.includes('state')) return 'Active';
    if (lowerName.includes('description')) return `Demo ${humanize(name)} ${index}`;
    if (valueType?.constraints?.some((constraint) => constraint.kind === 'format' && constraint.format === 'email')) {
        return `demo${index}@example.test`;
    }
    return `Demo ${humanize(name)} ${index}`;
}

function collectValueTypes(model) {
    const result = new Map();
    const add = (valueType) => {
        if (!valueType?.name) return;
        const existing = result.get(valueType.name);
        if (existing && detailScore(existing) > detailScore(valueType)) return;
        result.set(valueType.name, valueType);
    };
    for (const valueType of model.valueTypes ?? []) add(valueType);
    for (const domain of model.domains ?? []) {
        for (const context of domain.contexts ?? []) {
            for (const valueType of context.valueTypes ?? []) add(valueType);
        }
    }
    for (const context of model.contexts ?? []) {
        for (const valueType of context.valueTypes ?? []) add(valueType);
    }
    return result;
}

function detailScore(valueType) {
    return (valueType.fields?.length ?? 0) + (valueType.values?.length ?? 0) + (valueType.baseType ? 1 : 0);
}

function enumValue(valueType) {
    const first = valueType.values?.[0] ?? valueType.options?.[0] ?? 'Demo';
    return String(first).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
}

function stableId(name, index, idPool) {
    const key = `${name}:${index}`;
    if (!idPool.has(key)) idPool.set(key, randomUUID());
    return idPool.get(key);
}

function envName(value) {
    return String(value ?? 'application')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
}

function routeSegment(value) {
    return String(value ?? '').replace(/[\s_-]+/g, '').toLowerCase();
}

function sameName(left, right) {
    return routeSegment(left) === routeSegment(right);
}

function trimSlash(value) {
    return String(value).replace(/\/+$/, '');
}

function compact(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function errorSummary(error) {
    const cause = error?.cause;
    const details = [cause?.code, cause?.address, cause?.port, cause?.message].filter(Boolean).join(' ');
    return details ? `${error.message} (${details})` : error.message;
}

function kebab(value) {
    return String(value ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

function humanize(value) {
    return String(value ?? 'value')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[^A-Za-z0-9]+/g, ' ')
        .trim()
        .toLowerCase();
}

function fail(message) {
    console.error(`[seed] ${message}`);
    process.exit(1);
}
