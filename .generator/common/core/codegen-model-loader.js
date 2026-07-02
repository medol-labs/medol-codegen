/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const fs = require('fs');

function loadCodegenModel(cwd) {
    const path = `${cwd}/codegen-model.json`;
    if (!fs.existsSync(path)) {
        throw new Error(`No codegen-model.json found in ${cwd}. The axon5 generator only accepts the Medol CodegenModel.`);
    }

    const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
    const requiredArrays = ['contexts', 'slices'];
    for (const property of requiredArrays) {
        if (!Array.isArray(raw[property])) {
            throw new Error(`Invalid CodegenModel: ${property} must be an array.`);
        }
    }

    const selectedDeployment = selectDeployment(raw);
    const selectedDomain = selectedDeployment ? undefined : selectDomain(raw);
    const model = selectedDeployment
        ? filterByDeployment(raw, selectedDeployment)
        : selectedDomain
            ? filterByDomain(raw, selectedDomain)
            : raw;

    return {
        ...model,
        rootPackage: model.rootPackage || 'tech.medo',
        domain: model.domain || 'MedolApplication',
        domains: array(model.domains),
        deployments: array(model.deployments),
        contexts: model.contexts,
        valueTypes: array(model.valueTypes),
        aggregates: array(model.aggregates),
        concepts: array(model.concepts).length > 0
            ? array(model.concepts)
            : model.contexts.flatMap((context) =>
                array(context.concepts).map((concept) => ({
                    ...concept,
                    context: concept.context ?? context.name
                }))
            ),
        transitions: array(model.transitions),
        actors: array(model.actors),
        slices: model.slices.map((slice, index) => ({
            ...slice,
            index: slice.index ?? index,
            tags: array(slice.tags),
            concepts: array(slice.concepts),
            commands: array(slice.commands),
            events: array(slice.events),
            readmodels: array(slice.readmodels),
            screens: array(slice.screens),
            processors: array(slice.processors),
            specifications: array(slice.specifications),
            actors: array(slice.actors),
            hotspots: array(slice.hotspots)
        }))
    };
}

function selectDomain(raw) {
    if (!Array.isArray(raw.domains) || raw.domains.length <= 1) {
        return undefined;
    }
    return process.env.CODEGEN_DOMAIN || raw.domain || raw.domains[0]?.name;
}

function selectDeployment(raw) {
    if (!Array.isArray(raw.deployments) || raw.deployments.length === 0) {
        return undefined;
    }
    return process.env.CODEGEN_DEPLOYMENT;
}

function filterByDeployment(raw, deploymentName) {
    const deployment = array(raw.deployments).find((item) => item.name === deploymentName);
    if (!deployment) {
        throw new Error(`Invalid CodegenModel: deployment ${deploymentName} does not exist.`);
    }
    const contextNames = new Set(array(deployment.contexts).map((context) => context.name));
    const contexts = array(raw.contexts).filter((context) => contextNames.has(context.name));
    if (contexts.length === 0) {
        throw new Error(`Invalid CodegenModel: deployment ${deploymentName} has no contexts.`);
    }
    return filterByContextNames(raw, contextNames, {
        domain: raw.domain,
        deployment: deploymentName,
        deployments: [deployment]
    });
}

function filterByDomain(raw, domainName) {
    const contexts = array(raw.contexts).filter((context) => context.domain === domainName);
    if (contexts.length === 0) {
        throw new Error(`Invalid CodegenModel: domain ${domainName} has no contexts.`);
    }
    const contextNames = new Set(contexts.map((context) => context.name));
    return filterByContextNames(raw, contextNames, {
        domain: domainName,
        selectedDomain: domainName
    });
}

function filterByContextNames(raw, contextNames, overrides = {}) {
    const inSelectedContext = (item) => !item?.context || contextNames.has(item.context);
    return {
        ...raw,
        ...overrides,
        contexts: array(raw.contexts).filter((context) => contextNames.has(context.name)),
        valueTypes: array(raw.valueTypes).filter(inSelectedContext),
        aggregates: array(raw.aggregates).filter(inSelectedContext),
        concepts: array(raw.concepts).filter(inSelectedContext),
        transitions: array(raw.transitions).filter(inSelectedContext),
        slices: array(raw.slices).filter((slice) => contextNames.has(slice.context ?? slice.chapter))
    };
}

function array(value) {
    return Array.isArray(value) ? value : [];
}

module.exports = {loadCodegenModel};
