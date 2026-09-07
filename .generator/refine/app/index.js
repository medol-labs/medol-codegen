/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const YeomanGenerator = require('yeoman-generator');
const Generator = YeomanGenerator.default ?? YeomanGenerator;
var path = require('path');
const fs = require('fs');
const {loadGeneratorModel} = require("../../common/core/config-loader");
const {
    buildFrontendModel,
    buildDomainModel,
    buildCommandChoices,
    normalizeSelectedCommands
} = require('./model-builder');

let config = {};
let codegenModel = {};
const GENERATED_MARKER = '// Generated from config.json by the refine generator.';

function toDisplayName(value) {
    const normalized = `${value ?? ''}`
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim()
        .replace(/\s+/g, ' ');

    if (!normalized) {
        return 'Medol Domain';
    }

    return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toKebab(value) {
    return `${value ?? ''}`
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'medol-console';
}

module.exports = class extends Generator {

    constructor(args, opts) {
        super(args, opts);
        this.opts = { ...(opts ?? {}), skipInstall: true };
        this.options.skipInstall = true;
        if (this.env?.options) {
            this.env.options.skipInstall = true;
        }
        this.argument('appname', { type: String, required: false });

        const loaded = loadGeneratorModel(this.env.cwd);
        config = loaded.config;
        codegenModel = loaded.codegenModel;
    }

    async prompting() {
        const prompts = [];
        const commandChoices = buildCommandChoices(codegenModel);

        if (!this.opts.generatorType) {
            prompts.push({
                type: 'list',
                name: 'generatorType',
                message: 'What frontend code should be generated?',
                choices: ['Skeleton', 'all', 'resources', 'router', 'pages'],
                default: 'Skeleton'
            });
        }

        if (!this.opts.commands && !this.opts.allCommands) {
            prompts.push({
                type: 'checkbox',
                name: 'commands',
                loop: false,
                message: 'Choose Commands to generate?',
                choices: commandChoices,
                default: commandChoices.map((choice) => choice.value),
                when: (answers) => {
                    const generatorType = answers.generatorType ?? this.opts.generatorType ?? 'all';
                    return generatorType !== 'Skeleton' && commandChoices.length > 0;
                }
            });
        }

        this.answers = {
            generatorType: this.opts.generatorType ?? 'all',
            force: this.opts.force ?? true,
            commands: this.opts.commands,
            allCommands: this.opts.allCommands,
            ...(await this.prompt(prompts))
        };
    }

    writing() {
        if (!this.answers.force) {
            this.log('Skipped refine generation.');
            return;
        }

        if (this.answers.generatorType === 'Skeleton') {
            this._writeSkeleton();
            const model = buildFrontendModel(codegenModel);
            this._writeDomainModel(buildDomainModel(codegenModel));
            this._writeI18n(model.i18n);
            return;
        }

        const selectedCommandKeys = this.answers.allCommands
            ? undefined
            : normalizeSelectedCommands(this.answers.commands);
        const model = buildFrontendModel(codegenModel, selectedCommandKeys);
        this._writeFrameworkComponents();
        this._writeDomainModel(buildDomainModel(codegenModel));
        this._writeI18n(model.i18n);

        if (this.answers.generatorType === 'all' || this.answers.generatorType === 'resources') {
            this._writeResources(model);
        }

        if (this.answers.generatorType === 'all' || this.answers.generatorType === 'router') {
            this._writeRouter(model);
        }

        if (this.answers.generatorType === 'all' || this.answers.generatorType === 'pages') {
            this._cleanupGeneratedPages(model.resources);
            model.resources.forEach((resource) => this._writePages(resource));
        }
    }

    _writeResources(model) {
        this._deleteGeneratedFile(this.destinationPath('./src/contexts/resources.tsx'));
        this.fs.copyTpl(
            this.templatePath('src/providers/resources.tsx.tpl'),
            this.destinationPath('./src/contexts/resources.tsx'),
            model
        );
    }

    _writeRouter(model) {
        this._deleteGeneratedFile(this.destinationPath('./src/contexts/routes.tsx'));
        this.fs.copyTpl(
            this.templatePath('src/providers/app-router.tsx.tpl'),
            this.destinationPath('./src/contexts/routes.tsx'),
            model
        );
    }

    _writePages(resource) {
        const basePath = `./src/contexts/pages/${resource.route}`;

        this.fs.copyTpl(
            this.templatePath('src/pages/index.ts.tpl'),
            this.destinationPath(`${basePath}/index.ts`),
            { resource }
        );
        if (resource.canList) {
            this.fs.copyTpl(
                this.templatePath('src/pages/list.tsx.tpl'),
                this.destinationPath(`${basePath}/list.tsx`),
                { resource }
            );
        }
        this.fs.copyTpl(
            this.templatePath('src/pages/show.tsx.tpl'),
            this.destinationPath(`${basePath}/show.tsx`),
            { resource }
        );

        if (resource.createCommand) {
            this.fs.copyTpl(
                this.templatePath('src/pages/command-form.tsx.tpl'),
                this.destinationPath(`${basePath}/${resource.createCommand.file}.tsx`),
                { resource, command: resource.createCommand }
            );
        }

        if (resource.editCommand) {
            this.fs.copyTpl(
                this.templatePath('src/pages/command-form.tsx.tpl'),
                this.destinationPath(`${basePath}/edit.tsx`),
                { resource, command: resource.editCommand }
            );
        }

        if (resource.deleteCommand) {
            this.fs.copyTpl(
                this.templatePath('src/pages/command-form.tsx.tpl'),
                this.destinationPath(`${basePath}/${resource.deleteCommand.file}.tsx`),
                { resource, command: resource.deleteCommand }
            );
        }

        resource.itemCommands.forEach((command) => {
            this.fs.copyTpl(
                this.templatePath('src/pages/command-form.tsx.tpl'),
                this.destinationPath(`${basePath}/${command.file}.tsx`),
                { resource, command }
            );
        });
    }

    _cleanupGeneratedPages(resources) {
        const pagesRoot = this.destinationPath('./src/contexts/pages');
        if (!fs.existsSync(pagesRoot)) {
            return;
        }

        const expectedFilesByRoute = new Map(resources.map((resource) => [
            resource.route,
            this._expectedPageFiles(resource)
        ]));

        for (const entry of fs.readdirSync(pagesRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) {
                continue;
            }

            const route = entry.name;
            const routePath = path.join(pagesRoot, route);
            const expectedFiles = expectedFilesByRoute.get(route);

            if (!expectedFiles) {
                this._deleteGeneratedFiles(routePath);
                this._deleteEmptyDirectory(routePath);
                continue;
            }

            for (const file of fs.readdirSync(routePath)) {
                if (!file.endsWith('.ts') && !file.endsWith('.tsx')) {
                    continue;
                }
                if (!expectedFiles.has(file) && this._isGeneratedFile(path.join(routePath, file))) {
                    fs.rmSync(path.join(routePath, file), { force: true });
                }
            }
        }
    }

    _expectedPageFiles(resource) {
        const files = new Set(['index.ts', 'show.tsx']);
        if (resource.canList) {
            files.add('list.tsx');
        }
        if (resource.createCommand) {
            files.add(`${resource.createCommand.file}.tsx`);
        }
        if (resource.editCommand) {
            files.add('edit.tsx');
        }
        if (resource.deleteCommand) {
            files.add(`${resource.deleteCommand.file}.tsx`);
        }
        resource.itemCommands.forEach((command) => files.add(`${command.file}.tsx`));
        return files;
    }

    _deleteGeneratedFiles(directory) {
        for (const file of fs.readdirSync(directory)) {
            const filePath = path.join(directory, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                this._deleteGeneratedFiles(filePath);
                this._deleteEmptyDirectory(filePath);
            } else if ((file.endsWith('.ts') || file.endsWith('.tsx')) && this._isGeneratedFile(filePath)) {
                fs.rmSync(filePath, { force: true });
            }
        }
    }

    _deleteEmptyDirectory(directory) {
        if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
            fs.rmdirSync(directory);
        }
    }

    _isGeneratedFile(filePath) {
        try {
            return fs.readFileSync(filePath, 'utf8').startsWith(GENERATED_MARKER);
        } catch {
            return false;
        }
    }

    _deleteGeneratedFile(filePath) {
        if (fs.existsSync(filePath) && this._isGeneratedFile(filePath)) {
            fs.rmSync(filePath, { force: true });
        }
    }

    _writeDomainModel(model) {
        this.fs.copyTpl(
            this.templatePath('src/domain/value-types.ts.tpl'),
            this.destinationPath('./src/contexts/domain/value-types.ts'),
            model
        );
        this.fs.copyTpl(
            this.templatePath('src/domain/schemas.ts.tpl'),
            this.destinationPath('./src/contexts/domain/schemas.ts'),
            model
        );
    }

    _writeI18n(model) {
        this.fs.copyTpl(
            this.templatePath('src/i18n/messages.ts.tpl'),
            this.destinationPath('./src/contexts/i18n/messages.ts'),
            model
        );
    }

    _writeFrameworkComponents() {
        this.fs.copy(
            this.templatePath('root/src/components/refine-ui/fields/copyable-text.tsx'),
            this.destinationPath('./src/components/refine-ui/fields/copyable-text.tsx')
        );
    }

    _writeSkeleton() {
        const appName = codegenModel?.domain ?? 'frontend-foundation';
        const model = buildFrontendModel(codegenModel);
        const skeletonModel = {
            appName,
            appTitle: toDisplayName(appName),
            imageName: `${toKebab(appName)}-console`,
            imageTarName: `${toKebab(appName)}-console-images.tar`,
            backendModules: model.backendModules,
            authBackendModule: model.authBackendModule
        };

        this.fs.copyTpl(
            this.templatePath('root'),
            this.destinationPath('.'),
            skeletonModel
        );
        ['.dockerignore', '.env-example', '.gitignore', '.npmrc'].forEach((file) => {
            this.fs.copyTpl(
                this.templatePath(`root/${file}`),
                this.destinationPath(file),
                skeletonModel
            );
        });
        this._writeAgentSkills();
    }

    _writeAgentSkills() {
        const agentTemplates = path.resolve(__dirname, '../../common/agent-templates');
        this.fs.copy(agentTemplates, this.destinationPath('.agent'));
    }
};
