import {mkdirSync, writeFileSync, renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

export const deploymentSteps = ['validateConnection', 'prepareImages', 'deploy', 'waitDeploymentReady'];

export function workloadPatches(services, instances) {
    if (!instances?.length) throw new Error('Explicit instances are required');
    const selected = new Map(instances.map(item => [item.service, item.replicas]));
    if (selected.size !== instances.length) throw new Error('Duplicate instance configuration');
    for (const [name, replicas] of selected) {
        if (!services.includes(name) || !Number.isInteger(replicas) || replicas < 0) throw new Error(`Invalid instance: ${name}`);
    }
    return services.flatMap(name => selected.has(name)
        ? [{patch: JSON.stringify({apiVersion: 'apps/v1', kind: 'Deployment', metadata: {name}, spec: {replicas: selected.get(name)}})}]
        : ['Deployment', 'Service'].map(kind => ({patch: JSON.stringify({apiVersion: kind === 'Deployment' ? 'apps/v1' : 'v1', kind, metadata: {name}, $patch: 'delete'})})));
}

export function planDeployment(config, catalog = {services: []}) {
    if (!Array.isArray(config.instances) || !config.instances.length) throw new Error('Explicit instances are required');
    if (!config.target || !config.environment) throw new Error('target and environment are required');
    if (!['linux/arm64', 'linux/amd64'].includes(config.platform)) throw new Error('Unsupported platform');
    if (config.computeNodes !== undefined && (!Number.isInteger(config.computeNodes) || config.computeNodes < 1)) {
        throw new Error('computeNodes must be a positive integer');
    }
    const known = new Set();
    for (const service of [...catalog.services, ...(config.externalServices || [])]) {
        if (!service.name || known.has(service.name)) throw new Error('Duplicate or missing service name');
        known.add(service.name);
    }
    const seen = new Set();
    for (const instance of config.instances || []) {
        if (!known.has(instance.service)) throw new Error(`Unknown service: ${instance.service}`);
        if (seen.has(instance.service)) throw new Error(`Duplicate instance configuration: ${instance.service}`);
        seen.add(instance.service);
        if (!Number.isInteger(instance.replicas) || instance.replicas < 0) throw new Error('replicas must be a nonnegative integer');
    }
    return {target: config.target, environment: config.environment, platform: config.platform,
        computeNodes: config.computeNodes, instances: config.instances || [], steps: [...deploymentSteps]};
}

// Adapters perform infrastructure operations only, never business seeding or tests.
export async function executeDeployment(config, factory, options = {}) {
    const plan = planDeployment(config, options.catalog);
    const record = options.record || (() => {});
    const adapter = await factory(config, plan);
    try {
        for (const method of [...deploymentSteps, 'deploymentSnapshot']) {
            if (typeof adapter[method] !== 'function') throw new Error(`Missing deployment adapter method: ${method}`);
        }
        for (const step of deploymentSteps) {
            record({step, status: 'running', at: new Date().toISOString()});
            try {
                await adapter[step]();
                if (step === 'validateConnection') {
                    const snapshot = await adapter.deploymentSnapshot();
                    if (!snapshot.nodes?.length || snapshot.nodes.some(node => `linux/${node.architecture}` !== config.platform)) {
                        throw new Error('Cluster architecture differs from requested platform or nodes are missing');
                    }
                }
                record({step, status: 'complete', at: new Date().toISOString()});
            } catch (error) {
                record({step, status: 'failed', at: new Date().toISOString()});
                throw error;
            }
        }
        const snapshot = await adapter.deploymentSnapshot();
        return {schemaVersion: 1, deploymentId: randomUUID(), status: 'ready', verifiedAt: new Date().toISOString(),
            ...plan, clusterName: snapshot.clusterName, namespace: snapshot.namespace,
            kubeconfigFile: snapshot.kubeconfigFile, endpoints: snapshot.endpoints,
            credentialRefs: snapshot.credentialRefs,
            images: snapshot.images?.map(({source, reference, id}) => ({source, reference, id})),
            nodes: snapshot.nodes?.map(({name, architecture, ready}) => ({name, architecture, ready}))};
    } finally { await adapter.cleanup?.(); }
}

export async function runDeployment(config, factory, options = {}) {
    const directory = resolve(options.reportRoot || 'simulation/reports/deployments');
    mkdirSync(directory, {recursive: true});
    const attemptId = randomUUID();
    const report = {attemptId, status: 'running', progress: []};
    const save = (name, value) => {
        const output = resolve(directory, `${name}.json`);
        writeFileSync(`${output}.tmp`, JSON.stringify(value, null, 2), {mode: 0o600});
        renameSync(`${output}.tmp`, output);
    };
    save(`${attemptId}.steps`, report);
    try {
        const result = await executeDeployment(config, factory, {...options, record: entry => {
            report.progress.push(entry);
            save(`${attemptId}.steps`, report);
            options.record?.(entry);
        }});
        result.attemptId = attemptId;
        save(result.deploymentId, result);
        report.status = 'ready';
        report.deploymentId = result.deploymentId;
        return result;
    } catch (error) {
        // Exception text may contain credentials; retain step/status, not raw errors.
        report.status = 'failed';
        throw error;
    } finally {
        report.finishedAt = new Date().toISOString();
        save(`${attemptId}.steps`, report);
    }
}
