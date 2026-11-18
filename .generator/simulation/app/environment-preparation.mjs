import {readFileSync, mkdirSync, writeFileSync, renameSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {assertStaticNetwork, inspectNetwork} from './k3d-network.mjs';

export function planEnvironment(config) {
    if (config.kubeContext) throw new Error('Use a dedicated kubeconfig with the intended current context');
    if (!['existing', 'k3d'].includes(config.provisioner)) throw new Error('provisioner must be existing or k3d');
    if (!['kubernetes', 'docker-compose'].includes(config.target)) throw new Error('Unsupported environment target');
    if (config.mode && !['managed', 'existing'].includes(config.mode)) throw new Error('Invalid environment mode');
    if (config.mode === 'existing' && config.provisioner !== 'existing') throw new Error('Existing mode cannot create infrastructure');
    if (config.target === 'docker-compose') {
        if (config.provisioner !== 'existing' || config.mode === 'managed' || !config.environment || !config.dockerContext) throw new Error('Compose requires an explicit existing Docker context');
        return {environment: config.environment, target: config.target, provisioner: config.provisioner, steps: ['checkDockerConnection', 'checkCompose']};
    }
    if (!config.environment || !config.kubeconfigFile) throw new Error('environment and kubeconfigFile are required');
    if (config.provisioner === 'k3d' && (!/^[a-z][a-z0-9-]*$/.test(config.clusterName || '') || !config.clusterConfig)) {
        throw new Error('k3d requires clusterName and an Operations clusterConfig file');
    }
    if (config.workerNodes !== undefined && (!Number.isInteger(config.workerNodes) || config.workerNodes < 0)) throw new Error('Invalid workerNodes');
    if (config.subnet !== undefined && (typeof config.subnet !== 'string' || !config.subnet.trim())) throw new Error('subnet must be auto or a CIDR');
    if (config.timeoutMs !== undefined && (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)) throw new Error('Invalid timeoutMs');
    return {environment: config.environment, target: config.target, provisioner: config.provisioner,
        steps: [...(config.provisioner === 'k3d' ? ['createOrReuseCluster', 'writeKubeconfig'] : []), 'checkConnection', 'waitNodesReady']};
}

export async function prepareEnvironment(config, options = {}) {
    planEnvironment(config);
    const execute = options.execute || ((cmd, args, env) => execFileSync(cmd, args, {
        encoding: 'utf8', env: {...process.env, ...env}, timeout: config.timeoutMs || 300000,
        stdio: ['ignore', 'pipe', 'pipe']
    }));
    if (config.target === 'docker-compose') {
        const info = JSON.parse(execute('docker', ['--context', config.dockerContext, 'info', '--format', '{{json .}}']));
        execute('docker', ['--context', config.dockerContext, 'compose', 'version']);
        if (!info.ID) throw new Error('Docker daemon identity is missing');
        return {schemaVersion: 1, status: 'ready', environment: config.environment, target: config.target,
            provisioner: 'existing', dockerContext: config.dockerContext, infrastructureId: info.ID,
            architecture: info.Architecture, verifiedAt: new Date().toISOString()};
    }
    const kubeconfigFile = resolve(config.kubeconfigFile);
    let network;
    if (config.provisioner === 'k3d') {
        // The checked-in Operations cluster asset remains unchanged.
        const clusters = JSON.parse(execute('k3d', ['cluster', 'list', '-o', 'json']));
        if (!clusters.some(cluster => cluster.name === config.clusterName)) {
            const args = ['cluster', 'create', config.clusterName, '--config', resolve(config.clusterConfig), '--subnet', config.subnet || 'auto'];
            if (config.workerNodes !== undefined) args.push('--agents', String(config.workerNodes));
            if (config.registryConfig) args.push('--registry-config', resolve(config.registryConfig));
            execute('k3d', args);
        } else {
            // Existing clusters are never recreated or silently migrated.
            assertStaticNetwork(inspectNetwork(config.clusterName, execute));
            execute('k3d', ['cluster', 'start', config.clusterName, '--timeout', `${Math.ceil((config.timeoutMs || 300000) / 1000)}s`]);
        }
        network = assertStaticNetwork(inspectNetwork(config.clusterName, execute));
        const contents = execute('k3d', ['kubeconfig', 'get', config.clusterName]);
        mkdirSync(dirname(kubeconfigFile), {recursive: true});
        writeFileSync(kubeconfigFile, contents, {mode: 0o600});
    }
    const env = {KUBECONFIG: kubeconfigFile};
    const kubectl = args => execute('kubectl', [...(config.kubeContext ? ['--context', config.kubeContext] : []), ...args], env);
    const deadline = Date.now() + (config.timeoutMs || 300000);
    let nodes;
    while (Date.now() < deadline) {
        try {
            kubectl(['get', '--raw=/readyz', '--request-timeout=10s']);
            nodes = JSON.parse(kubectl(['get', 'nodes', '-o', 'json', '--request-timeout=10s'])).items;
            if (nodes.length && nodes.every(node => node.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True'))) break;
            nodes = null;
        } catch { nodes = null; }
        await (options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))))(1000);
    }
    if (!nodes) throw new Error('Environment readiness timed out; check connectivity and node health');
    const workers = nodes.filter(node => !Object.hasOwn(node.metadata.labels || {}, 'node-role.kubernetes.io/control-plane') && !Object.hasOwn(node.metadata.labels || {}, 'node-role.kubernetes.io/master'));
    if (config.workerNodes !== undefined && workers.length < config.workerNodes) throw new Error('Insufficient worker nodes; resize explicitly, no automatic recreation');
    const infrastructureId = JSON.parse(kubectl(['get', 'namespace', 'kube-system', '-o', 'json', '--request-timeout=10s'])).metadata?.uid;
    if (!infrastructureId) throw new Error('Cluster identity is missing');
    return {schemaVersion: 1, status: 'ready', environment: config.environment, target: config.target,
        infrastructureId, kubeContext: config.kubeContext,
        network: network && {name: network.networkName, id: network.networkId, subnets: network.subnets,
            nodes: network.containers.map(c => ({name: c.name, ip: c.staticIp}))},
        provisioner: config.provisioner, clusterName: config.clusterName, kubeconfigFile,
        verifiedAt: new Date().toISOString(), nodes: nodes.map(node => ({name: node.metadata.name, architecture: node.status.nodeInfo.architecture}))};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const [file, option] = process.argv.slice(2);
        if (!file || (option && option !== '--plan')) throw new Error('Usage: node simulation/src/prepare-environment.mjs <config.json> [--plan]');
        const config = JSON.parse(readFileSync(file, 'utf8'));
        if (option === '--plan') console.log(JSON.stringify(planEnvironment(config), null, 2));
        else {
            const result = await prepareEnvironment(config);
            const output = resolve(config.output || 'simulation/reports/environment.json');
            mkdirSync(dirname(output), {recursive: true});
            writeFileSync(`${output}.tmp`, JSON.stringify(result, null, 2), {mode: 0o600});
            renameSync(`${output}.tmp`, output);
            console.log(`Environment ready: ${output}`);
        }
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
