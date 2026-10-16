/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const { buildBackendModules } = require('../../refine/app/backend-modules');
const {tenantDatabaseName} = require('../../common/core/tenant-storage');
const {resolveOperationsModel} = require('./environment-resolver');
const {
    cleanTitle,
    kebab,
    snakeCase
} = require('../../refine/app/model-utils');

const DEFAULT_IMAGE_PREFIX = 'medol';
const DEFAULT_IMAGE_TAG = '0.0.1-SNAPSHOT';
const DEFAULT_GATEWAY_PORT = 9080;

function buildOperationsModel(source = {}, config = {}) {
    const operationsConfig = config.operations ?? config ?? {};
    const domainName = source.domain ?? source.name ?? 'medol-application';
    const systemName = operationsKebab(domainName) || 'medol-application';
    const registry = normalizeRegistryConfig(operationsConfig.registry);
    const imagePrefix = trimSlash(operationsConfig.imagePrefix ?? registry?.imagePrefix ?? DEFAULT_IMAGE_PREFIX);
    const imageTag = operationsConfig.imageTag ?? operationsConfig.tag ?? DEFAULT_IMAGE_TAG;
    const backendApplications = buildBackendApplications(source, operationsConfig, imagePrefix);
    const frontends = buildFrontendApplications(source, systemName, operationsConfig, imagePrefix, backendApplications);
    const infrastructure = buildInfrastructure(operationsConfig);
    for (const application of backendApplications.filter((entry) => entry.tenantIsolation)) {
        application.dependencies.push(...infrastructure.filter((component) => component.additional).map((component) => component.name));
    }
    const applications = [...frontends, ...backendApplications];
    const gateway = operationsConfig.gateway?.enabled === false
        ? undefined
        : buildGateway(applications, backendApplications, operationsConfig);
    const networkTopology = buildNetworkTopology(operationsConfig.networkTopology, applications, infrastructure, gateway);

    const model = {
        version: 'medol.operations/v1',
        name: systemName,
        title: cleanTitle(source.domain ?? source.title ?? domainName),
        imagePrefix,
        imageTag,
        ...(source.tenancy ? {tenancy: operationsConfig.tenancy ?? {}} : {}),
        ...(registry ? { registry } : {}),
        applications,
        infrastructure,
        ...(gateway ? { gateway } : {}),
        ...(networkTopology ? { networkTopology } : {}),
        environments: buildEnvironments(applications, infrastructure, operationsConfig, imageTag)
    };
    if (source.tenancy) for (const environment of model.environments) resolveOperationsModel(model, environment.name);
    return model;
}

function buildNetworkTopology(config, applications, infrastructure, gateway) {
    const entries = (value) => Array.isArray(value)
        ? value.map((item) => [item.name, item])
        : Object.entries(value ?? {});
    const names = (value) => Array.isArray(value)
        ? value
        : Object.entries(value ?? {}).filter(([, enabled]) => enabled).map(([name]) => name);
    const siteEntries = entries(config?.sites);
    if (!config) return undefined;
    if (!siteEntries.length) throw new Error('networkTopology must define at least one site.');
    const applicationNames = new Set(applications.map((application) => application.name));
    const infrastructureNames = new Set(infrastructure.map((component) => component.name));
    const assignedApplications = new Set();
    let gatewaySites = 0;
    const sites = siteEntries.map(([siteName, site]) => {
        const placedApplications = names(site.applications);
        const placedInfrastructure = names(site.infrastructure);
        if (!siteName) throw new Error('networkTopology site name is required.');
        if (site.gateway) gatewaySites += 1;
        for (const name of placedApplications) {
            if (!applicationNames.has(name)) throw new Error(`networkTopology references unknown application ${name}.`);
            if (assignedApplications.has(name)) throw new Error(`networkTopology assigns application ${name} to multiple sites.`);
            assignedApplications.add(name);
        }
        for (const name of placedInfrastructure) {
            if (!infrastructureNames.has(name)) throw new Error(`networkTopology references unknown infrastructure ${name}.`);
        }
        return {
            name: siteName,
            title: site.title ?? siteName,
            applications: placedApplications,
            infrastructure: placedInfrastructure,
            gateway: Boolean(site.gateway)
        };
    });
    if (new Set(sites.map((site) => site.name)).size !== sites.length) {
        throw new Error('networkTopology site names must be unique.');
    }
    const unassigned = applications.filter((application) => !assignedApplications.has(application.name));
    if (unassigned.length) {
        throw new Error(`networkTopology must place every application: ${unassigned.map((application) => application.name).join(', ')}.`);
    }
    if (gateway && gatewaySites !== 1) throw new Error('networkTopology must place the gateway in exactly one site.');
    if (!gateway && gatewaySites) throw new Error('networkTopology cannot place a disabled gateway.');
    for (const application of applications) {
        for (const dependency of application.dependencies ?? []) {
            if (infrastructureNames.has(dependency) && !sites.some((site) => site.infrastructure.includes(dependency))) {
                throw new Error(`networkTopology must place dependency ${dependency} used by ${application.name}.`);
            }
        }
    }
    const connections = entries(config.connections).map(([, connection]) => {
        if (!applicationNames.has(connection.from) || !applicationNames.has(connection.to)) {
            throw new Error(`networkTopology connection ${connection.from} -> ${connection.to} references an unknown application.`);
        }
        return {
            from: connection.from,
            to: connection.to,
            ...(connection.protocol ? { protocol: connection.protocol } : {}),
            ...(connection.label ? { label: connection.label } : {})
        };
    });
    return { sites, connections };
}

function normalizeRegistryConfig(value) {
    if (!value) return undefined;
    if (typeof value === 'string') {
        const imagePrefix = trimSlash(value);
        return imagePrefix ? { imagePrefix } : undefined;
    }
    if (typeof value !== 'object') return undefined;
    const host = trimSlash(value.host ?? value.hostname ?? value.registryHost ?? '');
    const namespace = trimSlash(value.namespace ?? value.project ?? '');
    const imagePrefix = trimSlash(value.imagePrefix ?? [host, namespace].filter(Boolean).join('/'));
    if (!imagePrefix) return undefined;
    return {
        imagePrefix,
        ...(host ? { host } : {}),
        ...(namespace ? { namespace } : {}),
        scheme: value.scheme ?? (value.insecure === false ? 'https' : 'http'),
        insecure: value.insecure !== false
    };
}

function buildBackendApplications(source, operationsConfig, imagePrefix) {
    const backendModules = buildBackendModules(source);
    const applicationConfig = operationsConfig.applications ?? {};
    const eventStorage = operationsConfig.eventStorage ?? 'umadb';

    return backendModules.map((module, index) => {
        const name = operationsKebab(module.name ?? module.dataProviderName ?? module.label) || `backend-${index + 1}`;
        const port = parsePort(module.defaultApiUrl) ?? 8080 + index;
        const dbName = tenantDatabaseName(source) ?? safeDatabaseName(name);
        const envVarPrefix = snakeCase(name).toUpperCase();
        const override = applicationConfig[name] ?? applicationConfig[module.name] ?? {};
        const otherModules = backendModules.filter((candidate) => candidate !== module);
        const integrationEnvironment = otherModules.map((target) => {
            const targetName = operationsKebab(target.name ?? target.dataProviderName ?? target.label);
            const targetOverride = applicationConfig[targetName] ?? applicationConfig[target.name] ?? {};
            const targetPort = targetOverride.servicePort ?? parsePort(target.defaultApiUrl) ?? 8080 + backendModules.indexOf(target);
            return {
                name: `${snakeCase(targetName).toUpperCase()}_URL`,
                value: `http://${targetName}:${targetPort}`
            };
        });

        return {
            kind: 'backend',
            ...(source.tenancy ? {tenantIsolation: true} : {}),
            name,
            title: module.label,
            artifactName: name,
            imageName: override.imageName ?? `${imagePrefix}/${name}`,
            servicePort: override.servicePort ?? port,
            exposeExternally: Boolean(override.exposeExternally),
            contexts: Array.from(module.contexts ?? []),
            gatewayPath: override.gatewayPath ?? gatewayPathForApplication(name, operationsConfig),
            environmentVariables: [
                { name: 'SERVER_PORT', value: String(override.servicePort ?? port) },
                { name: 'SPRING_DOCKER_COMPOSE_ENABLED', value: 'false' },
                { name: 'DB_URL', value: `jdbc:postgresql://postgres:5432/${dbName}` },
                ...(source.tenancy ? [{name: 'DB_SCHEMA', value: '${DB_SCHEMA:-public}'}] : []),
                ...(source.tenancy ? [
                    {name: 'MEDOL_SECURITY_INTERNAL_TOKEN', value: '${MEDOL_SECURITY_INTERNAL_TOKEN:?Set a shared tenant relay secret of at least 32 characters}'},
                    {name: 'MEDOL_SECURITY_JWT_SECRET', value: '${MEDOL_SECURITY_JWT_SECRET:?Set a shared JWT signing secret}'}
                ] : []),
                { name: 'DB_USERNAME', value: '${POSTGRES_USER:-medol}' },
                { name: 'DB_PASSWORD', value: '${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}' },
                { name: 'MEDOL_AXON_EVENT_STORAGE', value: `\${MEDOL_AXON_EVENT_STORAGE:-${eventStorage}}` },
                { name: 'UMADB_TARGET', value: '${UMADB_TARGET:-umadb:50051}' },
                { name: 'UMADB_PLAINTEXT', value: '${UMADB_PLAINTEXT:-true}' },
                { name: 'UMADB_API_KEY', value: '${UMADB_API_KEY:-}' },
                { name: 'UMADB_BATCH_SIZE', value: '${UMADB_BATCH_SIZE:-256}' },
                { name: 'UMADB_REQUEST_TIMEOUT', value: '${UMADB_REQUEST_TIMEOUT:-PT10S}' },
                { name: 'AXON_SERVER_ENABLED', value: eventStorage === 'axon-server' ? 'true' : 'false' },
                { name: 'AXON_SERVER_EVENT_STORE_ENABLED', value: eventStorage === 'axon-server' ? 'true' : 'false' },
                { name: 'AXON_SERVER_SERVERS', value: '${AXON_SERVER_SERVERS:-axon-server:8124}' },
                { name: 'AXON_UPDATE_CHECK_DISABLED', value: '${AXON_UPDATE_CHECK_DISABLED:-true}' },
                ...integrationEnvironment,
                ...(override.environmentVariables ?? [])
            ],
            dependencies: eventStorage === 'axon-server'
                ? ['postgres', 'axon-server']
                : ['postgres', 'umadb'],
            healthCheck: {
                path: '/actuator/health',
                intervalSeconds: 10,
                timeoutSeconds: 5,
                retries: 12,
                startPeriodSeconds: 30
            },
            deploymentProfile: {
                replicas: 1,
                resourceProfile: 'standard'
            },
            envVarPrefix
        };
    });
}

function buildFrontendApplications(source, systemName, operationsConfig, imagePrefix, backendApplications) {
    const frontendConfig = operationsConfig.frontend ?? {};
    if (frontendConfig.enabled === false) {
        return [];
    }

    const modeledApplications = source.frontendApplications ?? [];
    if (modeledApplications.length === 0) {
        return [buildFrontendApplication({
            name: frontendConfig.name ?? 'console',
            title: frontendConfig.title ?? 'Frontend Console',
            contexts: []
        }, systemName, operationsConfig, imagePrefix, backendApplications, 0, true)];
    }

    return modeledApplications.map((application, index) => buildFrontendApplication(
        application,
        systemName,
        operationsConfig,
        imagePrefix,
        backendApplications,
        index,
        false
    ));
}

function buildFrontendApplication(application, systemName, operationsConfig, imagePrefix, backendApplications, index, legacyConsole) {
    const frontendConfig = operationsConfig.frontend ?? {};
    const frontendConfigs = operationsConfig.frontends ?? frontendConfig.applications ?? {};
    const modeledName = legacyConsole ? application.name : operationsKebab(application.name ?? application.title);
    const name = operationsKebab(frontendConfigs[modeledName]?.name ?? modeledName) || `frontend-${index + 1}`;
    const override = frontendConfigs[name] ?? frontendConfigs[application.name] ?? frontendConfigs[modeledName] ?? (legacyConsole ? frontendConfig : {});
    const targetBackends = frontendBackendApplications(application, backendApplications);
    const gatewayPath = override.gatewayPath ?? frontendGatewayPath(name, index, legacyConsole);

    return {
        kind: 'frontend',
        name,
        title: override.title ?? application.title ?? cleanTitle(application.name) ?? 'Frontend Console',
        frontendApplicationName: legacyConsole ? undefined : application.name,
        artifactName: override.artifactName ?? (legacyConsole ? `${systemName}-console` : name),
        imageName: override.imageName ?? `${imagePrefix}/${legacyConsole ? `${systemName}-console` : name}`,
        servicePort: override.servicePort ?? frontendConfig.servicePort ?? 80,
        exposeExternally: false,
        gatewayPath,
        bundledWithBackend: targetBackends.length === 1 ? targetBackends[0].name : undefined,
        environmentVariables: [
            { name: 'VITE_API_URL', value: frontendConfig.supabaseUrl ?? 'https://iwdfzvfqbtokqetmbmbp.supabase.co' },
            { name: 'VITE_SUPABASE_API_KEY', value: '${VITE_SUPABASE_API_KEY:-}' },
            ...(application.name && !legacyConsole ? [{ name: 'VITE_FRONTEND_APP', value: application.name }] : []),
            ...targetBackends.map((backend) => ({
                name: `VITE_${backend.envVarPrefix}_API_URL`,
                value: backend.gatewayPath
            })),
            ...(targetBackends[0]
                ? [{ name: 'VITE_AXON_API_URL', value: targetBackends[0].gatewayPath }]
                : []),
            ...(frontendConfig.environmentVariables ?? []),
            ...(override.environmentVariables ?? [])
        ],
        dependencies: [],
        healthCheck: {
            path: '/health',
            intervalSeconds: 10,
            timeoutSeconds: 3,
            retries: 5
        },
        deploymentProfile: {
            replicas: 1,
            resourceProfile: 'small'
        },
        envVarPrefix: snakeCase(name).toUpperCase()
    };
}

function frontendBackendApplications(frontendApplication, backendApplications) {
    const backendNames = new Set((frontendApplication.contexts ?? [])
        .map((context) => context.backend)
        .filter(Boolean)
        .map(operationsKebab));
    if (backendNames.size > 0) {
        const selected = backendApplications.filter((application) => backendNames.has(application.name));
        if (selected.length > 0) {
            return selected;
        }
    }

    const frontendContexts = new Set((frontendApplication.contexts ?? [])
        .map((context) => context.name ?? context.title)
        .filter(Boolean));
    if (frontendContexts.size > 0) {
        const selected = backendApplications.filter((application) =>
            (application.contexts ?? []).some((context) => frontendContexts.has(context))
        );
        if (selected.length > 0) {
            return selected;
        }
    }

    return backendApplications;
}

function frontendGatewayPath(name, index, legacyConsole) {
    if (legacyConsole || index === 0) return '/';
    return `/${name}`;
}

function buildInfrastructure(operationsConfig) {
    const infrastructureConfig = operationsConfig.infrastructure ?? {};
    const eventStorage = operationsConfig.eventStorage ?? 'umadb';
    const postgresConfig = infrastructureConfig.postgres ?? {};
    const umadbConfig = infrastructureConfig.umadb ?? {};
    const axonServerConfig = infrastructureConfig.axonServer ?? {};
    const redisConfig = infrastructureConfig.redis ?? {};
    const infrastructure = [];

    if (postgresConfig.enabled !== false) {
        infrastructure.push({
            type: 'postgres',
            name: postgresConfig.name ?? 'postgres',
            image: postgresConfig.image ?? 'postgres:16',
            servicePort: postgresConfig.servicePort ?? 5432,
            volumeName: postgresConfig.volumeName ?? 'postgres_data',
            environmentVariables: [
                { name: 'POSTGRES_USER', value: '${POSTGRES_USER:-medol}' },
                { name: 'POSTGRES_PASSWORD', value: '${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}' },
                { name: 'POSTGRES_DB', value: '${POSTGRES_DB:-medol}' }
            ],
            healthCheck: {
                command: 'pg_isready -U ${POSTGRES_USER:-medol} -d ${POSTGRES_DB:-medol}',
                intervalSeconds: 5,
                timeoutSeconds: 5,
                retries: 10
            },
            enabled: true
        });
    }

    if (umadbConfig.enabled !== false) {
        infrastructure.push({
            type: 'umadb',
            name: umadbConfig.name ?? 'umadb',
            image: umadbConfig.image ?? 'umadb/umadb:0.7.8',
            servicePort: umadbConfig.servicePort ?? 50051,
            volumeName: umadbConfig.volumeName ?? 'umadb_data',
            environmentVariables: umadbConfig.environmentVariables ?? [],
            enabled: true
        });
    }

    infrastructure.push({
        type: 'axon-server',
        name: axonServerConfig.name ?? 'axon-server',
        image: axonServerConfig.image ?? 'axoniq/axonserver:2026.0.3-jdk-21',
        servicePort: axonServerConfig.servicePort ?? 8124,
        managementPort: axonServerConfig.managementPort ?? 8024,
        volumeNames: axonServerConfig.volumeNames ?? ['axon_server_data', 'axon_server_events'],
        environmentVariables: [
            { name: 'axoniq_axonserver_hostname', value: 'axon-server' },
            { name: 'axoniq_axonserver_autocluster_first', value: 'axon-server' },
            { name: 'axoniq_axonserver_autocluster_dcb', value: 'true' },
            { name: 'axoniq_axonserver_autocluster_contexts', value: '_admin,default' },
            ...(axonServerConfig.environmentVariables ?? [])
        ],
        profile: axonServerConfig.profile ?? 'axon-server',
        healthCheck: {
            path: '/actuator/health',
            port: axonServerConfig.managementPort ?? 8024,
            intervalSeconds: 10,
            timeoutSeconds: 5,
            retries: 10,
            startPeriodSeconds: 30
        },
        enabled: eventStorage === 'axon-server' || Boolean(axonServerConfig.enabled)
    });

    if (redisConfig.enabled === true) {
        infrastructure.push({
            type: 'redis',
            name: redisConfig.name ?? 'redis',
            image: redisConfig.image ?? 'redis:7-alpine',
            servicePort: redisConfig.servicePort ?? 6379,
            volumeName: redisConfig.volumeName ?? 'redis_data',
            environmentVariables: redisConfig.environmentVariables ?? [],
            enabled: true
        });
    }

    for (const extra of infrastructureConfig.additional ?? []) {
        if (!['postgres', 'umadb'].includes(extra.type) || !/^[a-z][a-z0-9-]{0,47}$/.test(extra.name ?? '') || infrastructure.some((component) => component.name === extra.name)) throw new Error('Invalid or duplicate additional storage resource.');
        if (extra.type === 'postgres' && (!Array.isArray(extra.databases) || !extra.databases.length || extra.databases.some((name) => !/^[a-z][a-z0-9_]{0,62}$/.test(name)))) throw new Error('Additional PostgreSQL resources require explicit safe database names.');
        if (extra.type === 'postgres' && !['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'].every((name) => (extra.environmentVariables ?? []).some((variable) => variable.name === name))) throw new Error('Configure credentials and the initial database for each additional PostgreSQL resource.');
        infrastructure.push({
            type: extra.type, name: extra.name, additional: true,
            image: extra.image ?? (extra.type === 'postgres' ? 'postgres:16' : 'umadb/umadb:0.7.8'),
            servicePort: extra.servicePort ?? (extra.type === 'postgres' ? 5432 : 50051),
            volumeName: extra.volumeName ?? `${extra.name}_data`,
            environmentVariables: extra.environmentVariables ?? [], databases: extra.databases,
            ...(extra.type === 'postgres' ? {healthCheck: {command: 'pg_isready -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}"', intervalSeconds: 5, timeoutSeconds: 5, retries: 10}} : {}),
            enabled: true
        });
    }
    const volumes = infrastructure.flatMap((component) => [component.volumeName, ...(component.volumeNames ?? [])]).filter(Boolean);
    const physicalName = (name) => String(name).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (new Set(volumes.map(physicalName)).size !== volumes.length) throw new Error('Storage resources must not share physical volumes, including normalized Kubernetes names.');
    if (new Set(infrastructure.map((component) => physicalName(component.name))).size !== infrastructure.length) throw new Error('Infrastructure resource names collide after normalization.');
    return infrastructure;
}

function buildGateway(applications, backendApplications, operationsConfig) {
    const gatewayConfig = operationsConfig.gateway ?? {};
    const servicePort = gatewayConfig.servicePort ?? 9080;
    const gateway = {
        enabled: true,
        provider: 'apisix',
        name: gatewayConfig.name ?? 'apisix',
        image: gatewayConfig.image ?? 'apache/apisix:3.13.0-debian',
        servicePort,
        adminPort: gatewayConfig.adminPort ?? 9180,
        routes: [],
        upstreams: [],
        plugins: gatewayConfig.plugins ?? []
    };
    const frontends = applications.filter((application) => application.kind === 'frontend');

    frontends.forEach((frontend, index) => {
        gateway.upstreams.push({
            id: frontend.name,
            serviceName: frontend.name,
            servicePort: frontend.servicePort
        });
        gateway.routes.push({
            id: `${frontend.name}-root`,
            name: `${frontend.title} Root`,
            paths: [index === 0 || frontend.gatewayPath === '/' ? '/*' : `${frontend.gatewayPath}/*`],
            methods: [],
            upstreamId: frontend.name,
            plugins: index === 0 || frontend.gatewayPath === '/'
                ? []
                : [{
                    name: 'proxy-rewrite',
                    configuration: {
                        regex_uri: [
                            `^${escapeRegex(frontend.gatewayPath)}/(.*)`,
                            '/$1'
                        ]
                    }
                }]
        });
    });

    backendApplications.forEach((application) => {
        gateway.upstreams.push({
            id: application.name,
            serviceName: application.name,
            servicePort: application.servicePort
        });
        gateway.routes.push({
            id: `${application.name}-api`,
            name: `${application.title} API`,
            paths: [`${application.gatewayPath}/*`],
            methods: [],
            upstreamId: application.name,
            plugins: [{
                name: 'proxy-rewrite',
                configuration: {
                    regex_uri: [
                        `^${escapeRegex(application.gatewayPath)}/(.*)`,
                        '/$1'
                    ]
                }
            }]
        });
    });

    return gateway;
}

function buildEnvironments(applications, infrastructure, operationsConfig, imageTag) {
    const configured = operationsConfig.environments ?? {};
    return ['dev', 'test', 'staging', 'prod'].map((name) => {
        const defaults = defaultEnvironment(name, applications, infrastructure, imageTag);
        const override = configured[name] ?? {};
        return {
            ...defaults,
            ...override,
            variables: {
                ...defaults.variables,
                ...(override.variables ?? {})
            },
            applicationOverrides: mergeOverrides(defaults.applicationOverrides, override.applicationOverrides),
            infrastructureOverrides: mergeOverrides(defaults.infrastructureOverrides, override.infrastructureOverrides)
        };
    });
}

function defaultEnvironment(name, applications, infrastructure, imageTag) {
    const exposeServices = name === 'dev';
    const replicas = name === 'prod' || name === 'staging' ? 2 : 1;
    return {
        name,
        variables: {
            IMAGE_TAG: imageTag,
            GATEWAY_PORT: String(DEFAULT_GATEWAY_PORT),
            POSTGRES_USER: 'medol',
            POSTGRES_PASSWORD: 'change-me',
            POSTGRES_DB: 'medol'
        },
        applicationOverrides: Object.fromEntries(applications.map((application) => [
            application.name,
            {
                replicas,
                imageTag,
                exposePorts: exposeServices && application.kind === 'backend',
                hostPort: application.kind === 'backend' ? application.servicePort : undefined
            }
        ])),
        infrastructureOverrides: Object.fromEntries(infrastructure.map((component) => [
            component.name,
            {
                exposePorts: exposeServices && !component.additional && ['postgres', 'umadb', 'redis'].includes(component.type)
            }
        ]))
    };
}

function mergeOverrides(base, override = {}) {
    return Object.fromEntries(
        Object.keys({ ...base, ...override }).sort().map((key) => [
            key,
            {
                ...(base[key] ?? {}),
                ...(override[key] ?? {})
            }
        ])
    );
}

function gatewayPathForApplication(applicationName, operationsConfig) {
    const routeConfig = operationsConfig.gateway?.routes?.[applicationName];
    if (routeConfig?.path) return normalizePath(routeConfig.path);

    const suffixes = ['-service', '-backend', '-application', '-app'];
    const suffix = suffixes.find((candidate) => applicationName.endsWith(candidate));
    if (!suffix) return `/api/${applicationName}`;

    return `/api/${pluralizeLastSegment(applicationName.slice(0, -suffix.length))}`;
}

function pluralizeLastSegment(value) {
    const parts = value.split('-').filter(Boolean);
    const last = parts.pop() ?? value;
    const plural = last.endsWith('y')
        ? `${last.slice(0, -1)}ies`
        : last.endsWith('s')
            ? last
            : `${last}s`;
    return [...parts, plural].join('-');
}

function normalizePath(value) {
    const path = String(value ?? '').trim();
    if (!path) return '/api/application';
    return path.startsWith('/') ? path.replace(/\/+$/g, '') : `/${path.replace(/\/+$/g, '')}`;
}

function parsePort(url) {
    try {
        const port = Number.parseInt(new URL(url).port, 10);
        return Number.isFinite(port) ? port : undefined;
    } catch {
        return undefined;
    }
}

function trimSlash(value) {
    return String(value ?? '').replace(/\/+$/g, '');
}

function operationsKebab(value) {
    return kebab(String(cleanTitle(value)).replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
}

function safeDatabaseName(value) {
    return String(value ?? 'medol')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase() || 'medol';
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
    buildOperationsModel,
    gatewayPathForApplication
};
