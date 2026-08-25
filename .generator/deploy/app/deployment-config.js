/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const fs = require('fs');
const path = require('path');

const configFiles = [
    'deploy.config.json',
    'deployment.config.json'
];

function loadDeploymentConfig(cwd) {
    const configPath = configFiles
        .map((file) => path.join(cwd, file))
        .find((file) => fs.existsSync(file));
    if (!configPath) return {};
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

module.exports = {
    loadDeploymentConfig
};
