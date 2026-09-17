/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const assert = require('node:assert/strict');
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
    const script = generateOperationsFiles(model, { target: 'model', environment: 'dev' })['operations/dev/images.mjs'];

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
    assert(files['operations/dev/operations-model.json']);
    assert(files['operations/dev/infrastructure/apisix/apisix.yaml']);
    assert(files['operations/dev/images.mjs']);
    assert.match(files['operations/dev/images.mjs'], /node operations\/dev\/images\.mjs package/);
    assert.match(files['operations/dev/images.mjs'], /--exclude-service <name\[,name\]>/);
    assert.match(files['operations/dev/images.mjs'], /projectImageArgs\(project\)/);
    assert.doesNotMatch(files['operations/dev/images.mjs'], /runtime-engine-images|RUNTIME_ENGINE_ROOT|skip-runtime-engine/);
    assert(files['operations/dev/docker-compose/docker-compose.yml']);
    assert(files['operations/dev/.env-example']);
    assert(files['operations/dev/kubernetes/base/applications.yaml']);
    assert(files['operations/dev/kubernetes/environments/dev/kustomization.yaml']);
    assert(files['operations/dev/kubernetes/environments/dev/configmap.yaml']);
    assert(files['operations/dev/kubernetes/environments/dev/secrets.example.yaml']);
    assert(files['operations/dev/kubernetes/environments/dev/patches/federation-service-envfrom.yaml']);
    assert(!files['operations/dev/kubernetes/environments/prod/kustomization.yaml']);
    assert(files['operations/dev/k3s/base/apisix.yaml']);
    assert(files['operations/dev/k3s/cluster/k3d-dev.yaml']);
    assert(files['operations/dev/k3s/scripts/k3d-dev.sh']);
    assert.match(files['operations/dev/k3s/scripts/k3d-dev.sh'], /CLUSTER_NAME="\$\{CLUSTER_NAME:-learning-platform-dev\}"/);
    assert.match(files['operations/dev/k3s/scripts/k3d-dev.sh'], /PRE_APPLY_FILE="\$\{PRE_APPLY_FILE:-\}"/);
    assert.match(files['operations/dev/k3s/scripts/k3d-dev.sh'], /kubectl -n "\$\{NAMESPACE\}" apply -f "\$\{PRE_APPLY_FILE\}"/);
    assert.match(files['operations/dev/k3s/scripts/k3d-dev.sh'], /kubectl -n "\$\{NAMESPACE\}" rollout restart/);
    assert(files['operations/dev/harbor/README.md']);
    assert(files['operations/dev/harbor/.env-example']);
    assert(files['operations/dev/harbor/harbor.yml-example']);
    assert(files['operations/dev/harbor/install-harbor.mjs']);
    assert(files['operations/dev/zot/README.md']);
    assert(files['operations/dev/zot/.env-example']);
    assert(files['operations/dev/zot/docker-compose.yml']);
    assert(files['operations/dev/zot/config.json']);
});

test('renders Kubernetes and K3s manifests from the same operations model', () => {
    const model = buildOperationsModel(sampleModel);
    const kubernetes = kubernetesFiles(model);
    const k3s = k3sFiles(model);

    assert.match(kubernetes['dev/kubernetes/base/applications.yaml'], /kind: "Deployment"/);
    assert.match(kubernetes['dev/kubernetes/base/applications.yaml'], /secretKeyRef/);
    assert.doesNotMatch(kubernetes['dev/kubernetes/base/applications.yaml'], /\$\{/);
    assert.doesNotMatch(kubernetes['dev/kubernetes/base/infrastructure.yaml'], /name: "axon-server"/);
    assert.match(kubernetes['dev/kubernetes/base/infrastructure.yaml'], /name: "postgres-init"/);
    assert.match(kubernetes['dev/kubernetes/base/infrastructure.yaml'], /name: "postgres-data"/);
    assert.doesNotMatch(kubernetes['dev/kubernetes/base/infrastructure.yaml'], /postgres_data|umadb_data/);
    assert.match(kubernetes['dev/kubernetes/base/apisix.yaml'], /type: "LoadBalancer"/);
    assert.match(k3s['dev/k3s/base/apisix.yaml'], /type: "NodePort"/);
    assert.match(k3s['dev/k3s/cluster/k3d-dev.yaml'], /apiVersion: "k3d.io\/v1alpha5"/);
    assert.match(k3s['dev/k3s/cluster/k3d-dev.yaml'], /name: "learning-platform-dev"/);
    assert.match(k3s['dev/k3s/cluster/k3d-dev.yaml'], /image: "rancher\/k3s:v1.33.5-k3s1"/);
    assert(!k3s['dev/k3s/cluster/registries.yaml']);
    assert.match(k3s['dev/k3s/cluster/k3d-dev.yaml'], /port: "30080:30080"/);
    assert.doesNotMatch(k3s['dev/k3s/cluster/k3d-dev.yaml'], /\/workspace\/datasets/);
    assert.doesNotMatch(k3s['dev/k3s/cluster/k3d-dev.yaml'], /\/workspace\/tmp\/runtime-engine/);
    assert.match(k3s['dev/k3s/environments/dev/kustomization.yaml'], /configmap.yaml/);
    assert.match(k3s['dev/k3s/environments/dev/kustomization.yaml'], /patches\/federation-service-envfrom.yaml/);
    assert.doesNotMatch(k3s['dev/k3s/environments/dev/kustomization.yaml'], /secrets\.example\.yaml/);
    assert.match(k3s['dev/k3s/environments/dev/configmap.yaml'], /name: "federation-service-dev-config"/);
    assert.match(k3s['dev/k3s/environments/dev/configmap.yaml'], /SERVER_PORT: "8080"/);
    assert.match(k3s['dev/k3s/environments/dev/configmap.yaml'], /MEDOL_SYNC_ENABLED: "true"/);
    assert.match(k3s['dev/k3s/environments/dev/configmap.yaml'], /MEDOL_SYNC_MODE: "outbox-delta"/);
    assert.match(k3s['dev/k3s/environments/dev/configmap.yaml'], /MEDOL_SYNC_SOURCE_BASE_URL: ""/);
    assert.match(k3s['dev/k3s/environments/dev/configmap.yaml'], /VITE_API_URL: "https:\/\/iwdfzvfqbtokqetmbmbp\.supabase\.co"/);
    assert.match(k3s['dev/k3s/environments/dev/configmap.yaml'], /VITE_FEDERATION_SERVICE_API_URL: "\/api\/federations"/);
    assert.match(k3s['dev/k3s/environments/dev/configmap.yaml'], /VITE_SUPABASE_API_KEY: ""/);
    assert.doesNotMatch(k3s['dev/k3s/base/applications.yaml'], /VITE_SUPABASE_API_KEY/);
    assert.match(k3s['dev/k3s/environments/dev/secrets.example.yaml'], /name: "postgres-secret"/);
    assert.doesNotMatch(k3s['dev/k3s/environments/dev/secrets.example.yaml'], /VITE_SUPABASE_API_KEY/);
    assert.match(k3s['dev/k3s/environments/dev/secrets.example.yaml'], /MEDOL_SECURITY_INTERNAL_TOKEN/);
    assert.match(k3s['dev/k3s/environments/dev/patches/federation-service-envfrom.yaml'], /envFrom:/);
    assert.match(k3s['dev/k3s/README.md'], /k3d cluster create --config cluster\/k3d-dev.yaml/);
    assert.match(k3s['dev/k3s/README.md'], /project-specific Kubernetes extensions in a separate overlay/);
    assert.doesNotMatch(k3s['dev/k3s/README.md'], /runtime-agent-scheduler-rbac/);
    assert.doesNotMatch(k3s['dev/k3s/README.md'], /medol\.dev\/runtime-infrastructure-id/);
    assert.match(k3s['dev/k3s/README.md'], /cp environments\/<environment>\/secrets\.example\.yaml environments\/<environment>\/secrets\.<environment>\.yaml/);
    assert.match(k3s['dev/k3s/README.md'], /apply -f environments\/<environment>\/secrets\.<environment>\.yaml/);
    assert.match(k3s['dev/k3s/README.md'], /must not be committed/);
    assert.match(k3s['dev/k3s/README.md'], /NodePort service on `30080`/);
    assert.match(kubernetes['dev/kubernetes/base/apisix-config.yaml'], /apisix.yaml: \|/);
    assert(!kubernetes['dev/kubernetes/cluster/k3d-dev.yaml']);
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
        k3s['dev/k3s/base/applications.yaml'],
        /image: "medol\/federation-service:0\.0\.1-SNAPSHOT"/
    );
    assert.match(
        k3s['dev/k3s/environments/dev-registry/kustomization.yaml'],
        /newName: "registry\.internal:5000\/team\/federation-service"/
    );
    assert.match(
        k3s['dev/k3s/environments/dev-registry/kustomization.yaml'],
        /path: "image-pull-policy\.yaml"/
    );
    assert.match(
        k3s['dev/k3s/environments/dev-registry/image-pull-policy.yaml'],
        /path: "\/spec\/template\/spec\/containers\/0\/imagePullPolicy"/
    );
    assert.match(
        k3s['dev/k3s/environments/dev-registry/image-pull-policy.yaml'],
        /value: "Always"/
    );
    assert.match(
        k3s['dev/k3s/cluster/registries.yaml'],
        /"registry\.internal:5000":/
    );
    assert.match(
        k3s['dev/k3s/cluster/registries.yaml'],
        /"docker\.io":/
    );
    assert.match(
        k3s['dev/k3s/cluster/registries.yaml'],
        /"http:\/\/registry\.internal:5000"/
    );
    assert.match(
        generateOperationsFiles(model, { target: 'model', environment: 'dev' })['operations/dev/images.mjs'],
        /DOCKER_IMAGE_PREFIX \?\? 'registry\.internal:5000\/team'/
    );
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
    const script = generateOperationsFiles(model, { target: 'model', environment: 'dev' })['operations/dev/images.mjs'];

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

    assert(!k3s['staging/k3s/cluster/k3d-dev.yaml']);
    assert.doesNotMatch(k3s['staging/k3s/base/applications.yaml'], /serviceAccountName:/);
    assert.doesNotMatch(k3s['staging/k3s/base/applications.yaml'], /mountPath: "\/workspace\/datasets"/);
    assert.doesNotMatch(k3s['staging/k3s/environments/staging/configmap.yaml'], /PLATFORM_RUNTIME_K3S_NAMESPACE/);
    assert.doesNotMatch(k3s['staging/k3s/environments/staging/configmap.yaml'], /RUNTIME_AGENT_LOCAL_RUNTIME_ENGINE_MODE/);
    assert.doesNotMatch(k3s['staging/k3s/README.md'], /Platform-Managed Runtime Agent Startup/);
    assert.match(k3s['staging/k3s/environments/staging/configmap.yaml'], /name: "learning-support-staging-config"[\s\S]*MEDOL_SECURITY_ADMIN_BOOTSTRAP_ENABLED: "true"/);
    assert.doesNotMatch(k3s['staging/k3s/environments/staging/configmap.yaml'], /MEDOL_SECURITY_ALLOWED_ORIGINS/);
    assert.match(k3s['staging/k3s/environments/staging/secrets.example.yaml'], /name: "learning-support-staging-secret"[\s\S]*MEDOL_SECURITY_ADMIN_BOOTSTRAP_SETUP_TOKEN/);
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
        k3s['dev/k3s/environments/dev/configmap.yaml'],
        /MEDOL_SECURITY_ALLOWED_ORIGINS: "http:\/\/localhost:\*,http:\/\/127\.0\.0\.1:\*,http:\/\/\*:30080"/
    );
    assert.match(
        k3s['dev/k3s/environments/dev/configmap.yaml'],
        /name: "federation-learning-platform-dev-config"[\s\S]*MEDOL_SECURITY_ALLOWED_ORIGINS: "http:\/\/localhost:\*,http:\/\/127\.0\.0\.1:\*,http:\/\/\*:30080"/
    );
    assert.match(k3s['dev/k3s/README.md'], /Administrator bootstrap is enabled by default/);
});

function golden(name) {
    return fs.readFileSync(path.join(__dirname, 'golden', name), 'utf8');
}
