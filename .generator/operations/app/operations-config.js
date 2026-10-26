/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const fs = require('fs');
const path = require('path');
const {parseSimpleYaml} = require('../../common/core/medol-workspace');

const configFiles = [
    'operations.config.json'
];

function merge(base, override) {
    if (!base || typeof base !== 'object' || Array.isArray(base) || !override || typeof override !== 'object' || Array.isArray(override)) return override;
    return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(override)])].map((key) => [
        key, key in override ? (key in base ? merge(base[key], override[key]) : override[key]) : base[key]
    ]));
}

function loadOperationsConfig(cwd, workspace = {}, environment = 'dev') {
    if (!/^[a-z][a-z0-9-]*$/.test(environment)) throw new Error(`Invalid operations environment: ${environment}`);
    const workspaceConfig = workspace.config?.operations
        ?? workspace.config?.generators?.operations?.config
        ?? {};
    const configPath = configFiles
        .map((file) => path.join(cwd, file))
        .find((file) => fs.existsSync(file));
    const fileRaw = configPath ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    const fileConfig = fileRaw.operations ?? fileRaw;
    const root = path.join(cwd, 'operations', 'config');
    const names = ['common.yml', `${environment}.yml`, `${environment}.private.yml`];
    const hasDedicatedConfig = names.some((name) => fs.existsSync(path.join(root, name)));
    const config = names.reduce((merged, name) => {
        const file = path.join(root, name);
        if (!fs.existsSync(file)) return merged;
        const raw = parseSimpleYaml(fs.readFileSync(file, 'utf8'));
        return merge(merged, raw.operations ?? raw);
    }, hasDedicatedConfig ? {} : merge(fileConfig, workspaceConfig));
    return {operations: config};
}

module.exports = {
    loadOperationsConfig
};
