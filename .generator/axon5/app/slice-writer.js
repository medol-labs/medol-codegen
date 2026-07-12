/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {sliceOrchestratorMethods} = require('./slice-orchestrator');
const {selectionWriterMethods} = require('./selection-writer');
const {commandWriterMethods} = require('./command-writer');
const {stateWriterMethods} = require('./state-writer');
const {readModelWriterMethods} = require('./read-model-writer');

const sliceWriterMethods = Object.assign(
    {},
    sliceOrchestratorMethods,
    selectionWriterMethods,
    commandWriterMethods,
    stateWriterMethods,
    readModelWriterMethods
);

module.exports = {sliceWriterMethods};
