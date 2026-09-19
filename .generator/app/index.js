/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const YeomanGenerator = require('yeoman-generator');
const Generator = YeomanGenerator.default ?? YeomanGenerator;
const {
    generatorOutputRoot,
    loadMedolWorkspace,
    writeWorkspaceFiles
} = require('../common/core/medol-workspace');

module.exports = class extends Generator {

    appName = "."

    opts = null

    constructor(args, opts) {
        super(args, opts);
        this.opts = opts
        this.workspace = loadMedolWorkspace(this.env.cwd, opts);
        this.argument('appname', {type: String, required: false});
    }

    // Async Await
    async prompting() {
        if (!this.opts.generator) {
            this.answers = await this.prompt([{
                type: 'list',
                name: 'generator',
                message: 'Which generator?',
                choices: ["axon5", "refine", "operations", "simulation"],
                default: "axon5"
            }]);
        } else {
            this.answers = {"generator": this.opts.generator}
        }
    }


    async generators() {
        const generatorPath = require.resolve(`../${this.answers.generator}/app`);
        const GeneratorClass = require(generatorPath);
        const explicitOutputRoot = this.opts.outputRoot ?? this.opts.output;
        const outputRoot = explicitOutputRoot
            ?? (this.answers.generator === 'refine'
                ? undefined
                : generatorOutputRoot(this.workspace, this.answers.generator, '.'));

        await this.composeWith({
            Generator: GeneratorClass.default ?? GeneratorClass,
            path: generatorPath
        }, {
            answers: this.answers,
            appName: this.answers.appName ?? this.appName,
            outputRoot,
            ...this.opts
        });
    }

    writing() {
        if (this.opts.workspaceFiles === false || this.opts.skipWorkspaceFiles) return;
        writeWorkspaceFiles(this, this.workspace);
    }

};
