/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const { resolveDeploymentModel } = require('../environment-resolver');
const {
    indentBlock,
    renderDocuments,
    renderYaml
} = require('./yaml');
const {
    renderApisixConfig,
    renderApisixStandaloneConfig
} = require('./apisix-renderer');
const { renderPostgresInitSql } = require('./docker-compose-renderer');

function kubernetesFiles(model, options = {}) {
    const environmentName = options.environmentName ?? 'dev';
    return kubernetesLikeFiles(model, {
        root: trimRoot(options.root ?? `${environmentName}/kubernetes`),
        environmentName,
        gatewayServiceType: 'LoadBalancer',
        name: 'Kubernetes'
    });
}

function k3sFiles(model, options = {}) {
    const environmentName = options.environmentName ?? 'dev';
    return kubernetesLikeFiles(model, {
        root: trimRoot(options.root ?? `${environmentName}/k3s`),
        environmentName,
        gatewayServiceType: 'NodePort',
        name: 'K3s'
    });
}

function kubernetesLikeFiles(model, options) {
    const resolved = resolveDeploymentModel(model, options.environmentName);
    const resources = [
        'namespace.yaml',
        'infrastructure.yaml',
        'applications.yaml',
        'apisix-config.yaml',
        'apisix.yaml'
    ];
    if (hasPlatformRuntimeScheduler(resolved)) {
        resources.splice(3, 0, 'runtime-agent-scheduler-rbac.yaml');
    }
    const files = {};
    files[`${options.root}/base/kustomization.yaml`] = renderYaml({
        resources
    });
    files[`${options.root}/base/namespace.yaml`] = renderYaml({
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
            name: resolved.name
        }
    });
    files[`${options.root}/base/infrastructure.yaml`] = renderDocuments(infrastructureResources(resolved));
    files[`${options.root}/base/applications.yaml`] = renderDocuments(applicationResources(resolved));
    if (hasPlatformRuntimeScheduler(resolved)) {
        files[`${options.root}/base/runtime-agent-scheduler-rbac.yaml`] = renderDocuments(runtimeAgentSchedulerRbacResources(resolved));
    }
    files[`${options.root}/base/apisix-config.yaml`] = renderApisixConfigMap(resolved);
    files[`${options.root}/base/apisix.yaml`] = renderDocuments(apisixResources(resolved, options.gatewayServiceType));
    files[`${options.root}/environments/${options.environmentName}/kustomization.yaml`] = renderYaml({
        resources: ['../../base'],
        namespace: resolved.name,
        labels: [{
            pairs: {
                'app.kubernetes.io/part-of': resolved.name,
                'medol.dev/environment': options.environmentName
            },
            includeSelectors: true,
            includeTemplates: true
        }]
    });
    files[`${options.root}/README.md`] = renderKubernetesReadme(options.name);
    return files;
}

function infrastructureResources(model) {
    return model.infrastructure.filter((component) => component.enabled !== false).flatMap((component) => {
        if (component.type === 'postgres') return postgresResources(component, model);
        if (component.type === 'umadb') return statefulInfrastructure(component, '/data');
        if (component.type === 'axon-server') return axonServerResources(component);
        if (component.type === 'redis') return statefulInfrastructure(component, '/data');
        return [];
    });
}

function applicationResources(model) {
    const schedulerEnabled = hasPlatformRuntimeScheduler(model);
    return model.applications.flatMap((application) => {
        const platformApplication = schedulerEnabled && isPlatformApplication(model, application);
        const containers = [{
            name: application.name,
            image: application.image,
            ports: [{ containerPort: application.servicePort }],
            env: env(platformApplication
                ? [...application.environmentVariables, ...platformRuntimeSchedulerEnvironment(model, application)]
                : application.environmentVariables),
            ...(application.healthCheck ? probes(application.healthCheck, application.servicePort) : {})
        }];
        const podSpec = platformApplication
            ? { serviceAccountName: runtimeAgentSchedulerServiceAccountName(model) }
            : {};
        return [{
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: namedMetadata(application.name, application.kind),
            spec: {
                replicas: application.replicas,
                selector: selector(application.name),
                template: podTemplate(application, containers, [], podSpec)
            }
        },
        service(application.name, application.servicePort)
    ];
    });
}

function apisixResources(model, serviceType) {
    if (!model.gateway?.enabled) return [];
    const gateway = model.gateway;
    return [
        {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: namedMetadata(gateway.name, 'gateway'),
            spec: {
                replicas: 1,
                selector: selector(gateway.name),
                template: podTemplate({ name: gateway.name, kind: 'gateway' }, [{
                    name: gateway.name,
                    image: gateway.image,
                    ports: [{ containerPort: gateway.servicePort }],
                    volumeMounts: [
                        { name: 'apisix-config', mountPath: '/usr/local/apisix/conf/config.yaml', subPath: 'config.yaml', readOnly: true },
                        { name: 'apisix-config', mountPath: '/usr/local/apisix/conf/apisix.yaml', subPath: 'apisix.yaml', readOnly: true }
                    ]
                }], [{
                    name: 'apisix-config',
                    configMap: { name: 'apisix-config' }
                }])
            }
        },
        {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: namedMetadata(gateway.name, 'gateway'),
            spec: {
                type: serviceType,
                selector: { app: gateway.name },
                ports: [{
                    name: 'http',
                    port: gateway.servicePort,
                    targetPort: gateway.servicePort,
                    ...(serviceType === 'NodePort' ? { nodePort: 30080 } : {})
                }]
            }
        }
    ];
}

function renderApisixConfigMap(model) {
    return [
        'apiVersion: "v1"',
        'kind: "ConfigMap"',
        'metadata:',
        '  name: "apisix-config"',
        'data:',
        '  config.yaml: |',
        indentBlock(renderApisixConfig(model), 4),
        '  apisix.yaml: |',
        indentBlock(renderApisixStandaloneConfig(model), 4),
        ''
    ].join('\n');
}

function postgresResources(component, model) {
    const volumeName = kubernetesName(component.volumeName);
    return [
        {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: namedMetadata('postgres-init', 'infrastructure'),
            data: {
                '01-create-databases.sql': renderPostgresInitSql(model)
            }
        },
        {
            apiVersion: 'v1',
            kind: 'PersistentVolumeClaim',
            metadata: namedMetadata(volumeName, 'infrastructure'),
            spec: {
                accessModes: ['ReadWriteOnce'],
                resources: {
                    requests: {
                        storage: '1Gi'
                    }
                }
            }
        },
        {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: namedMetadata(component.name, 'infrastructure'),
            spec: {
                replicas: 1,
                selector: selector(component.name),
                template: podTemplate(component, [{
                    name: component.name,
                    image: component.image,
                    ports: [{ containerPort: component.servicePort }],
                    env: env([
                        { name: 'POSTGRES_USER', valueFromSecret: { name: 'postgres-secret', key: 'username' } },
                        { name: 'POSTGRES_PASSWORD', valueFromSecret: { name: 'postgres-secret', key: 'password' } },
                        { name: 'POSTGRES_DB', value: 'medol' }
                    ]),
                    volumeMounts: [
                        { name: volumeName, mountPath: '/var/lib/postgresql/data' },
                        { name: 'postgres-init', mountPath: '/docker-entrypoint-initdb.d', readOnly: true }
                    ]
                }], [
                    { name: volumeName, persistentVolumeClaim: { claimName: volumeName } },
                    { name: 'postgres-init', configMap: { name: 'postgres-init' } }
                ])
            }
        },
        service(component.name, component.servicePort)
    ];
}

function statefulInfrastructure(component, mountPath) {
    const volumeName = kubernetesName(component.volumeName);
    return [
        {
            apiVersion: 'v1',
            kind: 'PersistentVolumeClaim',
            metadata: namedMetadata(volumeName, 'infrastructure'),
            spec: {
                accessModes: ['ReadWriteOnce'],
                resources: {
                    requests: {
                        storage: '1Gi'
                    }
                }
            }
        },
        {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: namedMetadata(component.name, 'infrastructure'),
            spec: {
                replicas: 1,
                selector: selector(component.name),
                template: podTemplate(component, [{
                    name: component.name,
                    image: component.image,
                    ports: [{ containerPort: component.servicePort }],
                    volumeMounts: [{ name: volumeName, mountPath }]
                }], [{ name: volumeName, persistentVolumeClaim: { claimName: volumeName } }])
            }
        },
        service(component.name, component.servicePort)
    ];
}

function axonServerResources(component) {
    const volumeNames = (component.volumeNames ?? []).map(kubernetesName);
    return [
        ...volumeNames.map((volumeName) => ({
            apiVersion: 'v1',
            kind: 'PersistentVolumeClaim',
            metadata: namedMetadata(volumeName, 'infrastructure'),
            spec: {
                accessModes: ['ReadWriteOnce'],
                resources: {
                    requests: { storage: '1Gi' }
                }
            }
        })),
        {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: namedMetadata(component.name, 'infrastructure'),
            spec: {
                replicas: 1,
                selector: selector(component.name),
                template: podTemplate(component, [{
                    name: component.name,
                    image: component.image,
                    ports: [
                        { containerPort: component.servicePort },
                        { containerPort: component.managementPort }
                    ],
                    env: env(component.environmentVariables),
                    volumeMounts: [
                        { name: volumeNames[0], mountPath: '/axonserver/data' },
                        { name: volumeNames[1], mountPath: '/axonserver/events' }
                    ]
                }], volumeNames.map((volumeName) => ({
                    name: volumeName,
                    persistentVolumeClaim: { claimName: volumeName }
                })))
            }
        },
        service(component.name, component.servicePort, [
            { name: 'grpc', port: component.servicePort, targetPort: component.servicePort },
            { name: 'http', port: component.managementPort, targetPort: component.managementPort }
        ])
    ];
}

function runtimeAgentSchedulerRbacResources(model) {
    const serviceAccountName = runtimeAgentSchedulerServiceAccountName(model);
    return [
        {
            apiVersion: 'v1',
            kind: 'ServiceAccount',
            metadata: namedMetadata(serviceAccountName, 'runtime-agent-scheduler')
        },
        {
            apiVersion: 'rbac.authorization.k8s.io/v1',
            kind: 'Role',
            metadata: namedMetadata(serviceAccountName, 'runtime-agent-scheduler'),
            rules: [
                {
                    apiGroups: ['apps'],
                    resources: ['deployments'],
                    verbs: ['get', 'list', 'watch', 'create', 'patch', 'update']
                },
                {
                    apiGroups: [''],
                    resources: ['services', 'pods'],
                    verbs: ['get', 'list', 'watch', 'create', 'patch', 'update']
                }
            ]
        },
        {
            apiVersion: 'rbac.authorization.k8s.io/v1',
            kind: 'RoleBinding',
            metadata: namedMetadata(serviceAccountName, 'runtime-agent-scheduler'),
            subjects: [{
                kind: 'ServiceAccount',
                name: serviceAccountName
            }],
            roleRef: {
                apiGroup: 'rbac.authorization.k8s.io',
                kind: 'Role',
                name: serviceAccountName
            }
        }
    ];
}

function platformRuntimeSchedulerEnvironment(model, platformApplication) {
    const runtimeAgent = model.applications.find((application) => application.name.endsWith('-runtime-agent'));
    const support = model.applications.find((application) => application.name.endsWith('-support'));
    const runtimeAgentDatabaseUrl = envValue(runtimeAgent, 'DB_URL') ?? 'jdbc:postgresql://postgres:5432/federation_learning_runtime_agent';
    return [
        { name: 'PLATFORM_RUNTIME_K3S_NAMESPACE', value: model.name },
        { name: 'PLATFORM_RUNTIME_K3S_RENDERED_MANIFEST_DIRECTORY', value: '/tmp/runtime-agent-manifests' },
        { name: 'PLATFORM_RUNTIME_K3S_AGENT_DEPLOYMENT_NAME', value: `${runtimeAgent.name}-managed` },
        { name: 'PLATFORM_RUNTIME_K3S_AGENT_IMAGE', value: runtimeAgent.image },
        { name: 'PLATFORM_RUNTIME_K3S_AGENT_REPLICAS', value: '1' },
        { name: 'PLATFORM_RUNTIME_K3S_PLATFORM_URL', value: `http://${platformApplication.name}:${platformApplication.servicePort}` },
        { name: 'PLATFORM_RUNTIME_K3S_SUPPORT_URL', value: support ? `http://${support.name}:${support.servicePort}` : '' },
        { name: 'PLATFORM_RUNTIME_K3S_DATABASE_URL', value: runtimeAgentDatabaseUrl },
        { name: 'PLATFORM_RUNTIME_K3S_DATABASE_SECRET_NAME', value: 'postgres-secret' },
        { name: 'PLATFORM_RUNTIME_K3S_UMADB_TARGET', value: 'umadb:50051' },
        { name: 'PLATFORM_RUNTIME_K3S_ENDPOINT_SCOPE', value: 'CLUSTER' },
        { name: 'PLATFORM_RUNTIME_K3S_AGENT_VERSION', value: 'k3s' }
    ];
}

function envValue(application, name) {
    return application?.environmentVariables.find((variable) => variable.name === name)?.value;
}

function hasPlatformRuntimeScheduler(model) {
    return model.applications.some((application) => isPlatformApplication(model, application))
        && model.applications.some((application) => application.name.endsWith('-runtime-agent'));
}

function isPlatformApplication(model, application) {
    return application.kind === 'backend' && application.name === model.name;
}

function runtimeAgentSchedulerServiceAccountName(model) {
    return kubernetesName(`${model.name}-runtime-agent-scheduler`);
}

function podTemplate(owner, containers, volumes = [], spec = {}) {
    return {
        metadata: {
            labels: { app: owner.name }
        },
        spec: {
            ...spec,
            containers,
            ...(volumes.length ? { volumes } : {})
        }
    };
}

function service(name, port, ports) {
    return {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: namedMetadata(name, 'service'),
        spec: {
            type: 'ClusterIP',
            selector: { app: name },
            ports: ports ?? [{
                name: 'http',
                port,
                targetPort: port
            }]
        }
    };
}

function probes(healthCheck, port) {
    const probe = {
        httpGet: {
            path: healthCheck.path,
            port
        },
        periodSeconds: healthCheck.intervalSeconds,
        timeoutSeconds: healthCheck.timeoutSeconds,
        failureThreshold: healthCheck.retries,
        ...(healthCheck.startPeriodSeconds ? { initialDelaySeconds: healthCheck.startPeriodSeconds } : {})
    };
    return {
        readinessProbe: probe,
        livenessProbe: probe
    };
}

function env(variables = []) {
    return variables.map((variable) => {
        if (variable.valueFromSecret) {
            return {
                name: variable.name,
                valueFrom: {
                    secretKeyRef: variable.valueFromSecret
                }
            };
        }
        if (variable.name === 'DB_USERNAME') {
            return {
                name: variable.name,
                valueFrom: {
                    secretKeyRef: {
                        name: 'postgres-secret',
                        key: 'username'
                    }
                }
            };
        }
        if (variable.name === 'DB_PASSWORD') {
            return {
                name: variable.name,
                valueFrom: {
                    secretKeyRef: {
                        name: 'postgres-secret',
                        key: 'password'
                    }
                }
            };
        }
        return {
            name: variable.name,
            value: kubernetesLiteralValue(variable.value)
        };
    });
}

function kubernetesLiteralValue(value) {
    const text = String(value ?? '');
    const defaultMatch = text.match(/^\$\{[A-Z0-9_]+:-(.*)}$/);
    if (defaultMatch) return defaultMatch[1];
    if (/^\$\{[A-Z0-9_]+:\?.*}$/.test(text)) return '';
    return text;
}

function selector(name) {
    return {
        matchLabels: {
            app: name
        }
    };
}

function namedMetadata(name, component) {
    const resourceName = kubernetesName(name);
    return {
        name: resourceName,
        labels: {
            'app.kubernetes.io/name': resourceName,
            'app.kubernetes.io/component': component,
            'app.kubernetes.io/managed-by': 'medol-deploy-generator'
        }
    };
}

function renderKubernetesReadme(name) {
    const isK3s = name.toLowerCase() === 'k3s';
    const gatewayExposure = isK3s
        ? 'APISIX is exposed with a NodePort service on `30080`, so the default entrypoint is `http://<node-ip>:30080/`.'
        : 'APISIX is exposed with a LoadBalancer service. Use the external address assigned by your cluster or cloud provider.';
    const applyTarget = isK3s
        ? 'kubectl apply -k environments/<environment>'
        : 'kubectl apply -k environments/<environment>';
    return [
        `# ${name} Deployment`,
        '',
        'Generated by the Medol deploy generator.',
        '',
        'The base manifests are generator-owned. Environment directories reference the base and are the intended place for Kustomize patches.',
        '',
        '## Topology',
        '',
        '- `console` serves the generated Refine frontend.',
        '- `federation-learning-support`, `federation-learning-platform`, and `federation-learning-runtime-agent` run the Spring Boot backend modules.',
        '- `postgres` stores read models, projection tables, tokens, and support data.',
        '- `umadb` is the default event store endpoint used by the generated backend modules.',
        '- `apisix` is the external gateway and rewrites `/api/<module>/*` paths to internal backend services.',
        '',
        '## Generated Files',
        '',
        '- `base/namespace.yaml` creates the namespace.',
        '- `base/infrastructure.yaml` creates Postgres, UmaDB, their PVCs, and the Postgres database initialization ConfigMap.',
        '- `base/applications.yaml` creates the frontend and backend Deployments and Services.',
        '- `base/runtime-agent-scheduler-rbac.yaml` is generated when the topology contains a platform backend and runtime-agent module. It lets the platform create platform-managed runtime-agent Deployments and Services inside the application namespace.',
        '- `base/apisix-config.yaml` contains standalone APISIX declarative route configuration.',
        '- `base/apisix.yaml` creates the APISIX Deployment and Service.',
        '- `environments/<environment>/kustomization.yaml` selects the base and attaches environment labels.',
        '',
        '## Before Applying',
        '',
        'Build or import these images on every node that may run the workloads:',
        '',
        '```bash',
        'medol/federation-learning-platform-console:0.0.1-SNAPSHOT',
        'medol/federation-learning-support:0.0.1-SNAPSHOT',
        'medol/federation-learning-platform:0.0.1-SNAPSHOT',
        'medol/federation-learning-runtime-agent:0.0.1-SNAPSHOT',
        'postgres:16',
        'umadb/umadb:0.7.8',
        'apache/apisix:3.13.0-debian',
        '```',
        '',
        'For local k3s image testing, import image archives into containerd:',
        '',
        '```bash',
        'sudo k3s ctr images import federation-learning-platform-images.tar',
        'sudo k3s ctr images import dependency-images.tar',
        '```',
        '',
        'Create real Kubernetes Secret objects outside the generator-owned base manifests. At minimum, the generated workloads require `postgres-secret`:',
        '',
        '```bash',
        'kubectl create namespace federation-learning-platform --dry-run=client -o yaml | kubectl apply -f -',
        'kubectl -n federation-learning-platform create secret generic postgres-secret \\',
        '  --from-literal=username=medol \\',
        '  --from-literal=password=<change-me>',
        '```',
        '',
        'When security, internal service tokens, Portal SSO, or external registries are enabled, add those secrets as environment-specific Kustomize patches rather than editing `base/*.yaml` directly.',
        '',
        '## Apply',
        '',
        '```bash',
        applyTarget,
        'kubectl -n federation-learning-platform get pods,svc,pvc',
        '```',
        '',
        gatewayExposure,
        '',
        'Default routes:',
        '',
        '- `/` -> `console`',
        '- `/api/federation-learning-support/*` -> `federation-learning-support`',
        '- `/api/federation-learning-platform/*` -> `federation-learning-platform`',
        '- `/api/federation-learning-runtime-agent/*` -> `federation-learning-runtime-agent`',
        '',
        '## Validation',
        '',
        '```bash',
        'kubectl -n federation-learning-platform rollout status deploy/postgres',
        'kubectl -n federation-learning-platform rollout status deploy/umadb',
        'kubectl -n federation-learning-platform rollout status deploy/federation-learning-support',
        'kubectl -n federation-learning-platform rollout status deploy/federation-learning-platform',
        'kubectl -n federation-learning-platform rollout status deploy/federation-learning-runtime-agent',
        'kubectl -n federation-learning-platform rollout status deploy/console',
        'kubectl -n federation-learning-platform rollout status deploy/apisix',
        'curl -fsS http://<gateway-host>/api/federation-learning-support/actuator/health',
        'curl -fsS http://<gateway-host>/api/federation-learning-platform/actuator/health',
        'curl -fsS http://<gateway-host>/api/federation-learning-runtime-agent/actuator/health',
        '```',
        '',
        'For k3s with the generated NodePort, replace `<gateway-host>` with `<node-ip>:30080`.',
        '',
        '## Platform-Managed Runtime Agent Startup',
        '',
        'The generated topology supports two runtime-agent modes:',
        '',
        '- The `federation-learning-runtime-agent` Deployment in `base/applications.yaml` is the always-on development agent used for smoke tests and local integration.',
        '- Runtime provisioning with `agentInstallMode=PLATFORM_MANAGED` is scheduled by the platform after runtime infrastructure verification. The platform renders a per-runtime manifest, runs `kubectl apply`, waits for the generated Deployment rollout, and the started agent reports its connection back to the platform.',
        '',
        'For K3s, the platform Deployment receives these scheduler settings:',
        '',
        '```bash',
        'PLATFORM_RUNTIME_K3S_NAMESPACE=federation-learning-platform',
        'PLATFORM_RUNTIME_K3S_RENDERED_MANIFEST_DIRECTORY=/tmp/runtime-agent-manifests',
        'PLATFORM_RUNTIME_K3S_AGENT_DEPLOYMENT_NAME=federation-learning-runtime-agent-managed',
        'PLATFORM_RUNTIME_K3S_AGENT_IMAGE=medol/federation-learning-runtime-agent:0.0.1-SNAPSHOT',
        'PLATFORM_RUNTIME_K3S_PLATFORM_URL=http://federation-learning-platform:8081',
        'PLATFORM_RUNTIME_K3S_SUPPORT_URL=http://federation-learning-support:8080',
        'PLATFORM_RUNTIME_K3S_DATABASE_URL=jdbc:postgresql://postgres:5432/federation_learning_runtime_agent',
        'PLATFORM_RUNTIME_K3S_DATABASE_SECRET_NAME=postgres-secret',
        'PLATFORM_RUNTIME_K3S_UMADB_TARGET=umadb:50051',
        'PLATFORM_RUNTIME_K3S_ENDPOINT_SCOPE=CLUSTER',
        '```',
        '',
        'The platform-generated runtime-agent Deployment injects these bootstrap values from the installation plan:',
        '',
        '```bash',
        'RUNTIME_AGENT_ID=<runtimeAgentId>',
        'RUNTIME_INFRASTRUCTURE_ID=<runtimeInfrastructureId>',
        'RUNTIME_AGENT_VERSION=<configured-agent-version>',
        'RUNTIME_AGENT_INSTALL_MODE=PLATFORM_MANAGED',
        'RUNTIME_AGENT_ORGANIZATION_ID=<organizationId>',
        'RUNTIME_AGENT_RUNTIME_NAME=<runtimeName>',
        'RUNTIME_AGENT_ENDPOINT=http://<generated-agent-service>:8082',
        'RUNTIME_AGENT_ENDPOINT_SCOPE=CLUSTER',
        '```',
        '',
        'The platform must be able to execute `kubectl`. In development you can run the platform outside the cluster with a local kubeconfig. For in-cluster execution, use the generated `ServiceAccount`, `Role`, and `RoleBinding` from `runtime-agent-scheduler-rbac.yaml`, and build or extend the platform image so `PLATFORM_RUNTIME_K3S_KUBECTL_EXECUTABLE` points to an available kubectl binary.',
        '',
        'A managed agent is named with the configured prefix plus a short runtime-agent id suffix, for example `federation-learning-runtime-agent-managed-000000000000`. This keeps platform-managed agents separate from the always-on development agent.',
        '',
        'This completes platform-side runtime-agent startup. Round execution still depends on the runtime-agent `local-runtime-engine` adapter; for pure K3s training execution, add a Kubernetes Job or service-backed runtime-engine adapter and set the runtime-agent engine endpoint accordingly.',
        '',
        '## Postgres Initialization',
        '',
        'The generated `postgres-init` ConfigMap creates one database per backend module on first Postgres container initialization:',
        '',
        '- `federation_learning_support`',
        '- `federation_learning_platform`',
        '- `federation_learning_runtime_agent`',
        '',
        'This follows the same initialization behavior as Docker Compose. If the Postgres PVC already exists, the official Postgres image will not rerun `/docker-entrypoint-initdb.d`; create missing databases manually or recreate the PVC during a disposable development reset.',
        '',
        '## Development Reset',
        '',
        'For a disposable development cluster only:',
        '',
        '```bash',
        'kubectl delete -k environments/<environment>',
        'kubectl -n federation-learning-platform delete pvc postgres-data umadb-data --ignore-not-found',
        '```',
        '',
        'Do not delete PVCs in staging or production unless data loss is intentional and separately approved.',
        '',
        '## Notes',
        '',
        '- The generator does not provision k3s nodes, storage classes, registry credentials, TLS certificates, or DNS.',
        '- The default k3s service exposure is intentionally simple: APISIX NodePort first, Ingress/Gateway API later.',
        '- Kustomize overlays are the right place for image tags, replica counts, resources, storage class names, node selectors, tolerations, registry pull secrets, and TLS-specific gateway changes.',
        ''
    ].join('\n');
}

module.exports = {
    k3sFiles,
    kubernetesFiles
};

function trimRoot(value) {
    return String(value ?? '').replace(/^\/+|\/+$/g, '') || '.';
}

function kubernetesName(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'medol';
}
