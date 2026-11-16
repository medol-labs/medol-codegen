/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {resolveTenantStorage, validateTenantEnvironment} = require('./tenant-deployment');
const {resolveObservability, applicationObservability} = require('./observability');

function resolveOperationsModel(model, environmentName = 'dev') {
    const environment = model.environments.find((candidate) => candidate.name === environmentName)
        ?? model.environments[0]
        ?? { name: environmentName, variables: {}, applicationOverrides: {}, infrastructureOverrides: {} };

    const tenancy = model.applications.some((application) => application.kind === 'backend' && application.tenantIsolation)
        ? resolveTenantStorage(model.tenancy, environment.tenancy) : undefined;
    const observability = resolveObservability({...model.observability, ...environment.observability}, environment.name);
    const browserOrigins = resolveBrowserOrigins(environment.browserOrigins);
    return {
        ...model,
        environment,
        observability,
        applications: model.applications.map((application) => {
            const resolved = resolveApplication(application, environment, model.imageTag, tenancy);
            if (browserOrigins && resolved.kind === 'backend') resolved.environmentVariables = mergeEnvironmentVariables(
                [{name: 'MEDOL_SECURITY_ALLOWED_ORIGINS', value: browserOrigins.join(',')}], resolved.environmentVariables);
            if (model.observability || environment.observability) resolved.environmentVariables = mergeEnvironmentVariables(
                applicationObservability(resolved, observability, environment.name), resolved.environmentVariables);
            return resolved;
        }),
        infrastructure: model.infrastructure.map((component) => resolveInfrastructure(component, environment)),
        ...(model.gateway ? { gateway: resolveGateway(model.gateway, environment) } : {})
    };
}

function resolveBrowserOrigins(origins) {
    if (origins === undefined) return undefined;
    if (!Array.isArray(origins) || !origins.length) throw new Error('browserOrigins must be a nonempty array of exact HTTP(S) origins');
    return [...new Set(origins.map(origin => {
        let url;
        try { url = new URL(origin); } catch { throw new Error(`Invalid browser origin: ${origin}`); }
        if (typeof origin !== 'string' || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
            || url.search || url.hash || url.pathname !== '/' || origin.includes('*')) {
            throw new Error('browserOrigins requires exact HTTP(S) origins without credentials, paths or wildcards');
        }
        return url.origin;
    }))];
}

function resolveApplication(application, environment, defaultImageTag, tenancy) {
    const override = environment.applicationOverrides?.[application.name] ?? {};
    const imageTag = override.imageTag ?? environment.variables?.IMAGE_TAG ?? defaultImageTag;
    const tenantStorage = application.kind === 'backend' && application.tenantIsolation ? tenancy : undefined;
    const variables = mergeEnvironmentVariables(application.environmentVariables, override.environmentVariables).map((variable) => ({...variable}));
    if (tenantStorage) {
        validateTenantEnvironment(variables, tenantStorage);
        const additional = variables.find((variable) => variable.name === 'SPRING_CONFIG_ADDITIONAL_LOCATION');
        if (additional?.valueFromSecret) throw new Error('Tenant configuration location cannot be supplied through a Secret.');
        variables.push({name: 'SPRING_CONFIG_ADDITIONAL_LOCATION', value: [...new Set([...(additional?.value ? String(additional.value).split(',') : []), 'file:/etc/medol/tenant-storage.yml'])].join(',')});
        const schema = variables.find((variable) => variable.name === 'DB_SCHEMA');
        if (schema?.value === '${DB_SCHEMA:-public}') schema.value = `\${DB_SCHEMA:-${tenantStorage.controlSchema}}`;
    }
    return {
        ...application,
        ...override,
        image: override.image ?? imageWithTag(application.imageName, imageTag),
        replicas: override.replicas ?? application.deploymentProfile?.replicas ?? 1,
        exposePorts: Boolean(override.exposePorts),
        environmentVariables: mergeEnvironmentVariables(variables),
        ...((application.healthCheck || override.healthCheck) ? {healthCheck: {...application.healthCheck, ...override.healthCheck}} : {}),
        ...(tenantStorage ? {
            tenantStorage,
            healthCheck: {...application.healthCheck, ...override.healthCheck,
                startupTimeoutSeconds: tenantStorage.startupTimeoutSeconds,
                ...(tenantStorage.migration.enabled ? {startPeriodSeconds: tenantStorage.startupTimeoutSeconds} : {})}
        } : {})
    };
}

function resolveInfrastructure(component, environment) {
    const override = environment.infrastructureOverrides?.[component.name] ?? {};
    return {
        ...component,
        ...override,
        exposePorts: Boolean(override.exposePorts),
        environmentVariables: mergeEnvironmentVariables(
            component.environmentVariables,
            override.environmentVariables
        )
    };
}

function resolveGateway(gateway, environment) {
    return {
        ...gateway,
        hostPort: Number.parseInt(environment.variables?.GATEWAY_PORT ?? '', 10) || gateway.servicePort
    };
}

function mergeEnvironmentVariables(base = [], override = []) {
    const byName = new Map();
    [...base, ...override].filter(Boolean).forEach((variable) => {
        byName.set(variable.name, variable);
    });
    return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function imageWithTag(imageName, tag) {
    if (!tag || imageName.includes(':')) return imageName;
    return `${imageName}:${tag}`;
}

module.exports = {
    resolveOperationsModel
};
