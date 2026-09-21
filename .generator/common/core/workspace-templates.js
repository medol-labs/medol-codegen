/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const fs = require('fs');
const path = require('path');

const TEMPLATE_ROOT = path.join(__dirname, '..', 'templates', 'workspace');

const INITIAL_WORKSPACE_FILES = [
    ['.medol/medol.yml', 'medol.yml.tpl'],
    ['.medol/medol.local.example.yml', 'medol.local.example.yml.tpl'],
    ['README.md', 'README.md.tpl'],
    ['AGENTS.md', 'AGENTS.md.tpl'],
    ['.gitignore', 'gitignore.tpl']
];

const GENERATOR_WORKSPACE_FILES = [
    ['.medol/medol.local.example.yml', 'medol.local.example.yml.tpl'],
    ['README.md', 'README.md.tpl'],
    ['AGENTS.md', 'AGENTS.md.tpl'],
    ['.gitignore', 'gitignore.tpl']
];

function writeInitialWorkspaceFiles(root, options = {}) {
    writeTemplates({
        files: INITIAL_WORKSPACE_FILES,
        overwrite: options.overwrite,
        variables: readmeVariables(undefined, { title: options.title ?? 'Medol Generated System' }),
        writeFile: (file, content) => {
            const destination = path.join(root, file);
            if (!options.overwrite && fs.existsSync(destination)) {
                console.error(`Kept existing ${destination}`);
                return;
            }
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.writeFileSync(destination, content);
            console.error(`Wrote ${destination}`);
        }
    });
}

function writeGeneratorWorkspaceFiles(generator, workspace) {
    const config = workspace?.config ?? {};
    if (config.workspaceFiles?.enabled === false) return;

    writeTemplates({
        files: GENERATOR_WORKSPACE_FILES,
        overwrite: config.workspaceFiles?.overwrite,
        variables: readmeVariables(workspace),
        writeFile: (file, content, overwrite = false) => {
            const destination = generator.destinationPath(file);
            if (!overwrite && fs.existsSync(destination)) return;
            generator.fs.write(destination, content);
        }
    });
}

function readmeVariables(workspace, initial = {}) {
    const config = workspace?.config ?? {};
    const model = readCodegenModel(workspace?.codegenModelPath);
    const domainTitle = modelTitle(model);
    const configuredTitle = config.title ?? config.name ?? initial.title;
    const title = meaningfulTitle(configuredTitle) ?? workspaceTitle(workspace) ?? domainTitle ?? 'Medol Generated System';
    const frontendApps = array(model?.frontendApplications);
    const deployments = array(model?.deployments);
    const operationsOutput = generatorOutput(config, 'operations', '.');

    return {
        title,
        summary: readmeSummary(title, model),
        modelDomainList: modelDomainList(model),
        deploymentList: deploymentList(deployments),
        frontendList: frontendList(frontendApps),
        generatorCommandList: generatorCommandList(config, frontendApps),
        backendOutput: generatorOutput(config, 'axon5', '<backend-output>'),
        frontendOutput: generatorOutput(config, 'refine', '<frontend-output>'),
        operationsOutput: operationsOutput === '.' ? 'operations' : operationsOutput,
        registryPath: operationsOutput === '.'
            ? 'operations/<environment>/k3s/cluster/registries.yaml'
            : `${operationsOutput}/<environment>/k3s/cluster/registries.yaml`
    };
}

function readCodegenModel(file) {
    if (!file || !fs.existsSync(file)) return undefined;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return undefined;
    }
}

function meaningfulTitle(value) {
    if (!value || value === 'Medol Generated System') return undefined;
    return value;
}

function workspaceTitle(workspace) {
    if (!workspace?.root) return undefined;
    return titleize(path.basename(workspace.root));
}

function modelTitle(model) {
    if (!model) return undefined;
    const domain = array(model.domains).find((item) => item.name === model.domain) ?? array(model.domains)[0];
    return domain?.title ?? titleize(model.domain);
}

function readmeSummary(title, model) {
    const domain = modelTitle(model) ?? 'the modeled business domain';
    return `${title} is a MEDOL-modeled business system workspace for ${domain}. The MEDOL source model is transformed into a CodegenModel and materialized by medol-codegen into backend, frontend, operations, and optional runtime artifacts.`;
}

function modelDomainList(model) {
    const domains = array(model?.domains);
    if (domains.length === 0) {
        return '- The business domain should be read from `.medol/source.medol`.';
    }
    return domains.map((domain) => {
        const contexts = array(domain.contexts)
            .map((context) => context.title ?? titleize(context.name))
            .filter(Boolean);
        const suffix = contexts.length > 0 ? `: ${contexts.join(', ')}` : '';
        return `- ${domain.title ?? titleize(domain.name)}${suffix}.`;
    }).join('\n');
}

function deploymentList(deployments) {
    if (deployments.length === 0) {
        return '- Backend deployments are generated from the bounded contexts in the model.';
    }
    return deployments.map((deployment) => {
        const contexts = array(deployment.contexts)
            .map((context) => context.title ?? titleize(context.name))
            .filter(Boolean);
        const suffix = contexts.length > 0 ? `: ${contexts.join(', ')}` : '';
        return `- ${deployment.title ?? titleize(deployment.name)}${suffix}.`;
    }).join('\n');
}

function frontendList(frontendApps) {
    if (frontendApps.length === 0) {
        return '- Frontend applications are generated when they are configured in the model.';
    }
    return frontendApps.map((app) => {
        const contexts = array(app.contexts)
            .map((context) => context.title ?? titleize(context.name))
            .filter(Boolean);
        const suffix = contexts.length > 0 ? `: ${contexts.join(', ')}` : '';
        return `- ${app.title ?? titleize(app.name)}${suffix}.`;
    }).join('\n');
}

function generatorCommandList(config, frontendApps) {
    const commands = [
        'gen /opt/codegen/.generator/app/ --generator axon5 --generator-type all'
    ];
    if (frontendApps.length > 0) {
        frontendApps.forEach((app) => {
            commands.push(`gen /opt/codegen/.generator/app/ --generator refine --generator-type all --frontend-app ${app.name}`);
        });
    } else {
        commands.push('gen /opt/codegen/.generator/app/ --generator refine --generator-type all');
    }
    commands.push('gen /opt/codegen/.generator/app/ --generator operations --generator-type all --environment dev');
    if (generatorOutput(config, 'simulation')) {
        commands.push('gen /opt/codegen/.generator/app/ --generator simulation --generator-type all');
    }
    return commands.join('\n');
}

function generatorOutput(config, generatorName, fallback) {
    const generatorConfig = config.generators?.[generatorName]
        ?? config.generator?.[generatorName]
        ?? config[generatorName]
        ?? {};
    return generatorConfig.output
        ?? generatorConfig.outputRoot
        ?? generatorConfig.directory
        ?? config.outputs?.[generatorName]
        ?? fallback;
}

function array(value) {
    return Array.isArray(value) ? value : [];
}

function titleize(value) {
    if (!value) return undefined;
    return String(value)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map((word) => /^[A-Z0-9]+$/.test(word)
            ? word
            : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
        .join(' ');
}

function writeTemplates({ files, overwrite = false, variables = {}, writeFile }) {
    files.forEach(([destination, templateName]) => {
        writeFile(destination, renderTemplate(templateName, variables), overwrite);
    });
}

function renderTemplate(templateName, variables = {}) {
    const template = fs.readFileSync(path.join(TEMPLATE_ROOT, templateName), 'utf8');
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
        const value = variables[key];
        return value === undefined || value === null ? '' : String(value);
    });
}

module.exports = {
    writeGeneratorWorkspaceFiles,
    writeInitialWorkspaceFiles
};
