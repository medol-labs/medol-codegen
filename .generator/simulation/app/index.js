/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const YeomanGenerator = require('yeoman-generator');
const Generator = YeomanGenerator.default ?? YeomanGenerator;
const { loadGeneratorModel } = require('../../common/core/config-loader');
const { generatorOutputRoot, loadMedolWorkspace } = require('../../common/core/medol-workspace');
const { buildSimulationModel } = require('./simulation-model-builder');
const { loadSimulationConfig } = require('./simulation-config');
const { generateSimulationFiles, targets } = require('./simulation-generator');

module.exports = class extends Generator {
    constructor(args, opts) {
        super(args, opts);
        this.opts = { ...(opts ?? {}), skipInstall: true };
        this.options.skipInstall = true;
        if (this.env?.options) {
            this.env.options.skipInstall = true;
        }
        this.argument('appname', { type: String, required: false });

        this.workspace = loadMedolWorkspace(this.env.cwd, this.opts);
        const outputRoot = this.opts.outputRoot ?? this.opts.output ?? generatorOutputRoot(this.workspace, 'simulation', '.');
        if (outputRoot && outputRoot !== '.') {
            this.destinationRoot(this.destinationPath(outputRoot));
        }
        const loaded = loadGeneratorModel(this.env.cwd, this.opts);
        this.codegenModel = loaded.codegenModel;
        this.simulationConfig = loadSimulationConfig(this.env.cwd);
    }

    async prompting() {
        const prompts = [];
        if (!this.opts.generatorType && !this.opts.target) {
            prompts.push({
                type: 'list',
                name: 'target',
                message: 'Which simulation target should be generated?',
                choices: targets,
                default: 'all'
            });
        }

        this.answers = {
            target: this.opts.target ?? this.opts.generatorType ?? 'all',
            force: this.opts.force ?? true,
            ...(await this.prompt(prompts))
        };
    }

    writing() {
        if (!this.answers.force) {
            this.log('Skipped simulation generation.');
            return;
        }
        const simulationModel = buildSimulationModel(this.codegenModel, this.simulationConfig);
        const files = generateSimulationFiles(simulationModel, {
            target: this.answers.target,
            root: this.opts.outputRoot ?? this.opts.root ?? '.'
        });

        Object.entries(files).forEach(([file, content]) => {
            this.fs.write(this.destinationPath(file), content);
        });
    }
};
