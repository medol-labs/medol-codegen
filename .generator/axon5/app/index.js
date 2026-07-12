/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const YeomanGenerator = require('yeoman-generator');
const Generator = YeomanGenerator.default ?? YeomanGenerator;
const {loadCodegenModel} = require('../../common/core/codegen-model-loader');
const {configureValueTypes} = require('../../common/util/generator');
const {applicationWriterMethods} = require('./application-writer');
const {domainWriterMethods} = require('./domain-writer');
const {sliceWriterMethods} = require('./slice-writer');

class Axon5Generator extends Generator {
    constructor(args, opts) {
        super(args, opts);
        this.opts = opts ?? {};
        this.model = loadCodegenModel(this.env.cwd);
        this.modulePrefix = '';
        this.currentDeployment = null;
        this.currentDeploymentIndex = 0;
        this.eventStorageMode = String(this.opts.eventStorageMode ?? this.model.eventStorageMode ?? 'aggregate').toLowerCase();
        configureValueTypes(this.model.valueTypes, this.model.rootPackage, this.model.concepts);
    }

    async prompting() {
        const prompts = [];
        if (!this.opts.generatorType) {
            prompts.push({
                type: 'list',
                name: 'generatorType',
                message: 'What should be generated?',
                choices: ['Skeleton', 'slices', 'all']
            });
        }
        if (!this.opts.allSlices && String(this.opts.generatorType ?? '').toLowerCase() === 'slices') {
            prompts.push({
                type: 'checkbox',
                name: 'sliceNames',
                message: 'Choose slices to generate',
                choices: this.model.slices.map((slice) => slice.title)
            });
        }
        this.answers = {
            generatorType: this.opts.generatorType,
            sliceNames: this.opts.allSlices ? this.model.slices.map((slice) => slice.title) : undefined,
            ...(await this.prompt(prompts))
        };
    }

    writing() {
        const type = String(this.answers.generatorType ?? '').toLowerCase();
        if (type === 'skeleton' || type === 'all') {
            if (this._isMonoMode()) {
                this._writeMonoSkeleton();
            } else {
                this._writeSkeleton();
            }
        }
        if (type === 'slices' || type === 'all') {
            if (this._isMonoMode()) {
                this._writeMonoSlices();
            } else {
                const selected = this.answers.sliceNames ?? this.model.slices.map((slice) => slice.title);
                const selectedSlices = this.model.slices.filter((slice) => selected.includes(slice.title));
                selectedSlices.forEach((slice) => this._writeSlice(slice));
                this._writeConceptEntityStates(selectedSlices);
            }
        }
    }
}

Object.assign(
    Axon5Generator.prototype,
    applicationWriterMethods,
    domainWriterMethods,
    sliceWriterMethods
);

module.exports = Axon5Generator;
