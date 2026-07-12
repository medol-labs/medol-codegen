/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {
    normalizeArray,
    contextName,
    cleanTitle,
    kebab,
    snakeCase
} = require('./model-utils');

function buildBackendModules(source) {
    const deployments = normalizeArray(source.deployments);
    if (deployments.length === 0) {
        return [{
            name: 'default',
            label: 'Backend',
            dataProviderName: 'command',
            envName: 'VITE_AXON_API_URL',
            defaultApiUrl: 'http://localhost:8080',
            contexts: new Set((source.contexts ?? []).map((context) => context.name).filter(Boolean))
        }];
    }

    return deployments.map((deployment, index) => {
        const label = cleanTitle(deployment.title ?? deployment.name) || `Backend ${index + 1}`;
        const dataProviderName = kebab(deployment.title ?? deployment.name ?? label) || `backend-${index + 1}`;
        return {
            name: dataProviderName,
            label,
            dataProviderName,
            envName: `VITE_${snakeCase(dataProviderName).toUpperCase()}_API_URL`,
            defaultApiUrl: `http://localhost:${8080 + index}`,
            contexts: new Set(normalizeArray(deployment.contexts)
                .map((context) => typeof context === 'string' ? context : context.name)
                .filter(Boolean))
        };
    });
}

function backendModuleForContext(contextName, modules) {
    return modules.find((module) => module.contexts.has(contextName)) ?? modules[0];
}

function withModuleResourceRoutes(modules, resources) {
    return modules.map((module) => {
        const moduleResources = resources
            .filter((resource) => resource.dataProviderName === module.dataProviderName)
            .map((resource) => resource.route)
            .sort((a, b) => a.localeCompare(b));
        return {
            ...module,
            contexts: Array.from(module.contexts),
            resourceRoutes: moduleResources,
            homeRoute: moduleResources[0] ? `/${moduleResources[0]}` : '/dashboard'
        };
    });
}

module.exports = {
    buildBackendModules,
    backendModuleForContext,
    withModuleResourceRoutes
};
