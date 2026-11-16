import {mkdirSync, writeFileSync, realpathSync, existsSync} from 'node:fs';
import {resolve, relative, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';

export function renderBindings(value, bindings) {
    if (Array.isArray(value)) return value.map(item => renderBindings(item, bindings));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [renderBindings(k, bindings), renderBindings(v, bindings)]));
    if (typeof value !== 'string') return value;
    const lookup = key => {
        if (!Object.hasOwn(bindings, key) || bindings[key] === undefined) throw new Error('Missing package binding: ' + key);
        return bindings[key];
    };
    const exact = value.match(/^{{([A-Za-z][A-Za-z0-9]*)}}$/);
    return exact ? lookup(exact[1]) : value.replace(/{{([A-Za-z][A-Za-z0-9]*)}}/g, (_, key) => String(lookup(key)));
}
const dns = value => typeof value === 'string' && value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
function validatePackage(bundle) {
    if (bundle?.schemaVersion !== 1 || !dns(bundle.service) || !bundle.namespaceTemplate || !bundle.endpointTemplate) throw new Error('Invalid instance package');
    for (const field of ['resources', 'images', 'patches', 'privatePatches', 'publicPatches', 'secrets', 'readiness']) {
        if (!Array.isArray(bundle[field])) throw new Error('Missing package list: ' + field);
    }
    if (!bundle.readiness.length || bundle.readiness.some(name => !dns(name))) throw new Error('Package requires valid readiness workloads');
    if (typeof bundle.workspace !== 'string' || !bundle.workspace) throw new Error('Package workspace is required');
    if (bundle.images.some(item => !dns(item.name) || typeof item.source !== 'string' || !item.source)) throw new Error('Invalid package image');
}
function workspacePath(root, path) {
    const result = resolve(root, path), rel = relative(resolve(root), result);
    if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('/')) throw new Error('Package path escapes workspace');
    return result;
}
function prepareDirectory(root, path) {
    const result = workspacePath(root, path);
    let parent = result;
    while (!existsSync(parent)) parent = dirname(parent);
    if (realpathSync(parent) !== realpathSync(root)) workspacePath(realpathSync(root), realpathSync(parent));
    mkdirSync(result, {recursive: true});
    workspacePath(realpathSync(root), realpathSync(result));
    return result;
}
export function instanceSlot(bundle, parentNamespace, slot, access) {
    validatePackage(bundle);
    if (!Number.isInteger(slot) || slot < 1 || !dns(parentNamespace)) throw new Error('Invalid instance slot');
    const namespace = renderBindings(bundle.namespaceTemplate, {parentNamespace, slot});
    if (!dns(namespace)) throw new Error('Invalid instance namespace');
    const result = {slot, namespace, service: bundle.service, endpoint: renderBindings(bundle.endpointTemplate, {parentNamespace, namespace, slot})};
    const endpoint = new URL(result.endpoint);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('Invalid endpoint');
    if (access) {
        const url = new URL(access.publicUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid instance publicUrl');
        if (!Number.isInteger(access.capacity) || slot > access.capacity) throw new Error('Instance slots exceed mapped port capacity');
        const hostPort = access.hostPortStart + slot - 1, nodePort = access.nodePortStart + slot - 1;
        if (!Number.isInteger(hostPort) || hostPort < 1024 || hostPort > 65535 || !Number.isInteger(nodePort) || nodePort < 30000 || nodePort > 32767) throw new Error('Invalid instance port range');
        url.port = String(hostPort);
        Object.assign(result, {hostPort, nodePort, consoleUrl: url.origin});
    }
    return result;
}
export function instanceOverlay(bundle, {root, environment, namespace, slot, imagePrefix, imageVersion, images = {}, access}) {
    if (!dns(environment)) throw new Error('Invalid environment');
    const target = instanceSlot(bundle, namespace, slot, access);
    const bindings = {...target, parentNamespace: namespace, environment};
    const materialized = renderBindings({resources: bundle.resources, patches: [...bundle.patches, ...(access ? bundle.publicPatches : bundle.privatePatches)]}, bindings);
    const resource = path => {
        const result = workspacePath(root, path);
        workspacePath(realpathSync(root), realpathSync(result));
        return result;
    };
    return {
        resources: ['namespace.json', ...materialized.resources.map(resource)],
        namespace: target.namespace,
        images: bundle.images.map(item => {
            const reference = images[item.name];
            if (reference?.includes('@')) return {name: item.source, newName: reference.split('@')[0], digest: reference.split('@')[1]};
            if (!imagePrefix || !imageVersion) throw new Error('Explicit image reference or prefix/version is required');
            return {name: item.source, newName: imagePrefix + '/' + item.name, newTag: imageVersion};
        }),
        patches: materialized.patches.map(patch => patch.path ? {...patch, path: resource(patch.path)} : {...patch, patch: JSON.stringify(patch.patch)})
    };
}
export function createKubernetesInstances(bundle, options) {
    validatePackage(bundle);
    const {root, environment, namespace, kubeconfigFile, count, timeoutMs} = options;
    if (!kubeconfigFile || !Number.isInteger(count) || count < 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Explicit instance count, kubeconfig and timeout are required');
    const execute = options.execute || ((args, input) => {
        const result = spawnSync('kubectl', ['--kubeconfig', kubeconfigFile, ...args], {encoding: 'utf8', input, timeout: timeoutMs + 30000, maxBuffer: 16 * 1024 * 1024});
        if (result.status !== 0) throw new Error('Instance kubectl ' + args[0] + ' failed');
        return result.stdout;
    });
    const apply = value => execute(['apply', '-f', '-'], JSON.stringify(value));
    const slots = Array.from({length: count}, (_, i) => instanceSlot(bundle, namespace, i + 1, options.access));
    if (new Set(slots.map(s => s.namespace)).size !== slots.length || slots.some(s => s.namespace === namespace)) throw new Error('Instance namespaces must be distinct from each other and source namespace');
    return {
        slots,
        setImages(images) { options.images = images; },
        deploy() {
            // Render every instance before creating resources.
            const prepared = slots.map(target => ({target, overlay: instanceOverlay(bundle, {...options, slot: target.slot})}));
            for (const {target, overlay} of prepared) {
                const metadata = {name: target.namespace};
                const secretNames = renderBindings(bundle.secrets, {environment, namespace: target.namespace, parentNamespace: namespace});
                const secrets = secretNames.map(name => {
                    if (!dns(name)) throw new Error('Invalid Secret name');
                    const secret = JSON.parse(execute(['-n', namespace, 'get', 'secret', name, '-o', 'json']));
                    return {apiVersion: 'v1', kind: 'Secret', metadata: {name, namespace: target.namespace}, type: secret.type, data: secret.data};
                });
                const dir = prepareDirectory(root, bundle.workspace + '/' + target.namespace);
                writeFileSync(resolve(dir, 'namespace.json'), JSON.stringify({apiVersion: 'v1', kind: 'Namespace', metadata}));
                writeFileSync(resolve(dir, 'kustomization.yaml'), JSON.stringify(overlay));
                const rendered = execute(['kustomize', dir, '--load-restrictor', 'LoadRestrictionsNone']);
                apply({apiVersion: 'v1', kind: 'Namespace', metadata});
                for (const secret of secrets) apply(secret);
                execute(['apply', '-f', '-'], rendered);
            }
        },
        waitReady() {
            for (const target of slots) for (const name of bundle.readiness) {
                if (!dns(name)) throw new Error('Invalid readiness workload');
                execute(['-n', target.namespace, 'rollout', 'status', 'deployment/' + name, '--timeout=' + Math.ceil(timeoutMs / 1000) + 's']);
            }
        },
        enroll(slot, identity, nodeName) {
            const target = slots.find(item => item.slot === slot), enrollment = bundle.enrollment;
            if (!target || !enrollment || !dns(enrollment.deployment) || !dns(enrollment.configMap) || !dns(nodeName)) throw new Error('Invalid enrollment target');
            if (!identity || Object.values(identity).some(value => typeof value !== 'string')) throw new Error('Enrollment values must be strings');
            if (!Array.isArray(enrollment.immutableKeys) || enrollment.immutableKeys.some(key => !identity[key])) throw new Error('Enrollment identity is incomplete');
            const podSpec = renderBindings(enrollment.podSpec, {nodeName, namespace: target.namespace, parentNamespace: namespace, environment});
            execute(['-n', target.namespace, 'get', 'deployment', enrollment.deployment]);
            const existing = execute(['-n', target.namespace, 'get', 'configmap', enrollment.configMap, '--ignore-not-found', '-o', 'json']);
            if (existing) {
                const data = JSON.parse(existing).data || {};
                if (enrollment.immutableKeys.some(key => data[key] && data[key] !== identity[key])) throw new Error('Instance already belongs to another registration');
            }
            apply({apiVersion: 'v1', kind: 'ConfigMap', metadata: {name: enrollment.configMap, namespace: target.namespace}, data: identity});
            execute(['-n', target.namespace, 'patch', 'deployment', enrollment.deployment, '--type', 'strategic', '-p', JSON.stringify({spec: {template: {spec: podSpec}}})]);
            execute(['-n', target.namespace, 'rollout', 'restart', 'deployment/' + enrollment.deployment]);
            execute(['-n', target.namespace, 'rollout', 'status', 'deployment/' + enrollment.deployment, '--timeout=' + Math.ceil(timeoutMs / 1000) + 's']);
            return target;
        }
    };
}
