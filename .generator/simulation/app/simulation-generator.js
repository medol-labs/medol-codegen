/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const { simulationFiles } = require('./renderers/kotlin-renderer');

const targets = ['all', 'model', 'runtime', 'scenarios'];

function generateSimulationFiles(model, options = {}) {
    const target = targets.includes(options.target) ? options.target : 'all';
    return simulationFiles(model, {
        target,
        root: options.root ?? 'simulation/generated'
    });
}

module.exports = {
    generateSimulationFiles,
    targets
};
