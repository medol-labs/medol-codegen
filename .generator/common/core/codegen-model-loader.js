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

    return {
        ...raw,
        rootPackage: raw.rootPackage || 'tech.medo',
        domain: raw.domain || 'MedolApplication',
        contexts: raw.contexts,
        valueTypes: array(raw.valueTypes),
        aggregates: array(raw.aggregates),
        concepts: array(raw.concepts),
        actors: array(raw.actors),
        slices: raw.slices.map((slice, index) => ({
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

function array(value) {
    return Array.isArray(value) ? value : [];
}

module.exports = {loadCodegenModel};
