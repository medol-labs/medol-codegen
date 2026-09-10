/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const { resolveOperationsModel } = require('../environment-resolver');
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
    const resolved = resolveOperationsModel(model, options.environmentName);
    const baseResolved = withoutRegistryImages(resolved);
    const resources = [
        'namespace.yaml',
        'infrastructure.yaml',
        'applications.yaml',
        'apisix-config.yaml',
        'apisix.yaml'
    ];
    const files = {};
    files[`${options.root}/base/kustomization.yaml`] = renderYaml({
        resources
    });
    files[`${options.root}/base/namespace.yaml`] = renderYaml({
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
            name: baseResolved.name
        }
    });
    files[`${options.root}/base/infrastructure.yaml`] = renderDocuments(infrastructureResources(baseResolved));
    files[`${options.root}/base/applications.yaml`] = renderDocuments(applicationResources(baseResolved));
    files[`${options.root}/base/apisix-config.yaml`] = renderApisixConfigMap(baseResolved);
    files[`${options.root}/base/apisix.yaml`] = renderDocuments(apisixResources(baseResolved, options.gatewayServiceType));
    files[`${options.root}/environments/${options.environmentName}/kustomization.yaml`] = renderYaml({
        resources: [
            '../../base',
            'configmap.yaml'
        ],
        namespace: baseResolved.name,
        labels: [{
            pairs: {
                'app.kubernetes.io/part-of': baseResolved.name,
                'medol.dev/environment': options.environmentName
            },
            includeSelectors: true,
            includeTemplates: true
        }],
        patches: environmentPatchFiles(baseResolved).map((file) => ({ path: file }))
    });
    files[`${options.root}/environments/${options.environmentName}/configmap.yaml`] = renderDocuments(environmentConfigMaps(baseResolved, options));
    files[`${options.root}/environments/${options.environmentName}/secrets.example.yaml`] = renderDocuments(environmentSecretExamples(baseResolved, options.environmentName));
    environmentPatches(baseResolved).forEach((patch) => {
        files[`${options.root}/environments/${options.environmentName}/${patch.file}`] = renderYaml(patch.document);
    });
    if (options.name.toLowerCase() === 'k3s' && options.environmentName === 'dev') {
        files[`${options.root}/cluster/k3d-dev.yaml`] = renderK3dClusterConfig(baseResolved);
    }
    if (options.name.toLowerCase() === 'k3s' && resolved.registry?.host) {
        files[`${options.root}/cluster/registries.yaml`] = renderK3sRegistriesConfig(resolved.registry);
    }
    Object.assign(files, registryEnvironmentFiles(baseResolved, resolved, options));
    files[`${options.root}/README.md`] = renderKubernetesReadme(options.name, resolved);
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
    return model.applications.flatMap((application) => {
        const baseEnv = env(applicationBaseEnvironmentVariables(model, application));
        const containers = [{
            name: application.name,
            image: application.image,
            ports: [{ containerPort: application.servicePort }],
            ...(baseEnv.length ? { env: baseEnv } : {}),
            ...(application.healthCheck ? probes(application.healthCheck, application.servicePort) : {})
        }];
        return [{
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: namedMetadata(application.name, application.kind),
            spec: {
                replicas: application.replicas,
                selector: selector(application.name),
                template: podTemplate(application, containers)
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

function renderK3sRegistriesConfig(registry) {
    const endpoint = `${registry.scheme ?? 'http'}://${registry.host}`;
    return renderYaml({
        mirrors: {
            [registry.host]: {
                endpoint: [endpoint]
            }
        }
    });
}

function registryEnvironmentFiles(baseModel, registryModel, options) {
    if (!registryModel.registry?.imagePrefix) return {};
    const environmentName = `${options.environmentName}-registry`;
    const files = {};
    files[`${options.root}/environments/${environmentName}/kustomization.yaml`] = renderYaml({
        resources: [`../${options.environmentName}`],
        images: baseModel.applications.map((application) => ({
            name: localApplicationImageName(application),
            newName: registryApplicationImageName(registryModel, application),
            newTag: registryModel.imageTag
        }))
    });
    return files;
}

function withoutRegistryImages(model) {
    return {
        ...model,
        imagePrefix: 'medol',
        registry: undefined,
        applications: model.applications.map((application) => {
            const imageName = localApplicationImageName(application);
            return {
                ...application,
                imageName,
                image: imageWithTag(imageName, model.imageTag)
            };
        })
    };
}

function localApplicationImageName(application) {
    return `medol/${application.artifactName ?? application.name}`;
}

function registryApplicationImageName(model, application) {
    return `${model.registry.imagePrefix}/${application.artifactName ?? application.name}`;
}

function registryApplicationImage(model, application) {
    return imageWithTag(registryApplicationImageName(model, application), model.imageTag);
}

function imageWithTag(imageName, tag) {
    if (!tag || imageName.includes(':')) return imageName;
    return `${imageName}:${tag}`;
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

function applicationEnvironmentVariables(model, application) {
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
            ? [{ name: 'MEDOL_SECURITY_ADMIN_BOOTSTRAP_ENABLED', value: 'true' }]
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
            'app.kubernetes.io/managed-by': 'medol-operations-generator'
        }
    };
}

function renderKubernetesReadme(name, model) {
    const isK3s = name.toLowerCase() === 'k3s';
    const registryConfigured = Boolean(model?.registry?.host);
    const namespace = model.name;
    const environmentName = model.environment.name;
    const k3dCreateCommand = registryConfigured
        ? 'k3d cluster create --config cluster/k3d-dev.yaml --registry-config cluster/registries.yaml'
        : 'k3d cluster create --config cluster/k3d-dev.yaml';
    const applicationImages = model?.applications?.map((application) => application.image) ?? [];
    const dependencyImages = model?.infrastructure
        ?.filter((component) => component.enabled !== false)
        .map((component) => component.image)
        .filter(Boolean) ?? [];
    const workloadImages = Array.from(new Set([...applicationImages, ...dependencyImages]));
    const applicationNames = model.applications.map((application) => application.name);
    const deploymentNames = [
        ...model.infrastructure.filter((component) => component.enabled !== false).map((component) => component.name),
        ...applicationNames,
        ...(model.gateway?.enabled ? [model.gateway.name] : [])
    ];
    const iamApplication = model.applications.find((application) => hasApplicationContext(application, 'IdentityAccessManagement'));
    const routeLines = model.gateway?.routes?.length
        ? model.gateway.routes.map((route) => `- \`${route.paths?.[0] ?? '/'}\` -> \`${route.serviceName}\``)
        : ['- `/` -> generated frontend or configured gateway upstreams'];
    const pvcNames = model.infrastructure
        .flatMap((component) => [
            component.volumeName,
            ...(component.volumeNames ?? [])
        ])
        .filter(Boolean)
        .map(kubernetesName);
    const gatewayExposure = isK3s
        ? 'APISIX is exposed with a NodePort service on `30080`, so the default entrypoint is `http://<node-ip>:30080/`.'
        : 'APISIX is exposed with a LoadBalancer service. Use the external address assigned by your cluster or cloud provider.';
    return [
        `# ${name} Deployment`,
        '',
        'Generated by the Medol operations generator.',
        '',
        'The base manifests and generated environment overlays are generator-owned. Keep project-specific Kubernetes extensions in a separate overlay that references a generated environment.',
        '',
        '## Topology',
        '',
        ...model.applications.map((application) => `- \`${application.name}\` runs the generated ${application.kind} application.`),
        ...model.infrastructure.filter((component) => component.enabled !== false).map((component) => `- \`${component.name}\` provides ${component.type} infrastructure.`),
        ...(model.gateway?.enabled ? [`- \`${model.gateway.name}\` is the generated external gateway.`] : []),
        '',
        '## Generated Files',
        '',
        '- `base/namespace.yaml` creates the namespace.',
        '- `base/infrastructure.yaml` creates enabled infrastructure resources and their persistent volumes.',
        '- `base/applications.yaml` creates the frontend and backend Deployments and Services.',
        '- `base/apisix-config.yaml` contains standalone APISIX declarative route configuration.',
        '- `base/apisix.yaml` creates the APISIX Deployment and Service.',
        '- `environments/<environment>/kustomization.yaml` selects the base and attaches environment labels.',
        '- `environments/<environment>/configmap.yaml` contains non-sensitive application variables for the environment.',
        '- `environments/<environment>/secrets.example.yaml` documents required and optional secrets without being applied by Kustomize.',
        '- `environments/<environment>/patches/*-envfrom.yaml` attaches environment ConfigMaps and optional per-application Secrets to Deployments.',
        ...(registryConfigured ? [
            '- `environments/<environment>-registry/` is generated when `operations.registry` is configured. It rewrites application images to the configured registry.'
        ] : []),
        ...(isK3s ? [
            '- `cluster/k3d-dev.yaml` creates a disposable local K3s development cluster with k3d.'
        ] : []),
        ...(isK3s && registryConfigured ? [
            '- `cluster/registries.yaml` configures K3s/containerd access to the configured registry.'
        ] : []),
        '',
        '## Before Applying',
        '',
        ...(isK3s ? [
            'For local development with k3d, create the dev cluster from the generated config:',
            '',
            '```bash',
            k3dCreateCommand,
            `export KUBECONFIG="$(k3d kubeconfig write ${namespace}-dev)"`,
            'kubectl config current-context',
            '```',
            '',
            'The config creates one server and two agent nodes, disables the default Traefik addon, and maps host port `30080` to the k3d server node. The generated APISIX NodePort Service also uses `30080`, so APISIX is reachable at `http://localhost:30080/` after applying the manifests.',
            '',
            ...(registryConfigured ? [
                '## Registry',
                '',
                `The default \`environments/${environmentName}\` overlay does not require a registry and keeps images in the \`medol/<service>:<tag>\` form.`,
                '',
                `Apply \`environments/${environmentName}-registry\` when images are pushed to \`${model.registry.imagePrefix}\`:`,
                '',
                '```bash',
                `kubectl apply -k environments/${environmentName}-registry`,
                '```',
                '',
                'For native K3s, copy `cluster/registries.yaml` to `/etc/rancher/k3s/registries.yaml` before starting or restarting K3s.',
                ''
            ] : [
                '## Registry',
                '',
                'No registry is configured for this environment. Generated image names use the default `medol/<service>:<tag>` form. Build or import those images into each node, or configure `operations.registry` and regenerate the operations files.',
                ''
            ])
        ] : []),
        'Build, push, or import these images on every node that may run the workloads:',
        '',
        '```bash',
        ...Array.from(new Set([
            ...workloadImages
        ])),
        '```',
        '',
        ...(isK3s && !registryConfigured ? [
            'For local k3s image testing, import image archives into containerd:',
            '',
            '```bash',
            `sudo k3s ctr images import ${namespace}-application-images.tar`,
            'sudo k3s ctr images import dependency-images.tar',
            '```',
            ''
        ] : []),
        'Create the namespace before applying environment-specific Secret objects:',
        '',
        '```bash',
        `kubectl create namespace ${namespace} --dry-run=client -o yaml | kubectl apply -f -`,
        '```',
        '',
        'The generated `secrets.example.yaml` contains `postgres-secret` and the per-application Secret objects required by the workloads. Copy it to an environment-owned file, replace every example value, and apply it separately:',
        '',
        '```bash',
        'cp environments/<environment>/secrets.example.yaml environments/<environment>/secrets.<environment>.yaml',
        '# Edit secrets.<environment>.yaml and replace change-me, development tokens, and empty credentials.',
        `kubectl -n ${namespace} apply -f environments/<environment>/secrets.<environment>.yaml`,
        `kubectl -n ${namespace} get secret postgres-secret`,
        '```',
        '',
        '`secrets.<environment>.yaml` is intentionally not referenced by the generated Kustomization and must not be committed. Production deployments should create the same Secret objects through the selected secret manager or deployment pipeline instead.',
        '',
        '## First Administrator',
        '',
        ...(iamApplication ? [
            `Administrator bootstrap is enabled by default for \`${iamApplication.name}\`. Before creating the first administrator, set \`MEDOL_SECURITY_ADMIN_BOOTSTRAP_SETUP_TOKEN\` in that application's environment-owned Secret file.`,
            ''
        ] : [
            'No generated application in this topology contains the built-in IdentityAccessManagement context.',
            ''
        ]),
        '',
        ...(isK3s ? [
            'The dev K3s ConfigMap allows browser origins reaching APISIX on NodePort `30080`. For another gateway port, protocol, or production hostname, replace `MEDOL_SECURITY_ALLOWED_ORIGINS` with the exact comma-separated browser origins.',
            ''
        ] : []),
        'Apply both files and restart the IAM application before submitting `POST /api/auth/setup-admin`:',
        '',
        '```bash',
        `kubectl -n ${namespace} apply -f environments/<environment>/secrets.<environment>.yaml`,
        'kubectl apply -k environments/<environment>',
        ...(iamApplication ? [
            `kubectl -n ${namespace} rollout restart deploy/${iamApplication.name}`,
            `kubectl -n ${namespace} rollout status deploy/${iamApplication.name}`
        ] : []),
        '```',
        '',
        ...(iamApplication ? [
        'After the administrator is created, set `MEDOL_SECURITY_ADMIN_BOOTSTRAP_ENABLED` to `"false"`, reapply the environment, and restart the IAM application.',
            ''
        ] : []),
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
        'kubectl apply -k environments/<environment>',
        `kubectl -n ${namespace} get pods,svc,pvc`,
        '```',
        '',
        gatewayExposure,
        '',
        'Default routes:',
        '',
        ...routeLines,
        '',
        '## Validation',
        '',
        '```bash',
        ...deploymentNames.map((deployment) => `kubectl -n ${namespace} rollout status deploy/${deployment}`),
        ...model.applications
            .filter((application) => application.kind === 'backend')
            .map((application) => `curl -fsS http://<gateway-host>${application.gatewayPath}/actuator/health`),
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
        `kubectl -n ${namespace} apply -f environments/<environment>/secrets.<environment>.yaml`,
        '```',
        '',
        'ConfigMap and Secret changes are read when a Pod starts. Restart the affected Deployments after changing them:',
        '',
        '```bash',
        `kubectl -n ${namespace} rollout restart ${applicationNames.map((application) => `deploy/${application}`).join(' ')}`,
        ...applicationNames.map((application) => `kubectl -n ${namespace} rollout status deploy/${application}`),
        '```',
        '',
        'Stop only the business services while keeping the namespace, databases, PVCs, and gateway objects:',
        '',
        '```bash',
        `kubectl -n ${namespace} scale ${applicationNames.map((application) => `deploy/${application}`).join(' ')} --replicas=0`,
        '```',
        '',
        'Start the business services again:',
        '',
        '```bash',
        `kubectl -n ${namespace} scale ${applicationNames.map((application) => `deploy/${application}`).join(' ')} --replicas=1`,
        '```',
        '',
        'Delete only the business service Deployments:',
        '',
        '```bash',
        `kubectl -n ${namespace} delete ${applicationNames.map((application) => `deploy/${application}`).join(' ')}`,
        '```',
        '',
        ...(isK3s ? [
            'Rebuild generated application images and import them from local Docker images into the local k3d cluster:',
            '',
            '```bash',
            'cd <application-build-workspace>',
            'node scripts/build-images.mjs',
            'k3d image import \\',
            ...applicationImages.map((image, index) => `  ${image}${index === applicationImages.length - 1 ? '' : ' \\'}`),
            `  -c ${namespace}-dev`,
            'k3d image import \\',
            ...dependencyImages.map((image, index) => `  ${image}${index === dependencyImages.length - 1 ? '' : ' \\'}`),
            `  -c ${namespace}-dev`,
            `kubectl -n ${namespace} rollout restart ${applicationNames.map((application) => `deploy/${application}`).join(' ')}`,
            '```',
            '',
            'For a plain local K3s node, export images from Docker and import them into the K3s containerd image store:',
            '',
            '```bash',
            'docker save \\',
            ...applicationImages.map((image, index) => `  ${image}${index === applicationImages.length - 1 ? '' : ' \\'}`),
            `  -o /tmp/${namespace}-application-images.tar`,
            `sudo k3s ctr images import /tmp/${namespace}-application-images.tar`,
            '',
            'docker save \\',
            ...dependencyImages.map((image, index) => `  ${image}${index === dependencyImages.length - 1 ? '' : ' \\'}`),
            `  -o /tmp/${namespace}-dependency-images.tar`,
            `sudo k3s ctr images import /tmp/${namespace}-dependency-images.tar`,
            `sudo k3s ctr images ls | grep ${namespace}`,
            '```',
            '',
            'Check the local k3d cluster:',
            '',
            '```bash',
            'kubectl config current-context',
            'kubectl get nodes -o wide',
            `kubectl -n ${namespace} get pods -o wide`,
            '```',
            ''
        ] : []),
        'Inspect common failure details:',
        '',
        '```bash',
        `kubectl -n ${namespace} get pods`,
        `kubectl -n ${namespace} describe pod <pod-name>`,
        `kubectl -n ${namespace} logs deploy/<deployment-name> --tail=200`,
        `kubectl -n ${namespace} get configmap <configmap-name> -o yaml`,
        `kubectl -n ${namespace} get secret postgres-secret -o yaml`,
        '```',
        '',
        '## Postgres Initialization',
        '',
        'The generated `postgres-init` ConfigMap creates one database per backend module on first Postgres container initialization:',
        '',
        ...model.applications
            .filter((application) => application.kind === 'backend')
            .map((application) => `- \`${kubernetesName(application.name).replace(/-/g, '_')}\``),
        '',
        'This follows the same initialization behavior as Docker Compose. If the Postgres PVC already exists, the official Postgres image will not rerun `/docker-entrypoint-initdb.d`; create missing databases manually or recreate the PVC during a disposable development reset.',
        '',
        '## Development Reset',
        '',
        'For a disposable development cluster only:',
        '',
        '```bash',
        'kubectl delete -k environments/<environment>',
        ...(pvcNames.length
            ? [`kubectl -n ${namespace} delete pvc ${pvcNames.join(' ')} --ignore-not-found`]
            : [`kubectl -n ${namespace} get pvc`]),
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
