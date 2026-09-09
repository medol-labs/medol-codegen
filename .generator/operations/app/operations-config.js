/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const fs = require('fs');
const path = require('path');

const configFiles = [
    'operations.config.json'
];

function loadOperationsConfig(cwd, workspace = {}) {
    const workspaceConfig = workspace.config?.operations
        ?? workspace.config?.generators?.operations?.config
        ?? {};
    const configPath = configFiles
        .map((file) => path.join(cwd, file))
        .find((file) => fs.existsSync(file));
    const fileRaw = configPath ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    const fileConfig = fileRaw.operations ?? fileRaw;
    return {
        operations: {
            ...fileConfig,
            ...workspaceConfig
        }
    };
}

module.exports = {
    loadOperationsConfig
};
