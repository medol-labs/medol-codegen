/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const { resolveDeploymentModel } = require('../environment-resolver');
const { renderYaml } = require('./yaml');

function renderDockerCompose(model, environmentName = 'dev') {
    const resolved = resolveDeploymentModel(model, environmentName);
    const services = {};

    if (resolved.gateway?.enabled) {
        services[resolved.gateway.name] = gatewayService(resolved);
    }
    resolved.applications.forEach((application) => {
        services[application.name] = applicationService(application);
    });
    resolved.infrastructure.forEach((component) => {
        const service = infrastructureService(component);
        if (service) services[component.name] = service;
    });

    return renderYaml({
        name: `${resolved.name}-${resolved.environment.name}`,
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
    const root = trimRoot(options.root ?? environmentName);
    return {
        [`${root}/docker-compose/docker-compose.yml`]: renderDockerCompose(model, environmentName),
        [`${root}/.env-example`]: renderEnvironmentExample(model, environmentName),
        [`${root}/infrastructure/postgres/init/01-create-databases.sql`]: renderPostgresInitSql(model),
        [`${root}/docker-compose/README.md`]: renderComposeReadme(environmentName)
    };
}

function gatewayService(resolved) {
    const gateway = resolved.gateway;
    const dependsOn = Object.fromEntries(resolved.applications.map((application) => [
        application.name,
        { condition: application.healthCheck ? 'service_healthy' : 'service_started' }
    ]));
    return {
        image: `\${APISIX_IMAGE:-${gateway.image}}`,
        container_name: `\${APISIX_CONTAINER_NAME:-${gateway.name}}`,
        restart: 'unless-stopped',
        ports: [
            `\${GATEWAY_PORT:-${gateway.hostPort}}:${gateway.servicePort}`
        ],
        volumes: [
            '../infrastructure/apisix/config.yaml:/usr/local/apisix/conf/config.yaml:ro',
            '../infrastructure/apisix/apisix.yaml:/usr/local/apisix/conf/apisix.yaml:ro'
        ],
        depends_on: dependsOn,
        networks: ['medol-network']
    };
}

function applicationService(application) {
    const service = {
        image: `\${${application.envVarPrefix}_IMAGE:-${application.image}}`,
        container_name: `\${${application.envVarPrefix}_CONTAINER_NAME:-${application.name}}`,
        restart: 'unless-stopped',
        expose: [String(application.servicePort)],
        environment: variablesObject(application.environmentVariables),
        networks: ['medol-network'],
        ...(application.dependencies.length > 0
            ? { depends_on: dependsOn(application.dependencies) }
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
                '../infrastructure/postgres/init:/docker-entrypoint-initdb.d:ro'
            ],
            networks: ['medol-network']
        };
        if (component.exposePorts) {
            service.ports = [`\${POSTGRES_PORT:-${component.servicePort}}:${component.servicePort}`];
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
            service.ports = [`\${UMADB_PORT:-${component.servicePort}}:${component.servicePort}`];
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

function dependsOn(names) {
    return Object.fromEntries(names.map((name) => [
        name,
        { condition: name === 'postgres' ? 'service_healthy' : 'service_started' }
    ]));
}

function httpHealthcheck(healthCheck, port) {
    return {
        test: ['CMD-SHELL', `wget -qO- http://127.0.0.1:${port}${healthCheck.path} >/dev/null 2>&1 || exit 1`],
        interval: `${healthCheck.intervalSeconds}s`,
        timeout: `${healthCheck.timeoutSeconds}s`,
        retries: healthCheck.retries,
        ...(healthCheck.startPeriodSeconds ? { start_period: `${healthCheck.startPeriodSeconds}s` } : {})
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
            .map((variable) => [variable.name, variable.value])
    );
}

function renderEnvironmentExample(model, environmentName) {
    const resolved = resolveDeploymentModel(model, environmentName);
    const lines = [
        `# Generated environment defaults for ${environmentName}.`,
        '# Copy values into your deployment secret/env store and keep real secrets out of Git.',
        '',
        `GATEWAY_PORT=${resolved.environment.variables.GATEWAY_PORT ?? resolved.gateway?.servicePort ?? 9080}`,
        'POSTGRES_USER=medol',
        'POSTGRES_PASSWORD=change-me',
        'POSTGRES_DB=medol',
        'MEDOL_AXON_EVENT_STORAGE=umadb',
        'UMADB_API_KEY=',
        'UMADB_BATCH_SIZE=256',
        'UMADB_REQUEST_TIMEOUT=PT10S',
        'AXON_UPDATE_CHECK_DISABLED=true',
        ''
    ];

    resolved.applications.forEach((application) => {
        lines.push(`${application.envVarPrefix}_IMAGE=${application.image}`);
        if (application.exposePorts) {
            lines.push(`${application.envVarPrefix}_PORT=${application.hostPort ?? application.servicePort}`);
        }
    });

    lines.push('');
    return lines.join('\n');
}

function renderPostgresInitSql(model) {
    const databaseNames = model.applications
        .filter((application) => application.kind === 'backend')
        .map((application) => databaseName(application))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
    return [
        '-- Generated by the Medol deploy generator.',
        '-- This file runs during the first PostgreSQL container initialization.',
        ...databaseNames.map((name) => `SELECT 'CREATE DATABASE "${name}";' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${name}')\\gexec`),
        ''
    ].join('\n');
}

function databaseName(application) {
    const dbUrl = application.environmentVariables.find((variable) => variable.name === 'DB_URL')?.value;
    return dbUrl?.split('/').pop();
}

function renderComposeReadme(environmentName) {
    return [
        '# Docker Compose Deployment',
        '',
        'Generated by the Medol deploy generator.',
        '',
        `Run the ${environmentName} topology from this directory:`,
        '',
        '```bash',
        'cp ../.env-example .env',
        'docker compose --env-file .env up -d',
        '```',
        '',
        'APISIX is the primary external entrypoint. Internal services communicate through the `medol-network` Docker network.',
        ''
    ].join('\n');
}

module.exports = {
    dockerComposeFiles,
    renderDockerCompose
};

function trimRoot(value) {
    return String(value ?? '').replace(/^\/+|\/+$/g, '') || '.';
}
