/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildDeploymentModel, gatewayPathForApplication } = require('../deployment-model-builder');
const { generateDeployFiles } = require('../deploy-generator');
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

test('builds deployment model applications, infrastructure, gateway, and environment defaults', () => {
    const model = buildDeploymentModel(sampleModel);

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
    const model = buildDeploymentModel(sampleModel, {
        deployment: {
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
    const model = buildDeploymentModel(sampleModel);
    const actual = renderApisixStandaloneConfig(model);
    const expected = golden('apisix.yaml');
    assert.equal(actual, expected);
});

test('renders Docker Compose topology with gateway, applications, infrastructure, and volumes', () => {
    const model = buildDeploymentModel(sampleModel);
    const actual = renderDockerCompose(model, 'dev');
    const expected = golden('docker-compose.yml');
    assert.equal(actual, expected);
});

test('generates deployment target file sets', () => {
    const model = buildDeploymentModel(sampleModel);
    const files = generateDeployFiles(model, { target: 'all', environment: 'dev' });
    assert(files['dev/deployment-model.json']);
    assert(files['dev/infrastructure/apisix/apisix.yaml']);
    assert(files['dev/docker-compose/docker-compose.yml']);
    assert(files['dev/.env-example']);
    assert(files['dev/kubernetes/base/applications.yaml']);
    assert(files['dev/kubernetes/environments/dev/kustomization.yaml']);
    assert(files['dev/kubernetes/environments/dev/configmap.yaml']);
    assert(files['dev/kubernetes/environments/dev/secrets.example.yaml']);
    assert(files['dev/kubernetes/environments/dev/patches/federation-service-envfrom.yaml']);
    assert(!files['dev/kubernetes/environments/prod/kustomization.yaml']);
    assert(files['dev/k3s/base/apisix.yaml']);
    assert(files['dev/k3s/cluster/k3d-dev.yaml']);
});

test('renders Kubernetes and K3s manifests from the same deployment model', () => {
    const model = buildDeploymentModel(sampleModel);
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
    assert.match(k3s['dev/k3s/cluster/k3d-dev.yaml'], /port: "30080:30080"/);
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
    assert.match(k3s['dev/k3s/README.md'], /NodePort service on `30080`/);
    assert.match(kubernetes['dev/kubernetes/base/apisix-config.yaml'], /apisix.yaml: \|/);
    assert(!kubernetes['dev/kubernetes/cluster/k3d-dev.yaml']);
});

test('renders K3s platform runtime-agent scheduler details when topology contains a platform and runtime agent', () => {
    const generatedModel = buildDeploymentModel({
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
    assert.match(k3s['staging/k3s/base/applications.yaml'], /serviceAccountName: "federation-learning-platform-runtime-agent-scheduler"/);
    assert.match(k3s['staging/k3s/environments/staging/configmap.yaml'], /PLATFORM_RUNTIME_K3S_NAMESPACE: "federation-learning-platform"/);
    assert.match(k3s['staging/k3s/environments/staging/configmap.yaml'], /PLATFORM_RUNTIME_K3S_AGENT_IMAGE: "medol\/federation-learning-runtime-agent:0.0.1-SNAPSHOT"/);
    assert.match(k3s['staging/k3s/environments/staging/configmap.yaml'], /name: "federation-learning-support-staging-config"[\s\S]*MEDOL_SECURITY_ADMIN_BOOTSTRAP_ENABLED: "false"/);
    assert.match(k3s['staging/k3s/environments/staging/secrets.example.yaml'], /name: "federation-learning-support-staging-secret"[\s\S]*MEDOL_SECURITY_ADMIN_BOOTSTRAP_SETUP_TOKEN/);
});

function golden(name) {
    return fs.readFileSync(path.join(__dirname, 'golden', name), 'utf8');
}
