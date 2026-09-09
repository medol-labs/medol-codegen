/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const fs = require('fs');
const path = require('path');
const { writeGeneratorWorkspaceFiles } = require('./workspace-templates');

function loadMedolWorkspace(cwd, options = {}) {
    const configPath = resolveMedolConfigPath(cwd, options);
    const config = configPath ? readConfig(configPath) : {};
    return {
        root: cwd,
        medolDirectory: path.join(cwd, '.medol'),
        configPath,
        config,
        codegenModelPath: resolveCodegenModelPath(cwd, options, config),
        translationsPath: resolveTranslationsPath(cwd, options, config)
    };
}

function resolveCodegenModelPath(cwd, options = {}, config = {}) {
    const explicit = options.codegenModel
        ?? options.codegenModelPath
        ?? options.model
        ?? process.env.CODEGEN_MODEL_PATH
        ?? config.codegenModel
        ?? config.codegenModelPath
        ?? config.model;
    const candidates = [
        explicit,
        '.medol/codegen-model.json',
        'codegen-model.json'
    ].filter(Boolean).map((candidate) => absolutePath(cwd, candidate));
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function resolveTranslationsPath(cwd, options = {}, config = {}) {
    const explicit = options.translations
        ?? options.translationsPath
        ?? process.env.CODEGEN_TRANSLATIONS_PATH
        ?? config.translations
        ?? config.translationsPath;
    if (explicit) return absolutePath(cwd, explicit);
    return undefined;
}

function resolveMedolConfigPath(cwd, options = {}) {
    const explicit = options.medolConfig
        ?? options.medolConfigPath
        ?? options.config
        ?? process.env.MEDOL_CONFIG_PATH;
    const candidates = [
        explicit,
        '.medol/medol.yml',
        '.medol/medol.yaml',
        'medol.yml',
        'medol.yaml'
    ].filter(Boolean).map((candidate) => absolutePath(cwd, candidate));
    return candidates.find((candidate) => fs.existsSync(candidate));
}

function generatorConfig(workspace, generatorName) {
    const config = workspace?.config ?? {};
    return config.generators?.[generatorName]
        ?? config.generator?.[generatorName]
        ?? config[generatorName]
        ?? {};
}

function generatorOutputRoot(workspace, generatorName, fallback = '.') {
    const config = generatorConfig(workspace, generatorName);
    return config.output
        ?? config.outputRoot
        ?? config.directory
        ?? workspace?.config?.outputs?.[generatorName]
        ?? fallback;
}

function writeWorkspaceFiles(generator, workspace) {
    writeGeneratorWorkspaceFiles(generator, workspace);
}

function readConfig(file) {
    const text = fs.readFileSync(file, 'utf8');
    if (/^\s*[{\[]/.test(text)) return JSON.parse(text);
    return parseSimpleYaml(text);
}

function parseSimpleYaml(text) {
    const root = {};
    const stack = [{ indent: -1, value: root }];
    text.split(/\r?\n/).forEach((line) => {
        const withoutComment = line.replace(/\s+#.*$/, '');
        if (!withoutComment.trim()) return;
        const indent = withoutComment.match(/^\s*/)[0].length;
        const match = withoutComment.trim().match(/^([^:]+):(.*)$/);
        if (!match) return;
        const key = match[1].trim();
        const rest = match[2].trim();
        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
            stack.pop();
        }
        const parent = stack[stack.length - 1].value;
        if (rest === '') {
            parent[key] = {};
            stack.push({ indent, value: parent[key] });
        } else {
            parent[key] = parseScalar(rest);
        }
    });
    return root;
}

function parseScalar(value) {
    const unquoted = value.replace(/^['"]|['"]$/g, '');
    if (unquoted === 'true') return true;
    if (unquoted === 'false') return false;
    if (unquoted === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(unquoted)) return Number(unquoted);
    return unquoted;
}

function absolutePath(cwd, file) {
    return path.isAbsolute(file) ? file : path.join(cwd, file);
}

module.exports = {
    generatorConfig,
    generatorOutputRoot,
    loadMedolWorkspace,
    writeWorkspaceFiles
};
