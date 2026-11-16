import {existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, relative, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {renderBindings} from './kubernetes-instances.mjs';
import {workloadPatches} from './deployment-runtime.mjs';
import {waitUntil} from './readiness-runtime.mjs';

export function createKubernetesDeployment(bundle, config, {root, catalog, execute, fetchImpl = fetch} = {}) {
    if (bundle.schemaVersion !== 1 || !config.kubeconfigFile || !config.instances?.length) throw new Error('Explicit Kubernetes deployment configuration required');
    const namespace = config.namespace || bundle.namespace;
    const environment = config.environment;
    if (![namespace, environment].every(value => /^[a-z0-9][a-z0-9-]{0,62}$/.test(value || ''))) throw new Error('Invalid namespace or environment');
    const timeoutMs = config.timeoutMs || 600000;
    const bindings = {...bundle.bindings, ...config.bindings, namespace, environment, gatewayUrl: config.gatewayUrl, imagePrefix: config.imagePrefix, imageVersion: config.imageVersion};
    const material = renderBindings(bundle, bindings);
    const confined = path => {
        const target = resolve(root, path), rel = relative(resolve(root), target);
        if (!rel || rel.startsWith('../') || rel === '..' || rel.startsWith('/')) throw new Error('Deployment path escapes workspace');
        let parent = target;
        while (!existsSync(parent)) parent = dirname(parent);
        const actual = relative(realpathSync(root), realpathSync(parent));
        if (actual === '..' || actual.startsWith('../') || actual.startsWith('/')) throw new Error('Deployment symlink escapes workspace');
        return target;
    };
    const run = execute || ((command, args, input) => {
        const result = spawnSync(command, args, {encoding: 'utf8', input, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024});
        if (result.status !== 0) throw new Error('Deployment command failed: ' + command + ' ' + args[0]);
        return result.stdout;
    });
    const kube = (args, input) => run('kubectl', ['--kubeconfig', resolve(root, config.kubeconfigFile), ...args], input);
    const selected = name => config.instances.some(item => item.service === name && item.replicas > 0);
    const nodes = () => JSON.parse(kube(['get', 'nodes', '-o', 'json'])).items.map(node => ({name: node.metadata.name,
        architecture: node.status.nodeInfo.architecture, ready: node.status.conditions?.some(c => c.type === 'Ready' && c.status === 'True')}));
    const directory = confined(material.workspace);
    const resources = material.resources.map(confined);
    const secrets = material.secrets.map(confined);
    for (const file of [...resources, ...secrets]) if (!existsSync(file)) throw new Error('Deployment input is missing: ' + file);
    let verified = [], rendered, imagesPrepared = false;
    const endpoints = renderBindings(bundle.endpoints || {}, {...bindings, gatewayUrl: config.gatewayUrl});
    return {
        async validateConnection() {
            if (!existsSync(resolve(root, config.kubeconfigFile))) throw new Error('Kubeconfig not found');
            await waitUntil('Kubernetes API and nodes', () => {
                try { kube(['get', '--raw=/readyz']); const items = nodes(); return items.length && items.every(n => n.ready); }
                catch { return false; }
            }, {timeoutMs});
        },
        async prepareImages() {
            imagesPrepared = false;
            verified = material.images.filter(image => selected(image.service) || image.always).map(image => {
                image = {...image, reference: config.images?.[image.service] || image.reference};
                run('docker', ['pull', '--platform', config.platform, image.reference]);
                const inspection = JSON.parse(run('docker', ['image', 'inspect', image.reference]))[0];
                if (inspection.Os + '/' + inspection.Architecture !== config.platform) throw new Error('Image architecture mismatch: ' + image.service);
                const repository = image.reference.split('@')[0].replace(/:[^/:]+$/, '');
                const digest = (inspection.RepoDigests || []).find(value => value.startsWith(repository + '@sha256:'));
                if (!digest || !/@sha256:[a-f0-9]{64}$/i.test(digest)) throw new Error('Verified registry digest required: ' + image.service);
                return {...image, source: image.reference, reference: digest, id: inspection.Id};
            });
            imagesPrepared = true;
        },
        async deploy() {
            if (!imagesPrepared) throw new Error('Verify images before deployment');
            mkdirSync(directory, {recursive: true});
            for (const [name, value] of Object.entries(material.files || {})) {
                if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error('Invalid deployment template filename');
                const text = value.source ? renderBindings(readFileSync(confined(value.source), 'utf8'), bindings) : JSON.stringify(value);
                writeFileSync(confined(resolve(directory, name)), text, {mode: 0o600});
            }
            const patches = [...(material.patches || []).map(p => ({...p, patch: JSON.stringify(p.patch)})),
                ...(material.imageTargets || []).flatMap(target => {
                    const image = verified.find(image => image.service === target.service);
                    return image ? [{patch: JSON.stringify({apiVersion: 'v1', kind: 'ConfigMap', metadata: {name: target.configMap}, data: {[target.key]: image.reference}})}] : [];
                }),
                ...workloadPatches(catalog.services.map(s => s.name), config.instances)];
            const images = verified.map(image => ({name: image.alias, newName: image.reference.split('@')[0], digest: image.reference.split('@')[1]}));
            writeFileSync(confined(resolve(directory, 'kustomization.yaml')), JSON.stringify({resources: resources.map(path => relative(directory, path)), namespace,
                components: material.files ? ['./component'] : [], images, patches}), {mode: 0o600});
            // A component is written separately so its patches run before workload selection.
            if (material.files) {
                const component = confined(resolve(directory, 'component'));
                mkdirSync(component, {recursive: true});
                writeFileSync(confined(resolve(component, 'kustomization.yaml')), JSON.stringify(material.component), {mode: 0o600});
            }
            rendered = kube(['kustomize', directory, '--load-restrictor', 'LoadRestrictionsNone']);
            kube(['apply', '-f', '-'], JSON.stringify({apiVersion: 'v1', kind: 'Namespace', metadata: {name: namespace}}));
            for (const secret of secrets) kube(['-n', namespace, 'apply', '-f', secret]);
            kube(['apply', '-f', '-'], rendered);
        },
        async waitDeploymentReady() {
            for (const item of config.instances.filter(item => item.replicas > 0)) {
                kube(['-n', namespace, 'rollout', 'status', 'deployment/' + item.service, '--timeout=' + Math.ceil(timeoutMs / 1000) + 's']);
            }
            for (const probe of material.health || []) if (probe.services.every(selected)) {
                const url = renderBindings(probe.url, {...bindings, ...endpoints});
                await waitUntil('Deployment HTTP health', async signal => { try { return (await fetchImpl(url, {signal})).ok; } catch { return false; } }, {timeoutMs});
            }
        },
        deploymentSnapshot: () => ({clusterName: config.clusterName, namespace, kubeconfigFile: resolve(root, config.kubeconfigFile),
            endpoints, nodes: nodes(), images: verified, credentialRefs: {kubernetesSecretsFile: secrets[0]}}),
        images: () => Object.fromEntries(verified.map(image => [image.service, image.reference]))
    };
}
