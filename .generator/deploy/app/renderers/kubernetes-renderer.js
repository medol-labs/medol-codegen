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
    const files = {};
    files[`${options.root}/base/kustomization.yaml`] = renderYaml({
        resources: [
            'namespace.yaml',
            'infrastructure.yaml',
            'applications.yaml',
            'apisix-config.yaml',
            'apisix.yaml'
        ]
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
    files[`${options.root}/base/apisix-config.yaml`] = renderApisixConfigMap(resolved);
    files[`${options.root}/base/apisix.yaml`] = renderDocuments(apisixResources(resolved, options.gatewayServiceType));
    files[`${options.root}/environments/${options.environmentName}/kustomization.yaml`] = renderYaml({
        resources: ['../../base'],
        namespace: resolved.name,
        commonLabels: {
            'app.kubernetes.io/part-of': resolved.name,
            'medol.dev/environment': options.environmentName
        }
    });
    files[`${options.root}/README.md`] = renderKubernetesReadme(options.name);
    return files;
}

function infrastructureResources(model) {
    return model.infrastructure.filter((component) => component.enabled !== false).flatMap((component) => {
        if (component.type === 'postgres') return postgresResources(component);
        if (component.type === 'umadb') return statefulInfrastructure(component, '/data');
        if (component.type === 'axon-server') return axonServerResources(component);
        if (component.type === 'redis') return statefulInfrastructure(component, '/data');
        return [];
    });
}

function applicationResources(model) {
    return model.applications.flatMap((application) => [
        {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: namedMetadata(application.name, application.kind),
            spec: {
                replicas: application.replicas,
                selector: selector(application.name),
                template: podTemplate(application, [{
                    name: application.name,
                    image: application.image,
                    ports: [{ containerPort: application.servicePort }],
                    env: env(application.environmentVariables),
                    ...(application.healthCheck ? probes(application.healthCheck, application.servicePort) : {})
                }])
            }
        },
        service(application.name, application.servicePort)
    ]);
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

function postgresResources(component) {
    return [
        {
            apiVersion: 'v1',
            kind: 'PersistentVolumeClaim',
            metadata: namedMetadata(component.volumeName, 'infrastructure'),
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
                    volumeMounts: [{ name: component.volumeName, mountPath: '/var/lib/postgresql/data' }]
                }], [{ name: component.volumeName, persistentVolumeClaim: { claimName: component.volumeName } }])
            }
        },
        service(component.name, component.servicePort)
    ];
}

function statefulInfrastructure(component, mountPath) {
    return [
        {
            apiVersion: 'v1',
            kind: 'PersistentVolumeClaim',
            metadata: namedMetadata(component.volumeName, 'infrastructure'),
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
                    volumeMounts: [{ name: component.volumeName, mountPath }]
                }], [{ name: component.volumeName, persistentVolumeClaim: { claimName: component.volumeName } }])
            }
        },
        service(component.name, component.servicePort)
    ];
}

function axonServerResources(component) {
    const volumeNames = component.volumeNames ?? [];
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

function podTemplate(owner, containers, volumes = []) {
    return {
        metadata: {
            labels: { app: owner.name }
        },
        spec: {
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
    return {
        name,
        labels: {
            'app.kubernetes.io/name': name,
            'app.kubernetes.io/component': component,
            'app.kubernetes.io/managed-by': 'medol-deploy-generator'
        }
    };
}

function renderKubernetesReadme(name) {
    return [
        `# ${name} Deployment`,
        '',
        'Generated by the Medol deploy generator.',
        '',
        'The base manifests are generator-owned. Environment directories reference the base and can be extended with Kustomize patches.',
        '',
        'Create real Kubernetes Secret objects outside this generated artifact. The manifests only reference secret names and keys.',
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
