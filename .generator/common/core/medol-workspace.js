/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const fs = require('fs');
const path = require('path');

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
    const config = workspace?.config ?? {};
    if (config.workspaceFiles?.enabled === false) return;

    const title = config.title ?? config.name ?? 'Medol Generated System';
    writeOnce(generator, 'README.md', renderReadme(title), config.workspaceFiles?.overwrite);
    writeOnce(generator, 'AGENTS.md', renderAgents(), config.workspaceFiles?.overwrite);
    writeOnce(generator, '.gitignore', renderGitignore(), config.workspaceFiles?.overwrite);
}

function writeOnce(generator, file, content, overwrite = false) {
    const destination = generator.destinationPath(file);
    if (!overwrite && fs.existsSync(destination)) return;
    generator.fs.write(destination, content);
}

function renderReadme(title) {
    return [
        `# ${title}`,
        '',
        'This repository is a Medol generated system workspace.',
        '',
        '## Layout',
        '',
        '- `.medol/` stores the exported `codegen-model.json` and `medol.yml` generator configuration.',
        '- Generated artifacts are written to the directories configured in `.medol/medol.yml`.',
        '- Business-specific manual backend code should live in generated extension directories such as `domain/` and `infrastructure/`, not generated `context/` code.',
        '',
        '## Generation',
        '',
        'Run generators from this repository root so `.medol/medol.yml` can route each generator to its configured output directory.',
        ''
    ].join('\n');
}

function renderAgents() {
    return [
        '# AGENTS.md',
        '',
        '- Treat `.medol/codegen-model.json` and `.medol/medol.yml` as system-level generation inputs.',
        '- Do not hand-edit generated backend `context/` code unless explicitly requested for an emergency local fix.',
        '- Put hand-written backend adapters under `infrastructure/` and hand-written decision overrides under `domain/`.',
        '- If a framework-level generated behavior is wrong, update `es-code-generator` templates instead of patching generated outputs.',
        '- Do not put concrete business-system behavior into the generator; express business behavior in the Medol model or generated project extension points.',
        ''
    ].join('\n');
}

function renderGitignore() {
    return [
        '.env',
        '**/.env',
        '**/target/',
        '**/build/',
        '**/dist/',
        '**/node_modules/',
        '**/.venv/',
        'volumes/',
        'operations/**/.work/',
        'deployment-compose-files/',
        ''
    ].join('\n');
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
