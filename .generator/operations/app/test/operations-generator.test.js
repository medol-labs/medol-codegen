/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildOperationsModel, gatewayPathForApplication } = require('../operations-model-builder');
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
    assert.match(k3s['dev/k3s/cluster/k3d-dev.yaml'], /volume: "\.\.\/\.\.\/\.\.\/volumes\/datasets:\/workspace\/datasets"/);
    assert.match(k3s['dev/k3s/environments/dev/kustomization.yaml'], /configmap.yaml/);
    assert.match(k3s['dev/k3s/environments/dev/kustomization.yaml'], /patches\/federation-service-envfrom.yaml/);
    assert.doesNotMatch(k3s['dev/k3s/environments/dev/kustomization.yaml'], /secrets\.example\.yaml/);
    assert.match(k3s['dev/k3s/environments/dev/configmap.yaml'], /name: "federation-service-dev-config"/);
    assert.match(k3s['dev/k3s/environments/dev/configmap.yaml'], /SERVER_PORT: "8080"/);
    assert.match(k3s['dev/k3s/environments/dev/configmap.yaml'], /VITE_API_URL: "https:\/\/iwdfzvfqbtokqetmbmbp\.supabase\.co"/);
    assert.match(k3s['dev/k3s/environments/dev/configmap.yaml'], /VITE_FEDERATION_SERVICE_API_URL: "\/api\/federations"/);
    assert.match(k3s['dev/k3s/environments/dev/configmap.yaml'], /VITE_SUPABASE_API_KEY: ""/);
    assert.doesNotMatch(k3s['dev/k3s/base/applications.yaml'], /VITE_SUPABASE_API_KEY/);
    assert.match(k3s['dev/k3s/environments/dev/secrets.example.yaml'], /name: "postgres-secret"/);
    assert.doesNotMatch(k3s['dev/k3s/environments/dev/secrets.example.yaml'], /VITE_SUPABASE_API_KEY/);
    assert.match(k3s['dev/k3s/environments/dev/secrets.example.yaml'], /MEDOL_SECURITY_INTERNAL_TOKEN/);
    assert.match(k3s['dev/k3s/environments/dev/patches/federation-service-envfrom.yaml'], /envFrom:/);
    assert.match(k3s['dev/k3s/README.md'], /k3d cluster create --config cluster\/k3d-dev.yaml/);
    assert.match(k3s['dev/k3s/README.md'], /k3d node create <k3d-node-name>/);
    assert.match(k3s['dev/k3s/README.md'], /--k3s-node-label "medol\.dev\/node-role=runtime"/);
    assert.match(k3s['dev/k3s/README.md'], /--k3s-node-label "medol\.dev\/organization-id=<organization-id>"/);
    assert.match(k3s['dev/k3s/README.md'], /--k3s-node-label "medol\.dev\/runtime-infrastructure-id=<runtime-infrastructure-id>"/);
    assert.match(k3s['dev/k3s/README.md'], /medol\.dev\/runtime-infrastructure-id=<runtime-infrastructure-id>/);
    assert.match(k3s['dev/k3s/README.md'], /k3d image import <runtime-agent-image>/);
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
        k3s['dev/k3s/cluster/registries.yaml'],
        /"registry\.internal:5000":/
    );
    assert.match(
        k3s['dev/k3s/cluster/registries.yaml'],
        /"http:\/\/registry\.internal:5000"/
    );
});

test('renders K3s platform runtime-agent scheduler details when topology contains a platform and runtime agent', () => {
    const generatedModel = buildOperationsModel({
        domain: 'FederationLearningPlatform',
        deployments: [{
            name: 'FederationLearningSupport',
            title: 'Federation Learning Support',
            contexts: [
                { name: 'SupportContext', title: 'Support Context' },
                { name: 'IdentityAccessManagement', title: 'Identity Access Management' }
            ]
        }, {
            name: 'FederationLearningPlatform',
            title: 'Federation Learning Platform',
            contexts: [{ name: 'RuntimeProvisioning', title: 'Runtime Provisioning' }]
        }, {
            name: 'FederationLearningRuntimeAgent',
            title: 'Federation Learning Runtime Agent',
            contexts: [{ name: 'RuntimeAgentOperations', title: 'Runtime Agent Operations' }]
        }],
        contexts: []
    });
    const k3s = k3sFiles(generatedModel, { environmentName: 'staging' });

    assert(!k3s['staging/k3s/cluster/k3d-dev.yaml']);
    assert.match(k3s['staging/k3s/base/kustomization.yaml'], /runtime-agent-scheduler-rbac.yaml/);
    assert.match(k3s['staging/k3s/base/runtime-agent-scheduler-rbac.yaml'], /kind: "ServiceAccount"/);
    assert.match(k3s['staging/k3s/base/runtime-agent-scheduler-rbac.yaml'], /resources:\n\s+- "deployments"/);
    assert.match(k3s['staging/k3s/base/runtime-agent-scheduler-rbac.yaml'], /kind: "ClusterRole"/);
    assert.match(k3s['staging/k3s/base/runtime-agent-scheduler-rbac.yaml'], /resources:\n\s+- "nodes"/);
    assert.match(k3s['staging/k3s/base/runtime-agent-scheduler-rbac.yaml'], /name: "federation-learning-platform-runtime-engine-scheduler"/);
    assert.match(k3s['staging/k3s/base/applications.yaml'], /serviceAccountName: "federation-learning-platform-runtime-agent-scheduler"/);
    assert.match(k3s['staging/k3s/base/applications.yaml'], /serviceAccountName: "federation-learning-platform-runtime-engine-scheduler"/);
    assert.match(k3s['staging/k3s/base/applications.yaml'], /mountPath: "\/workspace\/datasets"/);
    assert.match(k3s['staging/k3s/environments/staging/configmap.yaml'], /PLATFORM_RUNTIME_K3S_NAMESPACE: "federation-learning-platform"/);
    assert.match(k3s['staging/k3s/environments/staging/configmap.yaml'], /PLATFORM_RUNTIME_K3S_AGENT_IMAGE: "medol\/federation-learning-runtime-agent:0.0.1-SNAPSHOT"/);
    assert.match(k3s['staging/k3s/environments/staging/configmap.yaml'], /RUNTIME_AGENT_LOCAL_RUNTIME_ENGINE_MODE: "kubernetes"/);
    assert.match(k3s['staging/k3s/README.md'], /no `kubectl` binary is required/);
    assert.match(k3s['staging/k3s/environments/staging/configmap.yaml'], /name: "federation-learning-support-staging-config"[\s\S]*MEDOL_SECURITY_ADMIN_BOOTSTRAP_ENABLED: "false"/);
    assert.doesNotMatch(k3s['staging/k3s/environments/staging/configmap.yaml'], /MEDOL_SECURITY_ALLOWED_ORIGINS/);
    assert.match(k3s['staging/k3s/environments/staging/secrets.example.yaml'], /name: "federation-learning-support-staging-secret"[\s\S]*MEDOL_SECURITY_ADMIN_BOOTSTRAP_SETUP_TOKEN/);
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
    assert.match(k3s['dev/k3s/README.md'], /Administrator bootstrap is disabled by default/);
});

function golden(name) {
    return fs.readFileSync(path.join(__dirname, 'golden', name), 'utf8');
}
