/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const fs = require('fs');
const path = require('path');
const { writeGeneratorWorkspaceFiles } = require('./workspace-templates');

function loadMedolWorkspace(cwd, options = {}) {
    const configPaths = resolveMedolConfigPaths(cwd, options);
    const config = configPaths
        .map((file) => readConfig(file))
        .reduce((merged, next) => deepMerge(merged, next), {});
    return {
        root: cwd,
        medolDirectory: path.join(cwd, '.medol'),
        configPath: configPaths[0],
        configPaths,
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
    return resolveMedolConfigPaths(cwd, options)[0];
}

function resolveMedolConfigPaths(cwd, options = {}) {
    const explicit = options.medolConfig
        ?? options.medolConfigPath
        ?? options.config
        ?? process.env.MEDOL_CONFIG_PATH;
    if (explicit) {
        const file = absolutePath(cwd, explicit);
        return fs.existsSync(file) ? [file] : [];
    }
    const base = [
        '.medol/medol.yml',
        '.medol/medol.yaml',
        'medol.yml',
        'medol.yaml'
    ].map((candidate) => absolutePath(cwd, candidate)).find((candidate) => fs.existsSync(candidate));
    const local = [
        '.medol/medol.local.yml',
        '.medol/medol.local.yaml',
        'medol.local.yml',
        'medol.local.yaml'
    ].map((candidate) => absolutePath(cwd, candidate)).find((candidate) => fs.existsSync(candidate));
    return [base, local].filter(Boolean);
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

function deepMerge(base, override) {
    if (!isPlainObject(base) || !isPlainObject(override)) return override;
    const merged = { ...base };
    Object.entries(override).forEach(([key, value]) => {
        merged[key] = key in merged ? deepMerge(merged[key], value) : value;
    });
    return merged;
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
