/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const YeomanGenerator = require('yeoman-generator');
const Generator = YeomanGenerator.default ?? YeomanGenerator;
var path = require('path');
const fs = require('fs');
const {loadGeneratorModel} = require("../../common/core/config-loader");
const {generatorOutputRoot, loadMedolWorkspace} = require("../../common/core/medol-workspace");
const {
    buildFrontendModel,
    buildDomainModel,
    buildFrontendApplicationChoices,
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

function normalizeFrontendApplicationName(value) {
    return `${value ?? ''}`.replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
}

function frontendApplicationFor(model, frontendApp) {
    if (!frontendApp || `${frontendApp}` === '__all__') {
        return undefined;
    }
    const normalized = normalizeFrontendApplicationName(frontendApp);
    return (model.frontendApplications ?? []).find((application) => {
        return [application.name, application.title]
            .filter(Boolean)
            .some((value) => normalizeFrontendApplicationName(value) === normalized);
    });
}

function defaultFrontendOutputRoot(model, frontendApp) {
    const application = frontendApplicationFor(model, frontendApp);
    if (!application) {
        return undefined;
    }
    return toKebab(application.name ?? application.title);
}

function frontendApplicationsForSelection(model, frontendApp) {
    const applications = (model.frontendApplications ?? []).filter((application) => application?.name);
    if (`${frontendApp ?? ''}` === '__all__' && applications.length > 0) {
        return applications.map((application) => application.name);
    }
    const application = frontendApplicationFor(model, frontendApp);
    if (application?.name) {
        return [application.name];
    }
    return [undefined];
}

const RefineGenerator = class extends Generator {

    constructor(args, opts) {
        super(args, opts);
        this.opts = { ...(opts ?? {}), skipInstall: true };
        this.options.skipInstall = true;
        if (this.env?.options) {
            this.env.options.skipInstall = true;
        }
        this.argument('appname', { type: String, required: false });

        this.workspace = loadMedolWorkspace(this.env.cwd, this.opts);
        const loaded = loadGeneratorModel(this.env.cwd, this.opts);
        config = loaded.config;
        codegenModel = loaded.codegenModel;

        const outputRoot = this._resolveOutputRoot();
        if (outputRoot && outputRoot !== '.') {
            this.destinationRoot(this.destinationPath(outputRoot));
        }
    }

    async prompting() {
        const prompts = [];
        const frontendApplicationChoices = buildFrontendApplicationChoices(codegenModel);
        const configuredFrontendApp = this.opts.frontendApp
            ?? this.opts.frontendApplication
            ?? process.env.CODEGEN_FRONTEND_APP;
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

        if (!configuredFrontendApp && frontendApplicationChoices.length > 0) {
            prompts.push({
                type: 'list',
                name: 'frontendApp',
                message: 'Which frontend application should be generated?',
                choices: [
                    { name: 'All frontend applications', value: '__all__' },
                    ...frontendApplicationChoices
                ],
                default: '__all__',
                when: () => frontendApplicationChoices.length > 1
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
            frontendApp: configuredFrontendApp ?? (frontendApplicationChoices.length === 1 ? frontendApplicationChoices[0].value : undefined),
            ...(await this.prompt(prompts))
        };

        this._applyFrontendDestinationRoot(this.answers.frontendApp);
    }

    writing() {
        if (!this.answers.force) {
            this.log('Skipped refine generation.');
            return;
        }

        const frontendApps = frontendApplicationsForSelection(codegenModel, this.answers.frontendApp);
        this._assertCanWriteFrontendApplications(frontendApps);
        frontendApps.forEach((frontendApp) => {
            this._withFrontendDestinationRoot(frontendApp, () => this._writeFrontendApplication(frontendApp));
        });
    }

    _writeFrontendApplication(frontendApp) {
        if (this.answers.generatorType === 'Skeleton') {
            this._writeSkeleton(frontendApp);
            const model = buildFrontendModel(codegenModel, undefined, { frontendApp });
            this._writeDomainModel(buildDomainModel(model.frontendSource));
            this._writeI18n(model.i18n);
            return;
        }

        const selectedCommandKeys = this.answers.allCommands
            ? undefined
            : normalizeSelectedCommands(this.answers.commands);
        const model = buildFrontendModel(codegenModel, selectedCommandKeys, { frontendApp });
        this._writeFrameworkComponents();
        this._writeDomainModel(buildDomainModel(model.frontendSource));
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
        const basePath = `./src/contexts/${resource.pagePath}`;

        this.fs.copyTpl(
            this.templatePath('src/pages/index.ts.tpl'),
            this.destinationPath(`${basePath}/index.ts`),
            { resource }
        );
        if (resource.canList) {
            this.fs.copyTpl(
                this.templatePath('src/pages/list.tsx.tpl'),
                this.destinationPath(`./src/contexts/${resource.listPagePath}/${resource.listFile}.tsx`),
                { resource }
            );
        }
        this.fs.copyTpl(
            this.templatePath('src/pages/show.tsx.tpl'),
            this.destinationPath(`./src/contexts/${resource.showPagePath}/${resource.showFile}.tsx`),
            { resource }
        );

        if (resource.createCommand) {
            this.fs.copyTpl(
                this.templatePath('src/pages/command-form.tsx.tpl'),
                this.destinationPath(`./src/contexts/${resource.createCommand.pagePath}/${resource.createCommand.file}.tsx`),
                { resource, command: resource.createCommand }
            );
        }

        if (resource.editCommand) {
            this.fs.copyTpl(
                this.templatePath('src/pages/command-form.tsx.tpl'),
                this.destinationPath(`./src/contexts/${resource.editCommand.pagePath}/${resource.editCommand.file}.tsx`),
                { resource, command: resource.editCommand }
            );
        }

        if (resource.deleteCommand) {
            this.fs.copyTpl(
                this.templatePath('src/pages/command-form.tsx.tpl'),
                this.destinationPath(`./src/contexts/${resource.deleteCommand.pagePath}/${resource.deleteCommand.file}.tsx`),
                { resource, command: resource.deleteCommand }
            );
        }

        resource.itemCommands.forEach((command) => {
            this.fs.copyTpl(
                this.templatePath('src/pages/command-form.tsx.tpl'),
                this.destinationPath(`./src/contexts/${command.pagePath}/${command.file}.tsx`),
                { resource, command }
            );
        });
    }

    _cleanupGeneratedPages(resources) {
        this._deleteGeneratedFiles(this.destinationPath('./src/contexts/pages'));

        const contextsRoot = this.destinationPath('./src/contexts');
        if (!fs.existsSync(contextsRoot)) {
            return;
        }

        for (const contextEntry of fs.readdirSync(contextsRoot, { withFileTypes: true })) {
            if (!contextEntry.isDirectory()) {
                continue;
            }

            const slicesRoot = path.join(contextsRoot, contextEntry.name, 'slices');
            this._deleteGeneratedFiles(slicesRoot);
            this._deleteEmptyDirectories(slicesRoot);

            const readModelsRoot = path.join(contextsRoot, contextEntry.name, 'read-models');
            this._deleteGeneratedFiles(readModelsRoot);
            this._deleteEmptyDirectories(readModelsRoot);
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
        if (!fs.existsSync(directory)) {
            return;
        }

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

    _deleteEmptyDirectories(directory) {
        if (!fs.existsSync(directory)) {
            return;
        }

        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                this._deleteEmptyDirectories(path.join(directory, entry.name));
            }
        }

        this._deleteEmptyDirectory(directory);
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

    _writeSkeleton(frontendApp) {
        const model = buildFrontendModel(codegenModel, undefined, { frontendApp });
        const appName = model.frontendApplication?.name ?? codegenModel?.domain ?? 'frontend-foundation';
        const appTitle = model.frontendApplication?.title ?? toDisplayName(appName);
        const imageName = toKebab(appName);
        const skeletonModel = {
            appName,
            appTitle,
            imageName,
            imageTarName: `${imageName}-images.tar`,
            backendModules: model.backendModules,
            authBackendModule: model.authBackendModule
        };

        this.fs.copyTpl(
            this.templatePath('root'),
            this.destinationPath('.'),
            skeletonModel
        );
        const appExtensionsPath = this.destinationPath('./src/domain/app-extensions.tsx');
        if (!fs.existsSync(appExtensionsPath)) {
            this.fs.copy(
                this.templatePath('app-extensions.tsx'),
                appExtensionsPath
            );
        }
        ['.dockerignore', '.env-example', '.gitignore', '.npmrc'].forEach((file) => {
            this.fs.copyTpl(
                this.templatePath(`root/${file}`),
                this.destinationPath(file),
                skeletonModel
            );
        });
        this._writeAgentSkills();
    }

    _resolveOutputRoot(frontendApp) {
        const explicit = this.opts.outputRoot ?? this.opts.output;
        if (explicit) return explicit;

        const configuredFrontendApp = frontendApp
            ?? this.opts.frontendApp
            ?? this.opts.frontendApplication
            ?? process.env.CODEGEN_FRONTEND_APP;
        const frontendOutput = this._defaultFrontendOutputRoot(configuredFrontendApp);
        if (frontendOutput) return frontendOutput;

        return generatorOutputRoot(this.workspace, 'refine', '.');
    }

    _applyFrontendDestinationRoot(frontendApp) {
        if (this.opts.outputRoot || this.opts.output) {
            return;
        }
        const outputRoot = this._resolveOutputRoot(frontendApp);
        if (outputRoot && outputRoot !== '.') {
            this.destinationRoot(path.resolve(this.workspace.root, outputRoot));
        }
    }

    _withFrontendDestinationRoot(frontendApp, write) {
        const previousRoot = this.destinationRoot();
        try {
            this._applyFrontendDestinationRoot(frontendApp);
            write();
        } finally {
            this.destinationRoot(previousRoot);
        }
    }

    _assertCanWriteFrontendApplications(frontendApps) {
        if (frontendApps.length > 1 && (this.opts.outputRoot || this.opts.output)) {
            throw new Error('Cannot generate all frontend applications into one explicit output directory. Omit --output or select one --frontend-app.');
        }
    }

    _defaultFrontendOutputRoot(frontendApp) {
        return defaultFrontendOutputRoot(codegenModel, frontendApp);
    }

    _frontendApplication(frontendApp) {
        return frontendApplicationFor(codegenModel, frontendApp);
    }

    _writeAgentSkills() {
        const agentTemplates = path.resolve(__dirname, '../../common/agent-templates');
        this.fs.copy(agentTemplates, this.destinationPath('.agent'));
    }
};

module.exports = RefineGenerator;
module.exports._test = {
    defaultFrontendOutputRoot,
    frontendApplicationsForSelection,
    frontendApplicationFor
};
