/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const { resolveOperationsModel } = require('../environment-resolver');
const { renderYaml } = require('./yaml');
const {tenantStorageYaml, tenantDeploymentNotes} = require('../tenant-deployment');

function renderDockerCompose(model, environmentName = 'dev') {
    const resolved = resolveOperationsModel(model, environmentName);
    return renderResolvedCompose(resolved, environmentName);
}

function renderResolvedCompose(resolved, environmentName, gatewayRoot = `../../apisix/${environmentName}`) {
    const services = {};

    if (resolved.gateway?.enabled) {
        services[resolved.gateway.name] = gatewayService(resolved, gatewayRoot);
    }
    resolved.applications.forEach((application) => {
        services[application.name] = applicationService(application, resolved.infrastructure);
    });
    resolved.infrastructure.forEach((component) => {
        const service = infrastructureService(component);
        if (service) services[component.name] = service;
    });
    for (const service of Object.values(services)) {
        service.logging = {driver: 'json-file', options: {'max-size': '${LOG_MAX_SIZE:-10m}', 'max-file': '${LOG_MAX_FILES:-5}'}};
        service.restart ??= 'unless-stopped';
    }

    return renderYaml({
        name: `${resolved.name}-${environmentName}`,
        services,
        networks: {
            'medol-network': {
                driver: 'bridge'
            }
        },
        volumes: composeVolumes(resolved)
    });
}

function dockerComposeFiles(model, environmentName = 'dev', options = {}) {
    const root = trimRoot(options.root ?? `operations/docker-compose/${environmentName}`);
    const resolved = resolveOperationsModel(model, environmentName);
    const storage = resolved.applications.find((application) => application.tenantStorage)?.tenantStorage;
    const files = {
        [`${root}/docker-compose.yml`]: renderDockerCompose(model, environmentName),
        [`${root}/.env-example`]: renderEnvironmentExample(model, environmentName),
        [`${root}/.gitignore`]: '.env\n.env.*\n',
        [`${root}/infrastructure/postgres/init/01-create-databases.sql`]: renderPostgresInitSql(model),
        [`${root}/README.md`]: renderComposeReadme(environmentName, storage),
        ...(storage ? {[`${root}/configuration/tenant-storage.yml`]: tenantStorageYaml(storage)} : {}),
        ...Object.fromEntries(resolved.infrastructure.filter((component) => component.additional && component.type === 'postgres').map((component) => [
            `${root}/infrastructure/${component.name}/init/01-create-databases.sql`, renderPostgresInitSql(model, component)
        ]))
    };
    if (!options.combined && resolved.networkTopology?.sites?.length) {
        // The environment root is a guide; deployed services belong to explicit sites.
        delete files[`${root}/docker-compose.yml`];
        delete files[`${root}/.env-example`];
        files[`${root}/README.md`] = '# Compose deployment sites\n\nDeploy one sites/<site>/ directory at each modeled deployment site. Do not combine sites by applying the environment root.\n\n' + resolved.networkTopology.sites.map((site) => `- [${site.name}](sites/${site.name}/README.md)`).join('\n') + '\n';
        for (const site of resolved.networkTopology.sites) {
            if (!/^[a-z][a-z0-9-]*$/.test(site.name)) throw new Error(`Invalid Compose site name: ${site.name}`);
            const scoped = composeSiteModel(resolved, site);
            const siteRoot = `${root}/sites/${site.name}`;
            const scopedModel = {...scoped, environments: [{...resolved.environment, applicationOverrides: Object.fromEntries(scoped.applications.map((app) => [app.name, {image: app.image}])), infrastructureOverrides: {}}]};
            const generated = dockerComposeFiles(scopedModel, environmentName, {root: siteRoot, combined: true});
            generated[`${siteRoot}/docker-compose.yml`] = renderResolvedCompose(scoped, environmentName, './gateway');
            generated[`${siteRoot}/infrastructure/postgres/init/01-create-databases.sql`] = renderPostgresInitSql(scoped);
            if (scoped.gateway?.enabled) {
                const {renderApisixConfig, renderApisixStandaloneConfig} = require('./apisix-renderer');
                generated[`${siteRoot}/gateway/config.yaml`] = renderApisixConfig(scoped);
                generated[`${siteRoot}/gateway/apisix.yaml`] = renderApisixStandaloneConfig(scoped);
            }
            generated[`${siteRoot}/README.md`] += '\nThis is an isolated deployment site. Gateway configuration is local in gateway/. Required remote service URL variables in .env must point at reachable remote gateways, including the correct API path. Docker service names do not resolve across hosts. Shared credentials must agree across communicating sites.\n';
            generated[`${siteRoot}/README.md`] = generated[`${siteRoot}/README.md`]
                .replaceAll(`operations/docker-compose/${environmentName}/`, `${siteRoot}/`)
                .replaceAll(`operations/apisix/${environmentName}/`, `${siteRoot}/gateway/`);
            Object.assign(files, generated);
        }
    }
    return files;
}

function composeSiteModel(model, site) {
    const names = new Set(site.applications);
    const infrastructure = model.infrastructure.filter((item) => site.infrastructure.includes(item.name));
    const local = new Set(infrastructure.map((item) => item.name));
    const remote = new Set(model.applications.filter((item) => !names.has(item.name)).map((item) => item.name));
    for (const app of model.applications.filter((item) => names.has(item.name))) {
        const missing = app.dependencies.filter((name) => model.infrastructure.some((item) => item.name === name) && !local.has(name));
        if (missing.length) throw new Error(`Site ${site.name}: ${app.name} has non-local infrastructure dependencies ${missing.join(', ')}. Configure external URLs and override dependencies explicitly.`);
    }
    return {...model, name: `${model.name}-${site.name}`, networkTopology: undefined, infrastructure,
        applications: model.applications.filter((item) => names.has(item.name)).map((item) => ({...item,
            dependencies: item.dependencies.filter((name) => names.has(name) || local.has(name)),
            environmentVariables: item.environmentVariables.map((variable) => {
                let host;
                try {host = new URL(variable.value).hostname;} catch {return variable;}
                return remote.has(host) ? {...variable, value: '${' + variable.name + ':?Set reachable remote service URL}'} : variable;
            })
        })),
        gateway: site.gateway && model.gateway?.enabled ? {...model.gateway,
            routes: model.gateway.routes.filter((item) => names.has(item.upstreamId)),
            upstreams: model.gateway.upstreams.filter((item) => names.has(item.serviceName))
        } : undefined
    };
}

function gatewayService(resolved, gatewayRoot) {
    const gateway = resolved.gateway;
    const dependsOn = Object.fromEntries(resolved.applications.map((application) => [
        application.name,
        { condition: application.healthCheck ? 'service_healthy' : 'service_started' }
    ]));
    return {
        image: `\${APISIX_IMAGE:-${gateway.image}}`,
        restart: 'unless-stopped',
        ports: [
            `\${GATEWAY_PORT:-${gateway.hostPort}}:${gateway.servicePort}`
        ],
        volumes: [
            `${gatewayRoot}/config.yaml:/usr/local/apisix/conf/config.yaml:ro`,
            `${gatewayRoot}/apisix.yaml:/usr/local/apisix/conf/apisix.yaml:ro`
        ],
        depends_on: dependsOn,
        networks: ['medol-network']
    };
}

function applicationService(application, infrastructure) {
    const service = {
        image: `\${${application.envVarPrefix}_IMAGE:-${application.image}}`,
        restart: 'unless-stopped',
        expose: [String(application.servicePort)],
        environment: {
            ...(application.kind === 'backend' ? {
                MEDOL_SECURITY_JWT_SECRET: '${MEDOL_SECURITY_JWT_SECRET:?Set MEDOL_SECURITY_JWT_SECRET}',
                MEDOL_SECURITY_INTERNAL_TOKEN: '${MEDOL_SECURITY_INTERNAL_TOKEN:?Set MEDOL_SECURITY_INTERNAL_TOKEN}',
                MEDOL_SECURITY_ADMIN_BOOTSTRAP_ENABLED: '${MEDOL_SECURITY_ADMIN_BOOTSTRAP_ENABLED:-false}',
                MEDOL_SECURITY_ADMIN_BOOTSTRAP_SETUP_TOKEN: '${MEDOL_SECURITY_ADMIN_BOOTSTRAP_SETUP_TOKEN:-}',
                MEDOL_SECURITY_ALLOWED_ORIGINS: '${MEDOL_SECURITY_ALLOWED_ORIGINS:-}'
            } : {}),
            ...variablesObject(application.environmentVariables)
        },
        ...(application.resources?.limits ? {deploy: {resources: {limits: {
            ...(application.resources.limits.cpu ? {cpus: composeCpu(application.resources.limits.cpu)} : {}),
            ...(application.resources.limits.memory ? {memory: composeMemory(application.resources.limits.memory)} : {})
        }}}} : {}),
        ...(application.tenantStorage ? {volumes: ['./configuration/tenant-storage.yml:/etc/medol/tenant-storage.yml:ro']} : {}),
        networks: ['medol-network'],
        ...(application.dependencies.length > 0
            ? { depends_on: dependsOn(application.dependencies, infrastructure) }
            : {}),
        ...(application.healthCheck
            ? { healthcheck: httpHealthcheck(application.healthCheck, application.servicePort) }
            : {})
    };

    if (application.exposePorts) {
        service.ports = [
            `\${${application.envVarPrefix}_PORT:-${application.hostPort ?? application.servicePort}}:${application.servicePort}`
        ];
    }

    return service;
}

function infrastructureService(component) {
    if (component.type === 'postgres') {
        const service = {
            image: `\${POSTGRES_IMAGE:-${component.image}}`,
            restart: 'unless-stopped',
            expose: [String(component.servicePort)],
            environment: variablesObject(component.environmentVariables),
            healthcheck: {
                test: ['CMD-SHELL', component.healthCheck.command],
                interval: `${component.healthCheck.intervalSeconds}s`,
                timeout: `${component.healthCheck.timeoutSeconds}s`,
                retries: component.healthCheck.retries
            },
            volumes: [
                `${component.volumeName}:/var/lib/postgresql/data`,
                `./infrastructure/${component.additional ? component.name : 'postgres'}/init:/docker-entrypoint-initdb.d:ro`
            ],
            networks: ['medol-network']
        };
        if (component.exposePorts) {
            service.ports = [`\${${component.additional ? component.name.toUpperCase().replaceAll('-', '_') + '_PORT' : 'POSTGRES_PORT'}:-${component.hostPort ?? component.servicePort}}:${component.servicePort}`];
        }
        return service;
    }

    if (component.type === 'umadb') {
        const service = {
            image: `\${UMADB_IMAGE:-${component.image}}`,
            restart: 'unless-stopped',
            expose: [String(component.servicePort)],
            volumes: [
                `${component.volumeName}:/data`
            ],
            networks: ['medol-network']
        };
        if (component.exposePorts) {
            service.ports = [`\${${component.additional ? component.name.toUpperCase().replaceAll('-', '_') + '_PORT' : 'UMADB_PORT'}:-${component.hostPort ?? component.servicePort}}:${component.servicePort}`];
        }
        return service;
    }

    if (component.type === 'axon-server') {
        const service = {
            image: `\${AXON_SERVER_IMAGE:-${component.image}}`,
            hostname: component.name,
            ...(component.enabled === false ? { profiles: [component.profile ?? 'axon-server'] } : {}),
            expose: [String(component.servicePort), String(component.managementPort)],
            environment: variablesObject(component.environmentVariables),
            volumes: [
                `${component.volumeNames[0]}:/axonserver/data`,
                `${component.volumeNames[1]}:/axonserver/events`
            ],
            healthcheck: httpHealthcheck(component.healthCheck, component.managementPort),
            networks: ['medol-network']
        };
        if (component.exposePorts) {
            service.ports = [
                `\${AXON_SERVER_HTTP_PORT:-${component.managementPort}}:${component.managementPort}`,
                `\${AXON_SERVER_GRPC_PORT:-${component.servicePort}}:${component.servicePort}`
            ];
        }
        return service;
    }

    if (component.type === 'redis') {
        const service = {
            image: `\${REDIS_IMAGE:-${component.image}}`,
            restart: 'unless-stopped',
            expose: [String(component.servicePort)],
            volumes: [
                `${component.volumeName}:/data`
            ],
            networks: ['medol-network']
        };
        if (component.exposePorts) {
            service.ports = [`\${REDIS_PORT:-${component.servicePort}}:${component.servicePort}`];
        }
        return service;
    }

    return undefined;
}

function dependsOn(names, infrastructure = []) {
    return Object.fromEntries(names.map((name) => [
        name,
        { condition: name === 'postgres' || infrastructure.some((component) => component.name === name && component.type === 'postgres') ? 'service_healthy' : 'service_started' }
    ]));
}

function httpHealthcheck(healthCheck, port) {
    return {
        test: ['CMD-SHELL', `wget -qO- http://127.0.0.1:${port}${healthCheck.path} >/dev/null 2>&1 || exit 1`],
        interval: `${healthCheck.intervalSeconds}s`,
        timeout: `${healthCheck.timeoutSeconds}s`,
        retries: healthCheck.retries,
        ...((healthCheck.startupTimeoutSeconds ?? healthCheck.startPeriodSeconds) ? { start_period: `${healthCheck.startupTimeoutSeconds ?? healthCheck.startPeriodSeconds}s` } : {})
    };
}

function composeVolumes(model) {
    const volumes = {};
    model.infrastructure.forEach((component) => {
        if (component.volumeName) volumes[component.volumeName] = {};
        (component.volumeNames ?? []).forEach((volumeName) => {
            volumes[volumeName] = {};
        });
    });
    return volumes;
}

function variablesObject(variables = []) {
    return Object.fromEntries(
        variables
            .filter((variable) => variable.name)
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((variable) => [variable.name, variable.valueFromSecret ? (variable.value ?? `\${${variable.name}:?Set ${variable.name}}`) : variable.value])
    );
}

function renderEnvironmentExample(model, environmentName) {
    const resolved = resolveOperationsModel(model, environmentName);
    const storage = resolved.applications.find((application) => application.tenantStorage)?.tenantStorage;
    const lines = [
        `# Generated environment defaults for ${environmentName}.`,
        '# Copy values into your operations secret/env store and keep real secrets out of Git.',
        '',
        `GATEWAY_PORT=${resolved.environment.variables.GATEWAY_PORT ?? resolved.gateway?.servicePort ?? 9080}`,
        `APISIX_IMAGE=${resolved.gateway?.image ?? 'apache/apisix:3.13.0-debian'}`,
        'POSTGRES_USER=medol',
        'POSTGRES_PASSWORD=change-me',
        'POSTGRES_DB=medol',
        ...(resolved.applications.some((application) => application.kind === 'backend') ? [
            'MEDOL_SECURITY_INTERNAL_TOKEN=',
            'MEDOL_SECURITY_JWT_SECRET=',
            'MEDOL_SECURITY_ADMIN_BOOTSTRAP_ENABLED=false',
            'MEDOL_SECURITY_ADMIN_BOOTSTRAP_SETUP_TOKEN=',
            'MEDOL_SECURITY_ALLOWED_ORIGINS='
        ] : []),
        ...(resolved.applications.some((application) => application.tenantIsolation) ? [
            `DB_SCHEMA=${storage?.controlSchema ?? 'public'}`,
            '# Shared tenant storage schema.'
        ] : []),
        `POSTGRES_IMAGE=${resolved.infrastructure.find((component) => component.type === 'postgres')?.image ?? 'postgres:16'}`,
        `POSTGRES_PORT=${resolved.infrastructure.find((component) => component.type === 'postgres')?.servicePort ?? 5432}`,
        'MEDOL_AXON_EVENT_STORAGE=umadb',
        `UMADB_IMAGE=${resolved.infrastructure.find((component) => component.type === 'umadb')?.image ?? 'umadb/umadb:0.7.8'}`,
        `UMADB_TARGET=${resolved.infrastructure.find((component) => component.type === 'umadb')?.name ?? 'umadb'}:${resolved.infrastructure.find((component) => component.type === 'umadb')?.servicePort ?? 50051}`,
        'UMADB_PLAINTEXT=true',
        'UMADB_API_KEY=',
        'UMADB_BATCH_SIZE=256',
        'UMADB_REQUEST_TIMEOUT=PT10S',
        `UMADB_PORT=${resolved.infrastructure.find((component) => component.type === 'umadb')?.servicePort ?? 50051}`,
        `AXON_SERVER_IMAGE=${resolved.infrastructure.find((component) => component.type === 'axon-server')?.image ?? 'axoniq/axonserver:2026.0.3-jdk-21'}`,
        `AXON_SERVER_SERVERS=${resolved.infrastructure.find((component) => component.type === 'axon-server')?.name ?? 'axon-server'}:${resolved.infrastructure.find((component) => component.type === 'axon-server')?.servicePort ?? 8124}`,
        'AXON_UPDATE_CHECK_DISABLED=true',
        'VITE_SUPABASE_API_KEY=',
        ''
    ];

    resolved.applications.forEach((application) => {
        lines.push(`${application.envVarPrefix}_IMAGE=${application.image}`);
        if (application.exposePorts) {
            lines.push(`${application.envVarPrefix}_PORT=${application.hostPort ?? application.servicePort}`);
        }
    });

    const existingKeys = new Set(lines.map((line) => line.split('=')[0]));
    for (const app of resolved.applications) {
        for (const variable of app.environmentVariables) {
            const match = typeof variable.value === 'string' && variable.value.match(/^\$\{([A-Z0-9_]+):\?Set reachable remote service URL\}$/);
            if (match && !existingKeys.has(match[1])) {
                lines.push(`# Required remote endpoint for ${app.name}; include the gateway API path.`, `${match[1]}=`);
                existingKeys.add(match[1]);
            }
        }
    }

    lines.push(
        '',
        'MONOREPO_ROOT=../..',
        `DOCKER_IMAGE_PREFIX=${resolved.imagePrefix ?? resolved.name}`,
        `DEPENDENCY_IMAGE_PREFIX=${resolved.dependencyImagePrefix ?? resolved.imagePrefix ?? resolved.name}`,
        `IMAGE_VERSION=${resolved.imageTag ?? '0.0.1-SNAPSHOT'}`,
        'IMAGE_BUNDLE_OUTPUT=.work/image-bundle',
        'IMAGE_BUNDLE_ARCHIVE=.work/image-bundle.tar.gz',
        'DOCKER_DEFAULT_PLATFORM=',
        'EXTRA_DEPENDENCY_IMAGES=',
        'OPERATIONS_NO_FAST_BUILD=false',
        'OPERATIONS_FULL_IMAGE_BUILD=false',
        '',
        'HARBOR_INSTALLER=',
        'ZOT_IMAGE=ghcr.io/project-zot/zot-linux-amd64:v2.1.8',
        'ZOT_HTTP_PORT=5000',
        ''
    );
    return lines.join('\n');
}

function renderPostgresInitSql(model, component) {
    const databaseNames = component?.additional ? component.databases : model.applications
        .filter((application) => application.kind === 'backend')
        .map((application) => databaseName(application))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
    return [
        '-- Generated by the Medol operations generator.',
        '-- This file runs during the first PostgreSQL container initialization.',
        ...[...new Set(databaseNames)].map((name) => `SELECT 'CREATE DATABASE "${name}";' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${name}')${String.fromCharCode(92)}gexec`),
        ''
    ].join('\n');
}

function databaseName(application) {
    const dbUrl = application.environmentVariables.find((variable) => variable.name === 'DB_URL')?.value;
    return dbUrl?.split('/').pop();
}

function localApplicationImageName(model, application) {
    return `${model.imagePrefix ?? model.name}/${application.artifactName ?? application.name}`;
}

function imageWithTag(imageName, tag) {
    if (!tag || imageName.includes(':')) return imageName;
    return `${imageName}:${tag}`;
}

function renderComposeReadme(environmentName, storage) {
    return [
        '# Docker Compose Deployment',
        '',
        'Generated by the Medol operations generator.',
        '',
        `Run the ${environmentName} topology from this directory:`,
        '',
        '```bash',
        'cp .env-example .env',
        '# Replace example credentials, select immutable image tags, then validate:',
        'docker compose --env-file .env config --quiet',
        'docker compose --env-file .env pull',
        'docker compose --env-file .env up -d --wait --wait-timeout 300',
        '```',
        '',
        `Run Compose from \`operations/docker-compose/${environmentName}/\` so its relative mounts resolve correctly. The APISIX configuration is read from \`operations/apisix/${environmentName}/\`.`,
        '',
        'APISIX is the primary external entrypoint. Internal services communicate through the `medol-network` Docker network.',
        'Only the gateway is published by default. Put TLS termination in front of it and restrict backend/database access.',
        'Container names and named volumes are project-scoped. Keep the same project name and working directory during upgrades.',
        'Use different GATEWAY_PORT values when running multiple environments on one host.',
        'Runtime environment variables do not replace frontend build-time settings unless the image supports runtime configuration.',
        'Required JWT and internal tokens must be supplied explicitly. .env is private but its values remain visible to Docker administrators.',
        'Enable administrator bootstrap only for initial setup, supply its setup token, then disable it and recreate affected services.',
        'For offline deployment load every required architecture-matched archive with docker load and omit pull.',
        'Transfer the APISIX directory and database initialization files along with this directory; relative mounts are required.',
        'Before upgrades record old image digests and take a consistent database backup. Initialization SQL only runs on empty database volumes.',
        'Do not use down -v during upgrades. Rolling back an image does not reverse database migrations.',
        'Health checks require wget in the application image. Compose unhealthy status alone does not restart a running container.',
        'The generic Compose topology does not provision business runtime engines or grant host Docker socket access.',
        '',
        ...(storage ? tenantDeploymentNotes() : [])
    ].join('\n');
}

module.exports = {
    dockerComposeFiles,
    renderPostgresInitSql,
    renderDockerCompose
};

function trimRoot(value) {
    return String(value ?? '').replace(/^\/+|\/+$/g, '') || '.';
}

function composeCpu(value) {
    return String(value).endsWith('m') ? String(Number(String(value).slice(0, -1)) / 1000) : String(value);
}

function composeMemory(value) {
    return String(value).replace(/Ki$/, 'k').replace(/Mi$/, 'm').replace(/Gi$/, 'g');
}
