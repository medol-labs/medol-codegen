/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

function resolveDeploymentModel(model, environmentName = 'dev') {
    const environment = model.environments.find((candidate) => candidate.name === environmentName)
        ?? model.environments[0]
        ?? { name: environmentName, variables: {}, applicationOverrides: {}, infrastructureOverrides: {} };

    return {
        ...model,
        environment,
        applications: model.applications.map((application) => resolveApplication(application, environment, model.imageTag)),
        infrastructure: model.infrastructure.map((component) => resolveInfrastructure(component, environment)),
        ...(model.gateway ? { gateway: resolveGateway(model.gateway, environment) } : {})
    };
}

function resolveApplication(application, environment, defaultImageTag) {
    const override = environment.applicationOverrides?.[application.name] ?? {};
    const imageTag = override.imageTag ?? environment.variables?.IMAGE_TAG ?? defaultImageTag;
    return {
        ...application,
        ...override,
        image: override.image ?? imageWithTag(application.imageName, imageTag),
        replicas: override.replicas ?? application.deploymentProfile?.replicas ?? 1,
        exposePorts: Boolean(override.exposePorts),
        environmentVariables: mergeEnvironmentVariables(
            application.environmentVariables,
            override.environmentVariables
        )
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
    resolveDeploymentModel
};
