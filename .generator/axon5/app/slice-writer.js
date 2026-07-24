/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {sliceOrchestratorMethods} = require('./slice-orchestrator');
const {selectionWriterMethods} = require('./selection-writer');
const {commandWriterMethods} = require('./command-writer');
const {infrastructurePortWriterMethods} = require('./infrastructure-port-writer');
const {stateWriterMethods} = require('./state-writer');
const {readModelWriterMethods} = require('./read-model-writer');
const {processorWriterMethods} = require('./processor-writer');
const {testWriterMethods} = require('./test-writer');

const sliceWriterMethods = Object.assign(
    {},
    sliceOrchestratorMethods,
    selectionWriterMethods,
    commandWriterMethods,
    infrastructurePortWriterMethods,
    stateWriterMethods,
    readModelWriterMethods,
    processorWriterMethods,
    testWriterMethods
);

module.exports = {sliceWriterMethods};
