/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const fs = require('fs');
const { fromCodegenModel, fromConfig, toGeneratorConfig } = require('./codegen-model');

function loadGeneratorModel(cwd) {
    const codegenModelPath = `${cwd}/codegen-model.json`;
    const configPath = `${cwd}/config.json`;

    if (fs.existsSync(codegenModelPath)) {
        const rawCodegenModel = readJson(codegenModelPath);
        const codegenModel = fromCodegenModel(rawCodegenModel);
        return {
            inputKind: 'codegen-model',
            rawCodegenModel,
            rawConfig: undefined,
            codegenModel,
            config: toGeneratorConfig(codegenModel)
        };
    }

    if (!fs.existsSync(configPath)) {
        throw new Error(`❌ No codegen-model.json or config.json found in ${cwd}. Please export codegen-model.json from Event Modeling Toolkit first.`);
    }

    const rawConfig = readJson(configPath);
    const codegenModel = fromConfig(rawConfig);
    return {
        inputKind: 'config',
        rawConfig,
        rawCodegenModel: undefined,
        codegenModel,
        config: toGeneratorConfig(codegenModel, rawConfig)
    };
}

function readJson(path) {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
}

module.exports = {
    loadGeneratorModel
};
