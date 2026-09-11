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
        variables: { title: options.title ?? 'Medol Generated System' },
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
        variables: { title: config.title ?? config.name ?? 'Medol Generated System' },
        writeFile: (file, content, overwrite = false) => {
            const destination = generator.destinationPath(file);
            if (!overwrite && fs.existsSync(destination)) return;
            generator.fs.write(destination, content);
        }
    });
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
