/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

var Generator = require('yeoman-generator').default;
var slugify = require('slugify')
const {loadGeneratorModel} = require("../../common/core/config-loader");
const {configureValueTypes} = require('../../common/util/generator');
const {contextPackage, resolvedBaseType, resolvedConstraints} = require('../../common/util/value-types');


let config = {}
let codegenModel = {}

module.exports = class extends Generator {

    defaultAppName = "app"

    constructor(args, opts) {
        super(args, opts);
        this.opts = opts ?? {};

        this.argument('appname', { type: String, required: false });

        const loaded = loadGeneratorModel(this.env.cwd);
        config = loaded.config;
        codegenModel = loaded.codegenModel;
        configureValueTypes(codegenModel.valueTypes, codegenModel.rootPackage);
    }

    // Async Await
    async prompting() {
        const prompts = []

        if (!config?.codeGen?.application) {
            prompts.push({
                type: 'input',
                name: 'appName',
                message: 'Projectame?',
            })
        }

        if (!config?.codeGen?.rootPackage) {
            prompts.push({
                type: 'input',
                name: 'rootPackageName',
                message: 'Root Package?',
            })
        }

        if (!this.opts.generatorType) {
            prompts.push({
                type: 'list',
                name: 'generatorType',
                message: 'What should be generated?',
                choices: ['Skeleton', 'slices', "aggregates"]
            })
        }

        this.answers = {
            generatorType: this.opts.generatorType,
            allSlices: this.opts.allSlices,
            allAggregates: this.opts.allAggregates,
            ...(await this.prompt(prompts))
        };
    }

    setDefaults() {
        if (!this.answers.appName) {
            this.answers.appName = config?.codeGen?.application ?? this.defaultAppName
        }
        if (!this.answers.rootPackageName) {
            this.answers.rootPackageName = config?.codeGen?.rootPackage
        }
    }

    async writing() {

        if (this.answers.generatorType === 'Skeleton') {
            this._writeSkeleton();
        } else if (this.answers.generatorType === 'slices') {
            this.log('starting commands generation')
            const generatorPath = require.resolve('../slices');
            const GeneratorClass = require(generatorPath);
            await this.composeWith({
                Generator: GeneratorClass.default ?? GeneratorClass,
                path: generatorPath
            }, {
                answers: this.answers,
                appName: this.answers.appName ?? this.appName,
                allSlices: this.opts.allSlices
            });
        } else if (this.answers.generatorType === 'aggregates') {
            this.log('starting aggregates generation')
            const generatorPath = require.resolve('../aggregates');
            const GeneratorClass = require(generatorPath);
            await this.composeWith({
                Generator: GeneratorClass.default ?? GeneratorClass,
                path: generatorPath
            }, {
                answers: this.answers,
                appName: this.answers.appName ?? this.appName,
                allAggregates: this.opts.allAggregates
            });
        }
    }

    _writeSkeleton() {
        this.fs.copyTpl(
            this.templatePath('root'),
            this.destinationPath("."),
            {
                rootPackageName: this.answers.rootPackageName,
                appName: this.answers.appName !== "." ? slugify(this.answers.appName) : "app",
            }
        )
        this.fs.copyTpl(
            this.templatePath('src'),
            this.destinationPath(`./src/main/kotlin/${this.answers.rootPackageName.split(".").join("/")}`),
            {
                rootPackageName: this.answers.rootPackageName
            }
        )
        this.fs.copyTpl(
            this.templatePath('test'),
            this.destinationPath(`./src/test/kotlin/${this.answers.rootPackageName.split(".").join("/")}`),
            {
                rootPackageName: this.answers.rootPackageName
            }
        )
        this.fs.copyTpl(
            this.templatePath('git/gitignore'),
            this.destinationPath(`./.gitignore`),
            {
                rootPackageName: this.answers.rootPackageName
            }
        )
        this.fs.copy(
            this.templatePath('.mvn'),
            this.destinationPath('./.mvn')
        )
        this._writeValueTypes();

    }

    _writeValueTypes() {
        (codegenModel.valueTypes ?? []).forEach((valueType) => {
            const baseType = kotlinPrimitive(resolvedBaseType(valueType));
            const context = contextPackage(valueType.context);
            this.fs.copyTpl(
                this.templatePath('value-types/ValueType.kt.tpl'),
                this.destinationPath(`./src/main/kotlin/${this.answers.rootPackageName.split('.').join('/')}/${context}/domain/types/${valueType.name}.kt`),
                {
                    packageName: `${this.answers.rootPackageName}.${context}.domain.types`,
                    name: valueType.name,
                    baseType,
                    imports: kotlinImports(baseType),
                    validations: renderValidations(valueType, baseType)
                }
            );
        });
    }

    end() {
    }
};

function kotlinPrimitive(type) {
    switch (String(type).toLowerCase()) {
        case 'int':
        case 'integer': return 'Int';
        case 'long': return 'Long';
        case 'double':
        case 'number': return 'Double';
        case 'float': return 'Float';
        case 'decimal':
        case 'bigdecimal': return 'BigDecimal';
        case 'boolean': return 'Boolean';
        case 'date': return 'LocalDate';
        case 'datetime': return 'LocalDateTime';
        case 'uuid': return 'UUID';
        default: return 'String';
    }
}

function kotlinImports(baseType) {
    const imports = {
        BigDecimal: 'import java.math.BigDecimal',
        LocalDate: 'import java.time.LocalDate',
        LocalDateTime: 'import java.time.LocalDateTime',
        UUID: 'import java.util.UUID'
    };
    return imports[baseType] ?? '';
}

function renderValidations(valueType, baseType) {
    return resolvedConstraints(valueType).map((constraint) => {
        const label = `${valueType.name} violates ${constraint.kind} constraint`;
        switch (constraint.kind) {
            case 'format':
                if (constraint.format === 'email') return `require(Regex("^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$").matches(value)) { "${label}" }`;
                return '';
            case 'length':
                return `require(value.length in ${constraint.min}..${constraint.max}) { "${label}" }`;
            case 'range':
                return `require(value >= ${kotlinLiteral(constraint.min, baseType)} && value <= ${kotlinLiteral(constraint.max, baseType)}) { "${label}" }`;
            case 'matches':
                return `require(Regex("${escapeKotlin(constraint.pattern)}").matches(value)) { "${label}" }`;
            case 'oneOf':
                return `require(value in setOf(${(constraint.values ?? []).map((value) => kotlinLiteral(value, baseType)).join(', ')})) { "${label}" }`;
            default:
                return '';
        }
    }).filter(Boolean).map((line) => `        ${line}`).join('\n');
}

function kotlinLiteral(value, baseType) {
    if (baseType === 'String') return `"${escapeKotlin(value)}"`;
    if (baseType === 'Long') return `${value}L`;
    if (baseType === 'Float') return `${value}f`;
    if (baseType === 'BigDecimal') return `BigDecimal("${value}")`;
    return String(value);
}

function escapeKotlin(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
