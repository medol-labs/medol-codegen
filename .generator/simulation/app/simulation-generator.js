/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const { simulationFiles } = require('./renderers/service-renderer');

const targets = ['all', 'model', 'service', 'runtime', 'scenarios'];

function generateSimulationFiles(model, options = {}) {
    const target = targets.includes(options.target) ? options.target : 'all';
    return simulationFiles(model, {
        target,
        root: options.root ?? '.'
    });
}

module.exports = {
    generateSimulationFiles,
    targets
};
