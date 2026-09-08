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
        resources: [
            '../../base',
            'configmap.yaml'
        ],
        namespace: resolved.name,
        labels: [{
            pairs: {
                'app.kubernetes.io/part-of': resolved.name,
                'medol.dev/environment': options.environmentName
            },
            includeSelectors: true,
            includeTemplates: true
        }],
        patches: environmentPatchFiles(resolved).map((file) => ({ path: file }))
    });
    files[`${options.root}/environments/${options.environmentName}/configmap.yaml`] = renderDocuments(environmentConfigMaps(resolved, options));
    files[`${options.root}/environments/${options.environmentName}/secrets.example.yaml`] = renderDocuments(environmentSecretExamples(resolved, options.environmentName));
    environmentPatches(resolved).forEach((patch) => {
        files[`${options.root}/environments/${options.environmentName}/${patch.file}`] = renderYaml(patch.document);
    });
    if (options.name.toLowerCase() === 'k3s' && options.environmentName === 'dev') {
        files[`${options.root}/cluster/k3d-dev.yaml`] = renderK3dClusterConfig(resolved);
    }
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
        const baseEnv = env(applicationBaseEnvironmentVariables(model, application));
        const containers = [{
            name: application.name,
            image: application.image,
            ports: [{ containerPort: application.servicePort }],
            ...(baseEnv.length ? { env: baseEnv } : {}),
            ...(application.healthCheck ? probes(application.healthCheck, application.servicePort) : {})
        }];
        const platformApplication = schedulerEnabled && isPlatformApplication(model, application);
        const runtimeAgentApplication = schedulerEnabled && isRuntimeAgentApplication(application);
        if (runtimeAgentApplication) {
            containers[0].volumeMounts = [
                { name: 'runtime-datasets', mountPath: '/workspace/datasets', readOnly: true },
                { name: 'runtime-work', mountPath: '/workspace/tmp/runtime-engine' }
            ];
        }
        const podSpec = platformApplication
            ? { serviceAccountName: runtimeAgentSchedulerServiceAccountName(model) }
            : runtimeAgentApplication
                ? { serviceAccountName: runtimeEngineSchedulerServiceAccountName(model) }
                : {};
        const volumes = runtimeAgentApplication ? [
            { name: 'runtime-datasets', hostPath: { path: '/workspace/datasets', type: 'Directory' } },
            { name: 'runtime-work', hostPath: { path: '/workspace/tmp/runtime-engine', type: 'DirectoryOrCreate' } }
        ] : [];
        return [{
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: namedMetadata(application.name, application.kind),
            spec: {
                replicas: application.replicas,
                selector: selector(application.name),
                template: podTemplate(application, containers, volumes, podSpec)
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

function renderK3dClusterConfig(model) {
    return renderYaml({
        apiVersion: 'k3d.io/v1alpha5',
        kind: 'Simple',
        metadata: {
            name: `${model.name}-dev`
        },
        image: 'rancher/k3s:v1.33.5-k3s1',
        servers: 1,
        agents: 2,
        kubeAPI: {
            hostIP: '127.0.0.1',
            hostPort: '6550'
        },
        ports: [{
            port: '30080:30080',
            nodeFilters: ['server:0']
        }],
        volumes: [{
            volume: '../../../volumes/datasets:/workspace/datasets',
            nodeFilters: ['agent:*']
        }, {
            volume: '../../../volumes/tmp/runtime-engine:/workspace/tmp/runtime-engine',
            nodeFilters: ['agent:*']
        }],
        options: {
            k3d: {
                wait: true,
                timeout: '120s'
            },
            k3s: {
                extraArgs: [{
                    arg: '--disable=traefik',
                    nodeFilters: ['server:*']
                }]
            }
        }
    });
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
    const runtimeEngineServiceAccountName = runtimeEngineSchedulerServiceAccountName(model);
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
                    verbs: ['get', 'list', 'watch', 'create', 'patch', 'update', 'delete']
                },
                {
                    apiGroups: [''],
                    resources: ['services', 'pods'],
                    verbs: ['get', 'list', 'watch', 'create', 'patch', 'update', 'delete']
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
        },
        {
            apiVersion: 'rbac.authorization.k8s.io/v1',
            kind: 'ClusterRole',
            metadata: namedMetadata(`${serviceAccountName}-node-reader`, 'runtime-infrastructure-verifier'),
            rules: [{ apiGroups: [''], resources: ['nodes'], verbs: ['get', 'list', 'watch'] }]
        },
        {
            apiVersion: 'rbac.authorization.k8s.io/v1',
            kind: 'ClusterRoleBinding',
            metadata: namedMetadata(`${serviceAccountName}-node-reader`, 'runtime-infrastructure-verifier'),
            subjects: [{ kind: 'ServiceAccount', name: serviceAccountName, namespace: model.name }],
            roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: `${serviceAccountName}-node-reader` }
        },
        {
            apiVersion: 'v1',
            kind: 'ServiceAccount',
            metadata: namedMetadata(runtimeEngineServiceAccountName, 'runtime-engine-scheduler')
        },
        {
            apiVersion: 'rbac.authorization.k8s.io/v1',
            kind: 'Role',
            metadata: namedMetadata(runtimeEngineServiceAccountName, 'runtime-engine-scheduler'),
            rules: [
                { apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'list', 'watch', 'create', 'patch', 'update', 'delete'] },
                { apiGroups: [''], resources: ['services', 'pods'], verbs: ['get', 'list', 'watch', 'create', 'patch', 'update', 'delete'] }
            ]
        },
        {
            apiVersion: 'rbac.authorization.k8s.io/v1',
            kind: 'RoleBinding',
            metadata: namedMetadata(runtimeEngineServiceAccountName, 'runtime-engine-scheduler'),
            subjects: [{ kind: 'ServiceAccount', name: runtimeEngineServiceAccountName }],
            roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: runtimeEngineServiceAccountName }
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
        { name: 'PLATFORM_RUNTIME_K3S_AGENT_VERSION', value: 'k3s' },
        { name: 'PLATFORM_RUNTIME_K3S_RUNTIME_ENGINE_SERVICE_ACCOUNT_NAME', value: runtimeEngineSchedulerServiceAccountName(model) },
        { name: 'PLATFORM_RUNTIME_K3S_RUNTIME_ENGINE_IMAGE', value: `medol/${model.name}-runtime-engine:0.0.1-SNAPSHOT` },
        { name: 'PLATFORM_RUNTIME_K3S_RUNTIME_ENGINE_IMAGE_PULL_POLICY', value: 'IfNotPresent' },
        { name: 'PLATFORM_RUNTIME_K3S_RUNTIME_ENGINE_DATASET_HOST_PATH', value: '/workspace/datasets' },
        { name: 'PLATFORM_RUNTIME_K3S_RUNTIME_ENGINE_WORK_HOST_PATH', value: '/workspace/tmp/runtime-engine' }
    ];
}

function runtimeAgentEngineEnvironment(model) {
    return [
        { name: 'RUNTIME_AGENT_LOCAL_RUNTIME_ENGINE_MODE', value: 'kubernetes' },
        { name: 'RUNTIME_AGENT_LOCAL_RUNTIME_ENGINE_KUBERNETES_NAMESPACE', value: model.name },
        { name: 'RUNTIME_AGENT_LOCAL_RUNTIME_ENGINE_KUBERNETES_SERVICE_ACCOUNT_NAME', value: runtimeEngineSchedulerServiceAccountName(model) },
        { name: 'RUNTIME_AGENT_LOCAL_RUNTIME_ENGINE_KUBERNETES_IMAGE', value: `medol/${model.name}-runtime-engine:0.0.1-SNAPSHOT` },
        { name: 'RUNTIME_AGENT_LOCAL_RUNTIME_ENGINE_KUBERNETES_IMAGE_PULL_POLICY', value: 'IfNotPresent' },
        { name: 'RUNTIME_AGENT_LOCAL_RUNTIME_ENGINE_KUBERNETES_DATASET_HOST_PATH', value: '/workspace/datasets' },
        { name: 'RUNTIME_AGENT_LOCAL_RUNTIME_ENGINE_KUBERNETES_RUNTIME_HOST_PATH', value: '/workspace/tmp/runtime-engine' }
    ];
}

function applicationEnvironmentVariables(model, application) {
    const schedulerEnabled = hasPlatformRuntimeScheduler(model);
    if (schedulerEnabled && isPlatformApplication(model, application)) {
        return [...application.environmentVariables, ...platformRuntimeSchedulerEnvironment(model, application)];
    }
    if (schedulerEnabled && isRuntimeAgentApplication(application)) {
        return [...application.environmentVariables, ...runtimeAgentEngineEnvironment(model)];
    }
    return application.environmentVariables;
}

function applicationBaseEnvironmentVariables(model, application) {
    return applicationEnvironmentVariables(model, application)
        .filter((variable) => variable.valueFromSecret || variable.name === 'DB_USERNAME' || variable.name === 'DB_PASSWORD');
}

function environmentConfigMaps(model, options) {
    return model.applications.map((application) => {
        const variables = applicationConfigVariables(model, application, options)
            .filter((variable) => variable.name && !variable.valueFromSecret && !isSecretVariable(variable.name))
            .map((variable) => [variable.name, kubernetesLiteralValue(variable.value)]);
        return {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: namedMetadata(applicationConfigMapName(application, options.environmentName), 'application-config'),
            data: Object.fromEntries(variables.sort(([left], [right]) => left.localeCompare(right)))
        };
    });
}

function applicationConfigVariables(model, application, options) {
    const applicationVariables = applicationEnvironmentVariables(model, application);
    const hasIdentityAccessManagement = hasApplicationContext(application, 'IdentityAccessManagement');
    const hasConfiguredCors = applicationVariables.some((variable) => variable.name === 'MEDOL_SECURITY_ALLOWED_ORIGINS');
    const k3sDevCors = application.kind === 'backend'
        && options.name.toLowerCase() === 'k3s'
        && options.environmentName === 'dev'
        && !hasConfiguredCors
        ? [{
            name: 'MEDOL_SECURITY_ALLOWED_ORIGINS',
            value: 'http://localhost:*,http://127.0.0.1:*,http://*:30080'
        }]
        : [];
    return [
        ...applicationVariables,
        ...k3sDevCors,
        ...(hasIdentityAccessManagement
            ? [{ name: 'MEDOL_SECURITY_ADMIN_BOOTSTRAP_ENABLED', value: 'false' }]
            : [])
    ];
}

function environmentSecretExamples(model, environmentName) {
    const postgres = model.infrastructure.find((component) => component.type === 'postgres');
    const applicationSecrets = model.applications
        .map((application) => {
            const stringData = Object.fromEntries(applicationSecretVariables(application).map((name) => [name, secretPlaceholder(name)]));
            return {
                apiVersion: 'v1',
                kind: 'Secret',
                metadata: namedMetadata(applicationSecretName(application, environmentName), 'application-secret'),
                type: 'Opaque',
                stringData
            };
        })
        .filter((secret) => Object.keys(secret.stringData).length > 0);
    return [
        ...(postgres ? [{
            apiVersion: 'v1',
            kind: 'Secret',
            metadata: namedMetadata('postgres-secret', 'application-secret'),
            type: 'Opaque',
            stringData: {
                username: 'medol',
                password: 'change-me'
            }
        }] : []),
        ...applicationSecrets
    ];
}

function environmentPatches(model) {
    return model.applications.map((application) => ({
        file: `patches/${application.name}-envfrom.yaml`,
        document: {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: {
                name: application.name
            },
            spec: {
                template: {
                    spec: {
                        containers: [{
                            name: application.name,
                            envFrom: [
                                {
                                    configMapRef: {
                                        name: applicationConfigMapName(application, model.environment.name)
                                    }
                                },
                                {
                                    secretRef: {
                                        name: applicationSecretName(application, model.environment.name),
                                        optional: true
                                    }
                                }
                            ]
                        }]
                    }
                }
            }
        }
    }));
}

function environmentPatchFiles(model) {
    return environmentPatches(model).map((patch) => patch.file);
}

function applicationConfigMapName(application, environmentName) {
    return kubernetesName(`${application.name}-${environmentName}-config`);
}

function applicationSecretName(application, environmentName) {
    return kubernetesName(`${application.name}-${environmentName}-secret`);
}

function applicationSecretVariables(application) {
    const fromApplication = application.environmentVariables
        .map((variable) => variable.name)
        .filter(isSecretVariable);
    const backendDefaults = application.kind === 'backend'
        ? [
            'MEDOL_SECURITY_JWT_SECRET',
            'MEDOL_SECURITY_INTERNAL_TOKEN',
            ...(hasApplicationContext(application, 'IdentityAccessManagement')
                ? ['MEDOL_SECURITY_ADMIN_BOOTSTRAP_SETUP_TOKEN']
                : []),
            'UMADB_API_KEY'
        ]
        : [];
    return Array.from(new Set([...fromApplication, ...backendDefaults])).sort((left, right) => left.localeCompare(right));
}

function hasApplicationContext(application, contextName) {
    return (application.contexts ?? []).some((context) => context === contextName || context?.name === contextName);
}

function isSecretVariable(name) {
    if (/^VITE_/i.test(String(name ?? ''))) return false;
    return /^DB_USERNAME$/i.test(String(name ?? ''))
        || /(^|_)(PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|CLIENT_SECRET|CREDENTIALS?)$/i.test(String(name ?? ''))
        || /^SUPABASE_/i.test(String(name ?? ''))
        || /^PORTAL_SSO_/i.test(String(name ?? ''));
}

function secretPlaceholder(name) {
    if (name === 'DB_USERNAME') return 'medol';
    if (name === 'UMADB_API_KEY') return '';
    if (name === 'MEDOL_SECURITY_INTERNAL_TOKEN') return 'local-dev-internal-token';
    if (name === 'MEDOL_SECURITY_JWT_SECRET') return 'change-me-change-me-change-me-change-me';
    return 'change-me';
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

function isRuntimeAgentApplication(application) {
    return application.name.endsWith('-runtime-agent');
}

function runtimeAgentSchedulerServiceAccountName(model) {
    return kubernetesName(`${model.name}-runtime-agent-scheduler`);
}

function runtimeEngineSchedulerServiceAccountName(model) {
    return kubernetesName(`${model.name}-runtime-engine-scheduler`);
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
        '- `base/runtime-agent-scheduler-rbac.yaml` is generated when the topology contains a platform backend and runtime-agent module. It authorizes platform-managed runtime-agent deployment, labeled Node verification, and per-round Runtime Engine scheduling.',
        '- `base/apisix-config.yaml` contains standalone APISIX declarative route configuration.',
        '- `base/apisix.yaml` creates the APISIX Deployment and Service.',
        '- `environments/<environment>/kustomization.yaml` selects the base and attaches environment labels.',
        '- `environments/<environment>/configmap.yaml` contains non-sensitive application variables for the environment.',
        '- `environments/<environment>/secrets.example.yaml` documents required and optional secrets without being applied by Kustomize.',
        '- `environments/<environment>/patches/*-envfrom.yaml` attaches environment ConfigMaps and optional per-application Secrets to Deployments.',
        ...(isK3s ? [
            '- `cluster/k3d-dev.yaml` creates a disposable local K3s development cluster with k3d.'
        ] : []),
        '',
        '## Before Applying',
        '',
        ...(isK3s ? [
            'For local development with k3d, create the dev cluster from the generated config:',
            '',
            '```bash',
            'k3d cluster create --config cluster/k3d-dev.yaml',
            'kubectl config use-context k3d-federation-learning-platform-dev',
            '```',
            '',
            'The config creates one server and two agent nodes, disables the default Traefik addon, exposes APISIX NodePort `30080` on localhost, and leaves application manifests under `environments/dev`.',
            '',
            '### Add A K3d Runtime Node',
            '',
            'A k3d node is a containerized K3s node on the same Docker host. Use native K3s agents instead when nodes must run on different physical machines.',
            '',
            'Add an agent node to the existing cluster:',
            '',
            '```bash',
            'k3d node create <k3d-node-name> \\',
            '  --cluster <cluster-name> \\',
            '  --role agent \\',
            '  --volume ../../../volumes/datasets:/workspace/datasets \\',
            '  --volume ../../../volumes/tmp/runtime-engine:/workspace/tmp/runtime-engine \\',
            '  --wait',
            'kubectl get nodes -o wide',
            '```',
            '',
            'Replace `<kubernetes-node-name>` below with the name returned by `kubectl get nodes`, and use the organization and runtime infrastructure identifiers from the installation guide:',
            '',
            '```bash',
            'kubectl label node <kubernetes-node-name> \\',
            '  medol.dev/node-role=runtime \\',
            '  medol.dev/organization-id=<organization-id> \\',
            '  medol.dev/runtime-infrastructure-id=<runtime-infrastructure-id> \\',
            '  --overwrite',
            '',
            'kubectl taint node <kubernetes-node-name> \\',
            '  medol.dev/runtime-only=true:NoSchedule \\',
            '  --overwrite',
            '```',
            '',
            'Verify that platform-managed runtime-agent scheduling can find the node:',
            '',
            '```bash',
            'kubectl get node <kubernetes-node-name> --show-labels',
            'kubectl get nodes -l medol.dev/runtime-infrastructure-id=<runtime-infrastructure-id>',
            '```',
            '',
            'After adding a node, import locally built images into the cluster again when the new node cannot pull them:',
            '',
            '```bash',
            'k3d image import <runtime-agent-image> --cluster <cluster-name>',
            '```',
            ''
        ] : []),
        'Build or import these images on every node that may run the workloads:',
        '',
        '```bash',
        'medol/federation-learning-platform-console:0.0.1-SNAPSHOT',
        'medol/federation-learning-support:0.0.1-SNAPSHOT',
        'medol/federation-learning-platform:0.0.1-SNAPSHOT',
        'medol/federation-learning-runtime-agent:0.0.1-SNAPSHOT',
        'medol/federation-learning-runtime-engine:0.0.1-SNAPSHOT',
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
        'Create the namespace before applying environment-specific Secret objects:',
        '',
        '```bash',
        'kubectl create namespace federation-learning-platform --dry-run=client -o yaml | kubectl apply -f -',
        '```',
        '',
        'The generated `secrets.example.yaml` contains `postgres-secret` and the per-application Secret objects required by the workloads. Copy it to an environment-owned file, replace every example value, and apply it separately:',
        '',
        '```bash',
        'cp environments/<environment>/secrets.example.yaml environments/<environment>/secrets.<environment>.yaml',
        '# Edit secrets.<environment>.yaml and replace change-me, development tokens, and empty credentials.',
        'kubectl -n federation-learning-platform apply -f environments/<environment>/secrets.<environment>.yaml',
        'kubectl -n federation-learning-platform get secret postgres-secret',
        '```',
        '',
        '`secrets.<environment>.yaml` is intentionally not referenced by the generated Kustomization and must not be committed. Production deployments should create the same Secret objects through the selected secret manager or deployment pipeline instead.',
        '',
        '## First Administrator',
        '',
        'Administrator bootstrap is disabled by default. Before creating the first administrator, set `MEDOL_SECURITY_ADMIN_BOOTSTRAP_ENABLED` to `"true"` in the IAM application ConfigMap and set `MEDOL_SECURITY_ADMIN_BOOTSTRAP_SETUP_TOKEN` in its environment-owned Secret file.',
        '',
        ...(isK3s ? [
            'The dev K3s ConfigMap allows browser origins reaching APISIX on NodePort `30080`. For another gateway port, protocol, or production hostname, replace `MEDOL_SECURITY_ALLOWED_ORIGINS` with the exact comma-separated browser origins.',
            ''
        ] : []),
        'Apply both files and restart the IAM application before submitting `POST /api/auth/setup-admin`:',
        '',
        '```bash',
        'kubectl -n federation-learning-platform apply -f environments/<environment>/secrets.<environment>.yaml',
        'kubectl apply -k environments/<environment>',
        'kubectl -n federation-learning-platform rollout restart deploy/federation-learning-support',
        'kubectl -n federation-learning-platform rollout status deploy/federation-learning-support',
        '```',
        '',
        'After the administrator is created, set `MEDOL_SECURITY_ADMIN_BOOTSTRAP_ENABLED` back to `"false"`, reapply the environment, and restart the IAM application.',
        '',
        '## Environment Configuration',
        '',
        'Generated Deployments keep non-sensitive application settings in environment ConfigMaps so each environment can own its runtime configuration:',
        '',
        '- ConfigMaps are generated in `environments/<environment>/configmap.yaml` and are applied with the overlay through `envFrom`.',
        '- Secret templates are generated in `environments/<environment>/secrets.example.yaml`; copy or translate them into your local/secret-manager workflow before applying real secrets.',
        '- Base Deployments keep only direct secret references such as `DB_USERNAME` and `DB_PASSWORD`; non-sensitive values should be changed in the environment ConfigMap.',
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
        '## Operations',
        '',
        'Use these commands from this directory unless another path is shown. For the generated dev k3d cluster, replace `<environment>` with `dev` and `<gateway-host>` with `localhost:30080`.',
        '',
        'Apply environment ConfigMaps and generated manifests:',
        '',
        '```bash',
        'kubectl apply -k environments/<environment>',
        '```',
        '',
        'Apply Secret values when using a copied `secrets.<environment>.yaml` file:',
        '',
        '```bash',
        'kubectl -n federation-learning-platform apply -f environments/<environment>/secrets.<environment>.yaml',
        '```',
        '',
        'ConfigMap and Secret changes are read when a Pod starts. Restart the affected Deployments after changing them:',
        '',
        '```bash',
        'kubectl -n federation-learning-platform rollout restart deploy/console deploy/federation-learning-support deploy/federation-learning-platform deploy/federation-learning-runtime-agent',
        'kubectl -n federation-learning-platform rollout status deploy/console',
        'kubectl -n federation-learning-platform rollout status deploy/federation-learning-support',
        'kubectl -n federation-learning-platform rollout status deploy/federation-learning-platform',
        'kubectl -n federation-learning-platform rollout status deploy/federation-learning-runtime-agent',
        '```',
        '',
        'Stop only the business services while keeping the namespace, databases, PVCs, and gateway objects:',
        '',
        '```bash',
        'kubectl -n federation-learning-platform scale deploy/console deploy/federation-learning-support deploy/federation-learning-platform deploy/federation-learning-runtime-agent --replicas=0',
        '```',
        '',
        'Start the business services again:',
        '',
        '```bash',
        'kubectl -n federation-learning-platform scale deploy/console deploy/federation-learning-support deploy/federation-learning-platform deploy/federation-learning-runtime-agent --replicas=1',
        '```',
        '',
        'Delete only the business service Deployments:',
        '',
        '```bash',
        'kubectl -n federation-learning-platform delete deploy console federation-learning-support federation-learning-platform federation-learning-runtime-agent',
        '```',
        '',
        ...(isK3s ? [
            'Rebuild generated application images and import them from local Docker images into the local k3d cluster:',
            '',
            '```bash',
            'cd ../../../../federation-learning-platform',
            'node scripts/build-images.mjs',
            'k3d image import \\',
            '  medol/federation-learning-platform-console:0.0.1-SNAPSHOT \\',
            '  medol/federation-learning-support:0.0.1-SNAPSHOT \\',
            '  medol/federation-learning-platform:0.0.1-SNAPSHOT \\',
            '  medol/federation-learning-runtime-agent:0.0.1-SNAPSHOT \\',
            '  -c federation-learning-platform-dev',
            'k3d image import \\',
            '  postgres:16 \\',
            '  umadb/umadb:0.7.8 \\',
            '  apache/apisix:3.13.0-debian \\',
            '  -c federation-learning-platform-dev',
            'cd ../operations/dev/k3s',
            'kubectl -n federation-learning-platform rollout restart deploy/console deploy/federation-learning-support deploy/federation-learning-platform deploy/federation-learning-runtime-agent',
            '```',
            '',
            'For a plain local K3s node, export images from Docker and import them into the K3s containerd image store:',
            '',
            '```bash',
            'docker save \\',
            '  medol/federation-learning-platform-console:0.0.1-SNAPSHOT \\',
            '  medol/federation-learning-support:0.0.1-SNAPSHOT \\',
            '  medol/federation-learning-platform:0.0.1-SNAPSHOT \\',
            '  medol/federation-learning-runtime-agent:0.0.1-SNAPSHOT \\',
            '  -o /tmp/federation-learning-platform-images.tar',
            'sudo k3s ctr images import /tmp/federation-learning-platform-images.tar',
            '',
            'docker save \\',
            '  postgres:16 \\',
            '  umadb/umadb:0.7.8 \\',
            '  apache/apisix:3.13.0-debian \\',
            '  -o /tmp/federation-learning-dependency-images.tar',
            'sudo k3s ctr images import /tmp/federation-learning-dependency-images.tar',
            'sudo k3s ctr images ls | grep -E "federation-learning|postgres|umadb|apisix"',
            '```',
            '',
            'Check the local k3d cluster and node placement labels:',
            '',
            '```bash',
            'kubectl config current-context',
            'kubectl get nodes --show-labels',
            'kubectl -n federation-learning-platform get pods -o wide',
            '```',
            '',
            'Label and taint a runtime-only participant node for platform-managed agents:',
            '',
            '```bash',
            'kubectl label node <node-name> medol.dev/node-role=runtime medol.dev/organization-id=<organization-id> medol.dev/runtime-infrastructure-id=<runtime-infrastructure-id> --overwrite',
            'kubectl taint node <node-name> medol.dev/runtime-only=true:NoSchedule --overwrite',
            '```',
            ''
        ] : []),
        'Inspect common failure details:',
        '',
        '```bash',
        'kubectl -n federation-learning-platform get pods',
        'kubectl -n federation-learning-platform describe pod <pod-name>',
        'kubectl -n federation-learning-platform logs deploy/<deployment-name> --tail=200',
        'kubectl -n federation-learning-platform get configmap console-dev-config -o yaml',
        'kubectl -n federation-learning-platform get secret postgres-secret -o yaml',
        '```',
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
        'The platform uses the Fabric8 Kubernetes API client. In cluster it automatically uses the mounted ServiceAccount credentials; no `kubectl` binary is required. The generated scheduler RBAC grants namespaced Deployment/Service management and cluster-scoped read access to labeled Nodes.',
        '',
        'A managed agent is named with the configured prefix plus a short runtime-agent id suffix, for example `federation-learning-runtime-agent-managed-000000000000`. This keeps platform-managed agents separate from the always-on development agent.',
        '',
        'In Kubernetes mode each runtime agent creates a per-round runtime-engine Deployment and ClusterIP Service, waits for readiness, submits the training job, observes it through the service endpoint, and deletes both resources after release. Runtime nodes must expose `/workspace/datasets` and `/workspace/tmp/runtime-engine`, or the generated hostPath settings must be patched for the target cluster.',
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
