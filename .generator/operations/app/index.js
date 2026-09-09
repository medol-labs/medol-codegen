/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const YeomanGenerator = require('yeoman-generator');
const Generator = YeomanGenerator.default ?? YeomanGenerator;
const { loadGeneratorModel } = require('../../common/core/config-loader');
const { buildOperationsModel } = require('./operations-model-builder');
const { loadOperationsConfig } = require('./operations-config');
const { generateOperationsFiles, targets } = require('./operations-generator');

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
        this.codegenModel = loaded.codegenModel;
        this.operationsConfig = loadOperationsConfig(this.env.cwd);
    }

    async prompting() {
        const prompts = [];
        if (!this.opts.generatorType && !this.opts.target) {
            prompts.push({
                type: 'list',
                name: 'target',
                message: 'Which operations target should be generated?',
                choices: targets,
                default: 'all'
            });
        }
        if (!this.opts.environment) {
            prompts.push({
                type: 'list',
                name: 'environment',
                message: 'Which operations environment?',
                choices: ['dev', 'test', 'staging', 'prod'],
                default: 'dev'
            });
        }

        this.answers = {
            target: this.opts.target ?? this.opts.generatorType ?? 'all',
            environment: this.opts.environment ?? 'dev',
            force: this.opts.force ?? true,
            ...(await this.prompt(prompts))
        };
    }

    writing() {
        if (!this.answers.force) {
            this.log('Skipped operations generation.');
            return;
        }
        const target = targets.includes(this.answers.target)
            ? this.answers.target
            : 'all';
        const operationsModel = buildOperationsModel(this.codegenModel, this.operationsConfig);
        const files = generateOperationsFiles(operationsModel, {
            target,
            environment: this.answers.environment
        });

        Object.entries(files).forEach(([file, content]) => {
            this.fs.write(this.destinationPath(file), content);
        });
    }
};
