/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildOperationsModel, gatewayPathForApplication } = require('../operations-model-builder');
const { loadMedolWorkspace } = require('../../../common/core/medol-workspace');
const { loadOperationsConfig } = require('../operations-config');
const { generateOperationsFiles } = require('../operations-generator');
const { renderApisixStandaloneConfig } = require('../renderers/apisix-renderer');
const { renderDockerCompose } = require('../renderers/docker-compose-renderer');
const { k3sFiles, kubernetesFiles } = require('../renderers/kubernetes-renderer');
const {tenantDatabaseName} = require('../../../common/core/tenant-storage');

const sampleModel = {
    domain: 'LearningPlatform',
    deployments: [{
        name: 'FederationService',
        title: 'Federation Service',
        contexts: [{ name: 'FederationContext', title: 'Federation Context' }]
    }, {
        name: 'DatasetService',
        title: 'Dataset Service',
        contexts: [{ name: 'DatasetContext', title: 'Dataset Context' }]
    }],
    contexts: [{
        name: 'FederationContext',
        title: 'Federation Context'
    }, {
        name: 'DatasetContext',
        title: 'Dataset Context'
    }]
};

test('tenant-enabled deployments share database and schema while ordinary deployments remain separate', () => {
    const model = buildOperationsModel({...sampleModel, tenancy: {enabled: true}});
    const backends = model.applications.filter((application) => application.kind === 'backend');
    const urls = backends.map((application) => application.environmentVariables.find((item) => item.name === 'DB_URL').value);
    assert.equal(new Set(urls).size, 1);
    assert.equal(urls[0], `jdbc:postgresql://postgres:5432/${tenantDatabaseName({...sampleModel, tenancy: {enabled: true}})}`);
    assert(backends.every((application) => application.environmentVariables.some((item) => item.name === 'DB_SCHEMA')));
    const ordinary = buildOperationsModel(sampleModel).applications.filter((application) => application.kind === 'backend');
    assert.equal(new Set(ordinary.map((application) => application.environmentVariables.find((item) => item.name === 'DB_URL').value)).size, 2);
    assert(ordinary.every((application) => !application.environmentVariables.some((item) => item.name === 'DB_SCHEMA')));
});

test('builds operations model applications, infrastructure, gateway, and environment defaults', () => {
    const model = buildOperationsModel(sampleModel);

    assert.equal(model.name, 'learning-platform');
    assert.deepEqual(model.applications.map((application) => application.name), [
        'console',
        'federation-service',
        'dataset-service'
    ]);
    assert.deepEqual(model.infrastructure.map((component) => component.type), [
        'postgres',
        'umadb',
        'axon-server'
    ]);
    assert.equal(model.gateway.provider, 'apisix');
    assert.deepEqual(model.gateway.upstreams.map((upstream) => upstream.serviceName), [
        'console',
        'federation-service',
        'dataset-service'
    ]);
    assert.deepEqual(model.gateway.routes.map((route) => route.paths[0]), [
        '/*',
        '/api/federations/*',
        '/api/datasets/*'
    ]);
    assert.equal(model.environments.find((environment) => environment.name === 'dev').applicationOverrides['federation-service'].exposePorts, true);
    assert.equal(model.environments.find((environment) => environment.name === 'prod').applicationOverrides['federation-service'].exposePorts, false);
});

test('uses explicit backend ports in generated service URLs', () => {
    const model = buildOperationsModel(sampleModel, {
        operations: {
            applications: {
                'federation-service': { servicePort: 8091 },
                'dataset-service': { servicePort: 8092 }
            }
        }
    });
    const federation = model.applications.find((application) => application.name === 'federation-service');
    const dataset = model.applications.find((application) => application.name === 'dataset-service');

    assert.equal(federation.servicePort, 8091);
    assert.equal(dataset.servicePort, 8092);
    assert.deepEqual(
        federation.environmentVariables.find((entry) => entry.name === 'DATASET_SERVICE_URL'),
        { name: 'DATASET_SERVICE_URL', value: 'http://dataset-service:8092' }
    );
    assert.deepEqual(
        dataset.environmentVariables.find((entry) => entry.name === 'FEDERATION_SERVICE_URL'),
        { name: 'FEDERATION_SERVICE_URL', value: 'http://federation-service:8091' }
    );
});

test('builds operations topology for multiple frontend applications', () => {
    const model = buildOperationsModel({
        ...sampleModel,
        frontendApplications: [{
            name: 'LearningConsole',
            title: 'Learning Console',
            contexts: [{
                name: 'FederationContext',
                backend: 'FederationService'
            }]
        }, {
            name: 'ParticipantConsole',
            title: 'Participant Console',
            contexts: [{
                name: 'DatasetContext',
                backend: 'DatasetService'
            }]
        }]
    });
    const script = generateOperationsFiles(model, { target: 'model', environment: 'dev' })['operations/images/dev/images.mjs'];

    assert.deepEqual(model.applications.map((application) => application.name), [
        'learning-console',
        'participant-console',
        'federation-service',
        'dataset-service'
    ]);
    assert.equal(model.applications.find((application) => application.name === 'learning-console').imageName, 'medol/learning-console');
    assert.equal(model.applications.find((application) => application.name === 'participant-console').bundledWithBackend, 'dataset-service');
    assert.deepEqual(
        model.gateway.routes.filter((route) => route.upstreamId.includes('console')).map((route) => route.paths[0]),
        ['/*', '/participant-console/*']
    );
    assert.match(script, /frontendApplications = /);
    assert.match(script, /learning-console-images\.tar/);
    assert.match(script, /participant-console-images\.tar/);
    assert.match(script, /VITE_FRONTEND_APP=\$\{project\.application\.frontendApplicationName\}/);
    assert.match(script, /"bundledWithBackend": "dataset-service"/);
    assert.doesNotMatch(script, /"console": "console-images\.tar"/);
});

test('collects backend and frontend technology stacks from generated build manifests', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'medol-doc-facts-'));
    try {
        const model = buildOperationsModel(sampleModel);
        const generated = generateOperationsFiles(model, { target: 'model', environment: 'dev' });
        for (const file of [
            'operations/model/dev/operations-model.json',
            'docs/document-support/collect-engineering-facts.mjs',
            'docs/document-support/config/engineering-facts-sources.json'
        ]) {
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            fs.writeFileSync(path.join(root, file), generated[file]);
        }
        const backendPom = path.join(root, 'backend', 'federation-service', 'pom.xml');
        fs.mkdirSync(path.dirname(backendPom), { recursive: true });
        fs.writeFileSync(backendPom, '<project><parent><artifactId>spring-boot-starter-parent</artifactId><version>3.5.11</version></parent><properties><java.version>21</java.version><kotlin.version>2.3.20</kotlin.version><axon.version>5.1.1</axon.version></properties></project>');
        const frontendPackage = path.join(root, 'console', 'package.json');
        fs.mkdirSync(path.dirname(frontendPackage), { recursive: true });
        fs.writeFileSync(frontendPackage, JSON.stringify({ dependencies: { react: '19.1.0', '@refinedev/core': '^5.0.8' }, devDependencies: { vite: '^6.3.5' } }));

        execFileSync('node', [path.join(root, 'docs/document-support/collect-engineering-facts.mjs')], { cwd: root });
        const facts = JSON.parse(fs.readFileSync(path.join(root, 'docs/generated/facts/engineering-facts.json'), 'utf8'));
        assert.deepEqual(facts.technologyStacks.find((stack) => stack.application === 'federation-service').technologies.slice(0, 4), [
            { name: 'Java', version: '21' },
            { name: 'Kotlin', version: '2.3.20' },
            { name: 'Axon Framework', version: '5.1.1' },
            { name: 'Spring Boot', version: '3.5.11' }
        ]);
        assert.deepEqual(facts.technologyStacks.find((stack) => stack.application === 'console').technologies, [
            { name: 'React', version: '19.1.0' },
            { name: 'Refine', version: '^5.0.8' },
            { name: 'Vite', version: '^6.3.5' }
        ]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('derives gateway paths from service naming conventions', () => {
    assert.equal(gatewayPathForApplication('federation-service', {}), '/api/federations');
    assert.equal(gatewayPathForApplication('dataset-service', {}), '/api/datasets');
    assert.equal(gatewayPathForApplication('runtime-agent', {}), '/api/runtime-agent');
    assert.equal(gatewayPathForApplication('custom-service', {
        gateway: {
            routes: {
                'custom-service': { path: '/api/custom' }
            }
        }
    }), '/api/custom');
});

test('enables Axon Server when it is selected as event storage', () => {
    const model = buildOperationsModel(sampleModel, {
        operations: {
            eventStorage: 'axon-server'
        }
    });
    const axonServer = model.infrastructure.find((component) => component.type === 'axon-server');
    const compose = renderDockerCompose(model, 'dev');

    assert.equal(axonServer.enabled, true);
    assert.match(compose, /axon-server:/);
    assert.doesNotMatch(compose, /profiles:\n      - "axon-server"/);
});

test('renders APISIX standalone declarative config', () => {
    const model = buildOperationsModel(sampleModel);
    const actual = renderApisixStandaloneConfig(model);
    const expected = golden('apisix.yaml');
    assert.equal(actual, expected);
});

test('renders Docker Compose topology with gateway, applications, infrastructure, and volumes', () => {
    const model = buildOperationsModel(sampleModel);
    const actual = renderDockerCompose(model, 'dev');
    const expected = golden('docker-compose.yml');
    assert.equal(actual, expected);
});

test('generates operations target file sets', () => {
    const model = buildOperationsModel(sampleModel);
    const files = generateOperationsFiles(model, { target: 'all', environment: 'dev' });
    assert(files['operations/model/dev/operations-model.json']);
    assert(files['operations/model/dev/network-topology.md']);
    assert(files['operations/images/dev/images.mjs']);
    assert(files['operations/harbor/dev/README.md']);
    assert(files['operations/zot/dev/README.md']);
    assert(!Object.keys(files).some((file) => file.startsWith('operations/dev/')));
    assert(files['operations/apisix/dev/apisix.yaml']);
    assert(files['operations/images/dev/images.mjs']);
    assert(files['docs/document-support/collect-engineering-facts.mjs']);
    assert(files['docs/document-support/i18n.mjs']);
    assert(files['docs/document-support/i18n/base.json']);
    assert(files['docs/document-support/i18n/en-US.json']);
    assert(files['docs/document-support/i18n/zh-CN.json']);
    assert(files['docs/document-support/config/engineering-facts-sources.json']);
    assert.match(files['docs/document-support/config/engineering-facts-sources.json'], /network-topology\.md/);
    assert.match(files['docs/document-support/collect-engineering-facts.mjs'], /docs\/generated\/facts\/engineering-facts\.json/);
    assert.match(files['docs/document-support/i18n.mjs'], /fallbackLanguage/);
    assert.match(files['operations/images/dev/images.mjs'], /node operations\/images\/dev\/images\.mjs package/);
    assert.match(files['operations/images/dev/images.mjs'], /--exclude-service <name\[,name\]>/);
    assert.match(files['operations/images/dev/images.mjs'], /projectImageArgs\(project\)/);
    assert.doesNotMatch(files['operations/images/dev/images.mjs'], /runtime-engine-images|RUNTIME_ENGINE_ROOT|skip-runtime-engine/);
    assert(files['operations/docker-compose/dev/docker-compose.yml']);
    assert(!files['operations/dev/docker-compose/docker-compose.yml']);
    assert(files['operations/docker-compose/dev/.env-example']);
    assert(files['operations/apisix/dev/config.yaml']);
    assert.match(files['operations/docker-compose/dev/docker-compose.yml'], /\.\.\/\.\.\/apisix\/dev\/config.yaml/);
    assert(files['operations/docker-compose/dev/.env-example']);
    assert(files['operations/kubernetes/base/applications.yaml']);
    assert(files['operations/kubernetes/environments/dev/kustomization.yaml']);
    assert(files['operations/kubernetes/environments/dev/configmap.yaml']);
    assert(files['operations/kubernetes/environments/dev/secrets.example.yaml']);
    assert(files['operations/kubernetes/environments/dev/patches/federation-service-envfrom.yaml']);
    assert(!files['operations/kubernetes/environments/prod/kustomization.yaml']);
    assert(files['operations/k3s/base/apisix.yaml']);
    assert(!Object.keys(files).some((file) => file.startsWith('operations/shared/')));
    assert(!Object.keys(files).some((file) => file.startsWith('operations/dev/k3s/')));
    assert(files['operations/k3s/cluster/k3d-dev.yaml']);
    assert(files['operations/k3s/scripts/k3d-dev.sh']);
    assert.match(files['operations/k3s/scripts/k3d-dev.sh'], /CLUSTER_NAME="\$\{CLUSTER_NAME:-learning-platform-dev\}"/);
    assert.match(files['operations/k3s/scripts/k3d-dev.sh'], /export KUBECONFIG="\$\{KUBECONFIG:-\$\{KUBECONFIG_FILE\}\}"/);
    assert.match(files['operations/k3s/scripts/k3d-dev.sh'], /PRE_APPLY_FILE="\$\{PRE_APPLY_FILE:-\}"/);
    assert.match(files['operations/k3s/scripts/k3d-dev.sh'], /KUBECTL_APPLY_VALIDATE="\$\{KUBECTL_APPLY_VALIDATE:-false\}"/);
    assert.match(files['operations/k3s/scripts/k3d-dev.sh'], /kubectl_apply\(\)/);
    assert.match(files['operations/k3s/scripts/k3d-dev.sh'], /kind: Kustomization\nnamespace: "\$\{NAMESPACE\}"\nresources:/);
    assert.match(files['operations/k3s/scripts/k3d-dev.sh'], /kubectl -n "\$\{NAMESPACE\}" apply --validate="\$\{KUBECTL_APPLY_VALIDATE\}" -f "\$\{PRE_APPLY_FILE\}"/);
    assert.match(files['operations/k3s/scripts/k3d-dev.sh'], /kubectl -n "\$\{NAMESPACE\}" rollout restart/);
    assert(files['operations/harbor/dev/README.md']);
    assert(files['operations/harbor/dev/.env-example']);
    assert(files['operations/harbor/dev/harbor.yml-example']);
    assert(files['operations/harbor/dev/install-harbor.mjs']);
    assert(files['operations/zot/dev/README.md']);
    assert(files['operations/zot/dev/.env-example']);
    assert(files['operations/zot/dev/docker-compose.yml']);
    assert(files['operations/zot/dev/config.json']);
});

test('shares Kubernetes bases while keeping replica overrides in environment patches', () => {
    const model = buildOperationsModel(sampleModel);
    const dev = generateOperationsFiles(model, {target: 'k3s', environment: 'dev'});
    const prod = generateOperationsFiles(model, {target: 'k3s', environment: 'prod'});
    const base = 'operations/k3s/base/applications.yaml';
    assert.equal(dev[base], prod[base]);
    assert.match(prod['operations/k3s/environments/prod/kustomization.yaml'], /\.\.\/\.\.\/base/);
    assert.match(prod['operations/k3s/environments/prod/patches/deployment-federation-service-environment.yaml'], /replicas: 2/);
    assert(prod['operations/docker-compose/prod/docker-compose.yml'] === undefined);
});

test('renders network topology from configured gateway routes and active service dependencies', () => {
    const model = buildOperationsModel(sampleModel);
    const topology = generateOperationsFiles(model, { target: 'model', environment: 'dev' })['operations/model/dev/network-topology.md'];

    assert.match(topology, /```mermaid\nflowchart LR/);
    assert.match(topology, /Client \/ Browser/);
    assert.match(topology, /apisix :9080/);
    assert.match(topology, /federation-service :8080/);
    assert.match(topology, /dataset-service :8081/);
    assert.match(topology, /postgres :5432/);
    assert.match(topology, /umadb :50051/);
    assert.doesNotMatch(topology, /axon-server :8124/);
    assert.doesNotMatch(topology, /registry\.internal|192\.168\./);
});

test('omits gateway routes when disabled and follows environment exposure', () => {
    const model = buildOperationsModel(sampleModel, {
        operations: { gateway: { enabled: false } }
    });
    const topology = generateOperationsFiles(model, { target: 'model', environment: 'dev' })['operations/model/dev/network-topology.md'];

    assert.doesNotMatch(topology, /apisix :/);
    assert.match(topology, /Client \/ Browser/);
    assert.match(topology, /federation-service :8080/);
});

test('places services and local data dependencies in configured deployment sites', () => {
    const model = buildOperationsModel(sampleModel, {
        operations: {
            networkTopology: {
                sites: [{
                    name: 'central', title: 'Central environment', gateway: true,
                    applications: ['console', 'federation-service'], infrastructure: ['postgres', 'umadb']
                }, {
                    name: 'remote', title: 'Remote environment',
                    applications: ['dataset-service'], infrastructure: ['postgres', 'umadb']
                }],
                connections: [{ from: 'federation-service', to: 'dataset-service', protocol: 'HTTP', label: 'Dispatch' }]
            }
        }
    });
    const topology = generateOperationsFiles(model, { target: 'model', environment: 'dev' })['operations/model/dev/network-topology.md'];

    assert.match(topology, /subgraph Site1\["Central environment"\]/);
    assert.match(topology, /subgraph Site2\["Remote environment"\]/);
    assert.match(topology, /N\d+ -.->\|HTTP \/ Dispatch\| N\d+/);
    assert.match(topology, /configured cross-site route/);
    assert.equal((topology.match(/\["postgres :5432"\]/g) ?? []).length, 2);
    assert.equal((topology.match(/\["umadb :50051"\]/g) ?? []).length, 2);
    assert.match(topology, /A container service name alone will not resolve across sites/);
    assert.match(topology, /must be split or configured separately/);
});

test('rejects incomplete or ambiguous deployment site assignments', () => {
    const sites = [{ name: 'central', gateway: true, applications: ['console', 'federation-service'], infrastructure: ['postgres', 'umadb'] }];
    assert.throws(() => buildOperationsModel(sampleModel, { operations: { networkTopology: { sites } } }),
        /must place every application: dataset-service/);
    assert.throws(() => buildOperationsModel(sampleModel, { operations: { networkTopology: { sites: [
        sites[0], { name: 'remote', applications: ['dataset-service', 'console'], infrastructure: ['postgres', 'umadb'] }
    ] } } }), /assigns application console to multiple sites/);
});

test('accepts named topology maps from the workspace YAML parser', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-topology-'));
    try {
        fs.mkdirSync(path.join(root, '.medol'));
        fs.writeFileSync(path.join(root, '.medol/medol.yml'), [
            'operations:',
            '  networkTopology:',
            '    sites:',
            '      central:',
            '        gateway: true',
            '        applications:',
            '          console: true',
            '          federation-service: true',
            '        infrastructure:',
            '          postgres: true',
            '          umadb: true',
            '      remote:',
            '        applications:',
            '          dataset-service: true',
            '        infrastructure:',
            '          postgres: true',
            '          umadb: true',
            '    connections:',
            '      dispatch:',
            '        from: federation-service',
            '        to: dataset-service',
            '        protocol: HTTP'
        ].join('\n'));
        const workspace = loadMedolWorkspace(root);
        const model = buildOperationsModel(sampleModel, loadOperationsConfig(root, workspace));
        assert.deepEqual(model.networkTopology.sites.map((site) => site.name), ['central', 'remote']);
        assert.equal(model.networkTopology.connections[0].protocol, 'HTTP');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('renders Kubernetes and K3s manifests from the same operations model', () => {
    const model = buildOperationsModel(sampleModel);
    const kubernetes = kubernetesFiles(model);
    const k3s = k3sFiles(model);

    assert.match(kubernetes['operations/kubernetes/base/applications.yaml'], /kind: "Deployment"/);
    assert.match(kubernetes['operations/kubernetes/base/applications.yaml'], /secretKeyRef/);
    assert.doesNotMatch(kubernetes['operations/kubernetes/base/applications.yaml'], /\$\{/);
    assert.doesNotMatch(kubernetes['operations/kubernetes/base/infrastructure.yaml'], /name: "axon-server"/);
    assert.match(kubernetes['operations/kubernetes/base/infrastructure.yaml'], /name: "postgres-init"/);
    assert.match(kubernetes['operations/kubernetes/base/infrastructure.yaml'], /name: "postgres-data"/);
    assert.doesNotMatch(kubernetes['operations/kubernetes/base/infrastructure.yaml'], /postgres_data|umadb_data/);
    assert.match(kubernetes['operations/kubernetes/base/apisix.yaml'], /type: "LoadBalancer"/);
    assert.match(k3s['operations/k3s/base/apisix.yaml'], /type: "NodePort"/);
    assert.match(k3s['operations/k3s/cluster/k3d-dev.yaml'], /apiVersion: "k3d.io\/v1alpha5"/);
    assert.match(k3s['operations/k3s/cluster/k3d-dev.yaml'], /name: "learning-platform-dev"/);
    assert.match(k3s['operations/k3s/cluster/k3d-dev.yaml'], /image: "rancher\/k3s:v1.33.5-k3s1"/);
    assert(!k3s['operations/k3s/cluster/registries.yaml']);
    assert.match(k3s['operations/k3s/cluster/k3d-dev.yaml'], /port: "30080:30080"/);
    assert.doesNotMatch(k3s['operations/k3s/cluster/k3d-dev.yaml'], /\/workspace\/datasets/);
    assert.doesNotMatch(k3s['operations/k3s/cluster/k3d-dev.yaml'], /\/workspace\/tmp\/runtime-engine/);
    assert.match(k3s['operations/k3s/environments/dev/kustomization.yaml'], /configmap.yaml/);
    assert.match(k3s['operations/k3s/environments/dev/kustomization.yaml'], /patches\/federation-service-envfrom.yaml/);
    assert.doesNotMatch(k3s['operations/k3s/environments/dev/kustomization.yaml'], /secrets\.example\.yaml/);
    assert.match(k3s['operations/k3s/environments/dev/configmap.yaml'], /name: "federation-service-dev-config"/);
    assert.match(k3s['operations/k3s/environments/dev/configmap.yaml'], /SERVER_PORT: "8080"/);
    assert.match(k3s['operations/k3s/environments/dev/configmap.yaml'], /MEDOL_SYNC_ENABLED: "true"/);
    assert.match(k3s['operations/k3s/environments/dev/configmap.yaml'], /MEDOL_SYNC_MODE: "outbox-delta"/);
    assert.match(k3s['operations/k3s/environments/dev/configmap.yaml'], /MEDOL_SYNC_SOURCE_BASE_URL: ""/);
    assert.match(k3s['operations/k3s/environments/dev/configmap.yaml'], /VITE_API_URL: "https:\/\/iwdfzvfqbtokqetmbmbp\.supabase\.co"/);
    assert.match(k3s['operations/k3s/environments/dev/configmap.yaml'], /VITE_FEDERATION_SERVICE_API_URL: "\/api\/federations"/);
    assert.match(k3s['operations/k3s/environments/dev/configmap.yaml'], /VITE_SUPABASE_API_KEY: ""/);
    assert.doesNotMatch(k3s['operations/k3s/base/applications.yaml'], /VITE_SUPABASE_API_KEY/);
    assert.match(k3s['operations/k3s/environments/dev/secrets.example.yaml'], /name: "postgres-secret"/);
    assert.doesNotMatch(k3s['operations/k3s/environments/dev/secrets.example.yaml'], /VITE_SUPABASE_API_KEY/);
    assert.match(k3s['operations/k3s/environments/dev/secrets.example.yaml'], /MEDOL_SECURITY_INTERNAL_TOKEN/);
    assert.match(k3s['operations/k3s/environments/dev/patches/federation-service-envfrom.yaml'], /envFrom:/);
    assert.match(k3s['operations/k3s/README.md'], /k3d cluster create --config cluster\/k3d-dev.yaml/);
    assert.match(k3s['operations/k3s/README.md'], /project-specific Kubernetes extensions in a separate overlay/);
    assert.doesNotMatch(k3s['operations/k3s/README.md'], /runtime-agent-scheduler-rbac/);
    assert.doesNotMatch(k3s['operations/k3s/README.md'], /medol\.dev\/runtime-infrastructure-id/);
    assert.match(k3s['operations/k3s/README.md'], /cp environments\/<environment>\/secrets\.example\.yaml environments\/<environment>\/secrets\.<environment>\.yaml/);
    assert.match(k3s['operations/k3s/README.md'], /apply -f environments\/<environment>\/secrets\.<environment>\.yaml/);
    assert.match(k3s['operations/k3s/README.md'], /must not be committed/);
    assert.match(k3s['operations/k3s/README.md'], /NodePort service on `30080`/);
    assert.match(kubernetes['operations/kubernetes/base/apisix-config.yaml'], /apisix.yaml: \|/);
    assert(!kubernetes['operations/kubernetes/cluster/k3d-dev.yaml']);
});

test('derives image names and K3s registry configuration from optional registry settings', () => {
    const model = buildOperationsModel(sampleModel, {
        operations: {
            registry: {
                host: 'registry.internal:5000',
                namespace: 'team',
                insecure: true
            }
        }
    });
    const k3s = k3sFiles(model);

    assert.equal(model.imagePrefix, 'registry.internal:5000/team');
    assert.equal(model.registry.imagePrefix, 'registry.internal:5000/team');
    assert.match(
        k3s['operations/k3s/base/applications.yaml'],
        /image: "team\/federation-service:0\.0\.1-SNAPSHOT"/
    );
    assert.match(
        k3s['operations/k3s/environments/dev-registry/kustomization.yaml'],
        /newName: "registry\.internal:5000\/team\/federation-service"/
    );
    assert.match(
        k3s['operations/k3s/environments/dev-registry/kustomization.yaml'],
        /path: "image-pull-policy\.yaml"/
    );
    assert.match(
        k3s['operations/k3s/environments/dev-registry/image-pull-policy.yaml'],
        /path: "\/spec\/template\/spec\/containers\/0\/imagePullPolicy"/
    );
    assert.match(
        k3s['operations/k3s/environments/dev-registry/image-pull-policy.yaml'],
        /value: "Always"/
    );
    assert.match(
        k3s['operations/k3s/cluster/registries.yaml'],
        /"registry\.internal:5000":/
    );
    assert.match(
        k3s['operations/k3s/cluster/registries.yaml'],
        /"docker\.io":/
    );
    assert.match(
        k3s['operations/k3s/cluster/registries.yaml'],
        /"http:\/\/registry\.internal:5000"/
    );
    const modelFiles = generateOperationsFiles(model, { target: 'model', environment: 'dev' });
    assert.match(modelFiles['operations/model/dev/.gitignore'], /operations-model\.local\.json/);
    const generatedModel = JSON.parse(modelFiles['operations/model/dev/operations-model.json']);
    assert.equal(generatedModel.imagePrefix, 'team');
    assert.equal(generatedModel.registry, undefined);
    assert.equal(generatedModel.applications[0].imageName, 'team/learning-platform-console');
    assert.doesNotMatch(modelFiles['operations/model/dev/operations-model.json'], /registry\.internal:5000/);
    const localModel = JSON.parse(modelFiles['operations/model/dev/operations-model.private.json']);
    assert.equal(localModel.registry.host, 'registry.internal:5000');
    assert.deepEqual(Object.keys(localModel), ['registry']);
    assert.match(modelFiles['operations/images/dev/images.mjs'], /resolveImageConfig\(scriptDir/);
    assert.match(modelFiles['operations/images/dev/image-config.mjs'], /operations-model\.local\.json/);
    assert.doesNotMatch(modelFiles['operations/images/dev/images.mjs'], /registry\.internal:5000/);
    const deployFiles = generateOperationsFiles(model, { target: 'all', environment: 'dev' });
    assert.doesNotMatch(deployFiles['operations/docker-compose/dev/docker-compose.yml'], /registry\.internal:5000/);
    assert.doesNotMatch(deployFiles['operations/docker-compose/dev/.env-example'], /registry\.internal:5000/);
    assert.match(deployFiles['docs/document-support/collect-engineering-facts.mjs'], /app\.artifactName \?\? app\.name/);
    assert.match(deployFiles['operations/k3s/environments/dev-registry/kustomization.yaml'], /registry\.internal:5000/);
});

test('loads operations registry configuration from .medol/medol.yml', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-workspace-'));
    fs.mkdirSync(path.join(workspace, '.medol'));
    fs.writeFileSync(path.join(workspace, '.medol/medol.yml'), [
        'operations:',
        '  registry:',
        '    host: registry.internal:5000',
        '    namespace: team',
        '    insecure: true',
        ''
    ].join('\n'));

    const operationsConfig = loadOperationsConfig(workspace, loadMedolWorkspace(workspace));
    const model = buildOperationsModel(sampleModel, operationsConfig);

    assert.equal(model.imagePrefix, 'registry.internal:5000/team');
});

test('loads local operations registry overrides from .medol/medol.local.yml', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-workspace-'));
    fs.mkdirSync(path.join(workspace, '.medol'));
    fs.writeFileSync(path.join(workspace, '.medol/medol.yml'), [
        'operations:',
        '  registry:',
        '    host: registry.internal:5000',
        '    namespace: committed',
        '    insecure: true',
        ''
    ].join('\n'));
    fs.writeFileSync(path.join(workspace, '.medol/medol.local.yml'), [
        'operations:',
        '  registry:',
        '    namespace: local',
        ''
    ].join('\n'));

    const operationsConfig = loadOperationsConfig(workspace, loadMedolWorkspace(workspace));
    const model = buildOperationsModel(sampleModel, operationsConfig);

    assert.deepEqual(loadMedolWorkspace(workspace).configPaths.map((file) => path.basename(file)), [
        'medol.yml',
        'medol.local.yml'
    ]);
    assert.equal(model.imagePrefix, 'registry.internal:5000/local');
    assert.equal(model.registry.insecure, true);
});

test('dedicated operations config isolates registry by environment', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-workspace-'));
    fs.mkdirSync(path.join(workspace, '.medol'));
    fs.mkdirSync(path.join(workspace, 'operations/config'), {recursive: true});
    fs.writeFileSync(path.join(workspace, '.medol/medol.local.yml'), 'operations:\n  registry:\n    host: old-registry:5000\n');
    fs.writeFileSync(path.join(workspace, 'operations/config/common.yml'), 'applications:\n  FederationService:\n    servicePort: 8081\n');
    fs.writeFileSync(path.join(workspace, 'operations/config/dev.private.yml'), 'registry:\n  host: dev-registry:5000\n  namespace: team\n');
    fs.writeFileSync(path.join(workspace, 'operations/config/prod.yml'), 'registry:\n  host: prod-registry:5000\n  namespace: team\n');
    const loaded = loadMedolWorkspace(workspace);
    assert.equal(loadOperationsConfig(workspace, loaded, 'dev').operations.registry.host, 'dev-registry:5000');
    assert.equal(loadOperationsConfig(workspace, loaded, 'prod').operations.registry.host, 'prod-registry:5000');
    assert.equal(loadOperationsConfig(workspace, loaded, 'test').operations.registry, undefined);
    assert.equal(loadOperationsConfig(workspace, loaded, 'local').operations.registry, undefined);
    assert.equal(loadOperationsConfig(workspace, loaded, 'test').operations.applications.FederationService.servicePort, 8081);
});

test('local environment renders each operations target in its own directory', () => {
    const model = buildOperationsModel(sampleModel);
    const files = generateOperationsFiles(model, {target: 'all', environment: 'local'});
    assert(files['operations/model/local/operations-model.json']);
    assert(files['operations/images/local/images.mjs']);
    assert(files['operations/apisix/local/apisix.yaml']);
    assert(files['operations/docker-compose/local/docker-compose.yml']);
    assert(files['operations/kubernetes/environments/local/kustomization.yaml']);
    assert(files['operations/k3s/environments/local/kustomization.yaml']);
    assert(files['operations/harbor/local/README.md']);
    assert(files['operations/zot/local/README.md']);
    const local = model.environments.find((environment) => environment.name === 'local');
    assert.equal(local.applicationOverrides['federation-service'].exposePorts, true);
});

test('pushes dependency mirrors under the registry root instead of the application namespace', () => {
    const model = buildOperationsModel(sampleModel, {
        operations: {
            registry: {
                host: 'registry.internal:5000',
                namespace: 'team',
                insecure: true
            }
        }
    });
    const script = generateOperationsFiles(model, { target: 'model', environment: 'dev' })['operations/images/dev/images.mjs'];

    assert.match(script, /const dependencyImagePrefix = String/);
    assert.match(script, /rancher\/mirrored-pause:3\.6/);
    assert.match(script, /rancher\/local-path-provisioner:v0\.0\.31/);
    assert.match(script, /rancher\/mirrored-library-busybox:1\.36\.1/);
    assert.match(script, /rancher\/mirrored-coredns-coredns:1\.12\.3/);
    assert.match(script, /rancher\/mirrored-metrics-server:v0\.8\.0/);
    assert.match(script, /defaultDependencyImagePrefix\(imagePrefix\)/);
    assert.doesNotMatch(script, /imagePrefix}\/dependencies/);
    assert.match(script, /--image', infrastructureImages\(\)\.join\(','\)/);
});

test('does not infer custom scheduling from application names', () => {
    const generatedModel = buildOperationsModel({
        domain: 'LearningPlatform',
        deployments: [{
            name: 'LearningSupport',
            title: 'Learning Support',
            contexts: [
                { name: 'SupportContext', title: 'Support Context' },
                { name: 'IdentityAccessManagement', title: 'Identity Access Management' }
            ]
        }, {
            name: 'LearningPlatform',
            title: 'Learning Platform',
            contexts: [{ name: 'RuntimeProvisioning', title: 'Runtime Provisioning' }]
        }, {
            name: 'LearningWorker',
            title: 'Learning Worker',
            contexts: [{ name: 'RuntimeAgentOperations', title: 'Runtime Agent Operations' }]
        }],
        contexts: []
    });
    const k3s = k3sFiles(generatedModel, { environmentName: 'staging' });

    assert(!k3s['operations/k3s/cluster/k3d-dev.yaml']);
    assert.doesNotMatch(k3s['operations/k3s/base/applications.yaml'], /serviceAccountName:/);
    assert.doesNotMatch(k3s['operations/k3s/base/applications.yaml'], /mountPath: "\/workspace\/datasets"/);
    assert.doesNotMatch(k3s['operations/k3s/environments/staging/configmap.yaml'], /PLATFORM_RUNTIME_K3S_NAMESPACE/);
    assert.doesNotMatch(k3s['operations/k3s/environments/staging/configmap.yaml'], /RUNTIME_AGENT_LOCAL_RUNTIME_ENGINE_MODE/);
    assert.doesNotMatch(k3s['operations/k3s/README.md'], /Platform-Managed Runtime Agent Startup/);
    assert.match(k3s['operations/k3s/environments/staging/configmap.yaml'], /name: "learning-support-staging-config"[\s\S]*MEDOL_SECURITY_ADMIN_BOOTSTRAP_ENABLED: "true"/);
    assert.doesNotMatch(k3s['operations/k3s/environments/staging/configmap.yaml'], /MEDOL_SECURITY_ALLOWED_ORIGINS/);
    assert.match(k3s['operations/k3s/environments/staging/secrets.example.yaml'], /name: "learning-support-staging-secret"[\s\S]*MEDOL_SECURITY_ADMIN_BOOTSTRAP_SETUP_TOKEN/);
});

test('renders browser CORS origins for the dev K3s gateway', () => {
    const generatedModel = buildOperationsModel({
        domain: 'FederationLearningPlatform',
        deployments: [{
            name: 'FederationLearningSupport',
            title: 'Federation Learning Support',
            contexts: [{ name: 'IdentityAccessManagement', title: 'Identity Access Management' }]
        }, {
            name: 'FederationLearningPlatform',
            title: 'Federation Learning Platform',
            contexts: [{ name: 'TrainingOrchestration', title: 'Training Orchestration' }]
        }],
        contexts: []
    });
    const k3s = k3sFiles(generatedModel, { environmentName: 'dev' });

    assert.match(
        k3s['operations/k3s/environments/dev/configmap.yaml'],
        /MEDOL_SECURITY_ALLOWED_ORIGINS: "http:\/\/localhost:\*,http:\/\/127\.0\.0\.1:\*,http:\/\/\*:30080"/
    );
    assert.match(
        k3s['operations/k3s/environments/dev/configmap.yaml'],
        /name: "federation-learning-platform-dev-config"[\s\S]*MEDOL_SECURITY_ALLOWED_ORIGINS: "http:\/\/localhost:\*,http:\/\/127\.0\.0\.1:\*,http:\/\/\*:30080"/
    );
    assert.match(k3s['operations/k3s/README.md'], /Administrator bootstrap is enabled by default/);
});

function golden(name) {
    return fs.readFileSync(path.join(__dirname, 'golden', name), 'utf8');
}
