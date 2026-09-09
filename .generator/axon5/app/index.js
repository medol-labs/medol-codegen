/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const YeomanGenerator = require('yeoman-generator');
const Generator = YeomanGenerator.default ?? YeomanGenerator;
const {loadCodegenModel} = require('../../common/core/codegen-model-loader');
const {generatorOutputRoot, loadMedolWorkspace} = require('../../common/core/medol-workspace');
const {configureValueTypes} = require('../../common/util/generator');
const {applicationWriterMethods} = require('./application-writer');
const {domainWriterMethods} = require('./domain-writer');
const {sliceWriterMethods} = require('./slice-writer');

function listOption(value) {
    if (Array.isArray(value)) {
        return value.flatMap(listOption);
    }
    if (value === undefined || value === null || value === true || value === false) {
        return [];
    }
    return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function unique(values) {
    return [...new Set(values)];
}

function sliceLabel(slice) {
    return `${slice.title} (${slice.context ?? 'default'})`;
}

function sliceMatchesText(slice, filterText) {
    const text = String(filterText ?? '').trim().toLowerCase();
    if (!text) return true;
    return [
        slice.title,
        slice.name,
        slice.context,
        ...(slice.concepts ?? []),
        ...(slice.commands ?? []).map((command) => command.title ?? command.name),
        ...(slice.events ?? []).map((event) => event.title ?? event.name),
        ...(slice.readmodels ?? []).map((readmodel) => readmodel.title ?? readmodel.name)
    ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(text));
}

function normalizeSelectedSlices(model, options = {}) {
    const explicit = unique([
        ...listOption(options.sliceNames),
        ...listOption(options.slices),
        ...listOption(options.slice)
    ]);
    const contexts = unique([
        ...listOption(options.contexts),
        ...listOption(options.context)
    ]);
    const filters = unique([
        ...listOption(options.sliceFilter),
        ...listOption(options.filter)
    ]);
    let candidates = model.slices ?? [];
    if (contexts.length > 0) {
        const selectedContexts = new Set(contexts.map((context) => context.toLowerCase()));
        candidates = candidates.filter((slice) => selectedContexts.has(String(slice.context ?? '').toLowerCase()));
    }
    if (filters.length > 0) {
        candidates = candidates.filter((slice) => filters.some((filterText) => sliceMatchesText(slice, filterText)));
    }
    if (explicit.length > 0) {
        const names = new Set(explicit.map((name) => name.toLowerCase()));
        candidates = candidates.filter((slice) =>
            names.has(String(slice.title ?? '').toLowerCase())
            || names.has(String(slice.name ?? '').toLowerCase())
            || names.has(String(slice.id ?? '').toLowerCase())
        );
    }
    if ((contexts.length > 0 || filters.length > 0 || explicit.length > 0) && candidates.length === 0) {
        throw new Error(`No slices matched the requested selection. contexts=${contexts.join(',') || '-'} filters=${filters.join(',') || '-'} slices=${explicit.join(',') || '-'}`);
    }
    return candidates.map((slice) => slice.title);
}

class Axon5Generator extends Generator {
    constructor(args, opts) {
        super(args, opts);
        this.opts = opts ?? {};
        this.workspace = loadMedolWorkspace(this.env.cwd, this.opts);
        const outputRoot = this.opts.outputRoot ?? this.opts.output ?? generatorOutputRoot(this.workspace, 'axon5', '.');
        if (outputRoot && outputRoot !== '.') {
            this.destinationRoot(this.destinationPath(outputRoot));
        }
        this.model = loadCodegenModel(this.env.cwd, this.opts);
        this.fullModel = this.model;
        this.modulePrefix = '';
        this.currentDeployment = null;
        this.currentDeploymentIndex = 0;
        configureValueTypes(this.model.valueTypes, this.model.rootPackage, this.model.concepts);
    }

    async prompting() {
        const answers = {};
        if (this.opts.generatorType) {
            answers.generatorType = this.opts.generatorType;
        } else {
            Object.assign(answers, await this.prompt([{
                type: 'list',
                name: 'generatorType',
                message: 'What should be generated?',
                choices: ['Skeleton', 'slices', 'all']
            }]));
        }

        const type = String(answers.generatorType ?? '').toLowerCase();
        const hasSliceSelectionOptions = listOption(this.opts.sliceNames).length > 0
            || listOption(this.opts.slices).length > 0
            || listOption(this.opts.slice).length > 0
            || listOption(this.opts.sliceFilter).length > 0
            || listOption(this.opts.filter).length > 0
            || listOption(this.opts.contexts).length > 0
            || listOption(this.opts.context).length > 0;
        if (type === 'slices') {
            if (this.opts.allSlices) {
                answers.sliceNames = this.model.slices.map((slice) => slice.title);
            } else if (hasSliceSelectionOptions) {
                answers.sliceNames = normalizeSelectedSlices(this.model, this.opts);
            } else {
                const contexts = unique((this.model.slices ?? [])
                    .map((slice) => slice.context)
                    .filter(Boolean))
                    .sort();
                const filterAnswers = await this.prompt([
                    {
                        type: 'checkbox',
                        name: 'sliceContexts',
                        message: 'Filter slices by context (leave empty for all contexts)',
                        choices: contexts
                    },
                    {
                        type: 'input',
                        name: 'sliceFilter',
                        message: 'Filter slices by keyword (name, command, event, readmodel; leave empty for all)'
                    }
                ]);
                const selectedContexts = new Set((filterAnswers.sliceContexts ?? []).map((context) => String(context).toLowerCase()));
                const choices = (this.model.slices ?? [])
                    .filter((slice) => selectedContexts.size === 0 || selectedContexts.has(String(slice.context ?? '').toLowerCase()))
                    .filter((slice) => sliceMatchesText(slice, filterAnswers.sliceFilter))
                    .map((slice) => ({
                        name: sliceLabel(slice),
                        value: slice.title
                    }));
                if (choices.length === 0) {
                    throw new Error('No slices matched the selected filters.');
                }
                Object.assign(answers, await this.prompt([{
                    type: 'checkbox',
                    name: 'sliceNames',
                    message: `Choose slices to generate (${choices.length} matched)`,
                    choices,
                    validate: (value) => value.length > 0 || 'Choose at least one slice.'
                }]));
            }
        }
        this.answers = answers;
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
                this._writeConceptStates();
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
