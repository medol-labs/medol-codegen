/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

var Generator = require('yeoman-generator').default;
var slugify = require('slugify')
const {
    _aggregateTitle,
    _packageName,
    _commandTitle,
    _eventTitle,
    _readmodelTitle,
    _sliceTitle,
    _packageFolderName
} = require("../../common/util/naming")
const {variableAssignments, processSourceMapping} = require("../../common/util/variables");
const {idField, uniqBy} = require("../../common/util/util");
const {configureValueTypes, idType, typeImports, typeMapping} = require("../../common/util/generator");
const {analyzeSpecs} = require("../../common/util/specs");
const {fileExistsByGlob} = require("../../common/util/files");
const {loadGeneratorModel} = require("../../common/core/config-loader");

let config = {}
let codegenModel = {}
const ALL_AGGREGATES = "All Aggregates"

module.exports = class extends Generator {

    constructor(args, opts) {
        super(args, opts);
        this.opts = opts ?? {};
        this.givenAnswers = opts.answers

        this.argument('appname', { type: String, required: false });

        const loaded = loadGeneratorModel(this.env.cwd);
        config = loaded.config;
        codegenModel = loaded.codegenModel;
        configureValueTypes(codegenModel.valueTypes, codegenModel.rootPackage, codegenModel.concepts);
    }

    async prompting() {
        if (this.opts.allAggregates || this.givenAnswers.allAggregates) {
            this.answers = {
                aggregate: ALL_AGGREGATES
            };
            return;
        }

        this.answers = await this.prompt([
            {
                type: 'list',
                name: 'aggregate',
                message: 'Which Aggregate should be generated?',
                loop: false,
                pageSize: (config?.aggregates?.length ?? 0) + 1,
                choices: [ALL_AGGREGATES].concat(config?.aggregates?.map((item, idx) => item.title).sort() ?? [])
            },
            {
                type: 'checkbox',
                name: 'aggregate_slices',
                loop: false,
                message: 'Choose for which Slices to generate Commands- and Eventsourcing Handlers. (generates to .tmp file)',
                when: (items) => items.aggregate !== ALL_AGGREGATES,
                choices: (items) => config.slices.filter((slice) => !items.context || items.context?.length === 0 || items.context?.includes(slice.context))
                    .filter(slice => {
                        return slice.commands?.some(command => command.aggregateDependencies?.includes(items.aggregate))
                    })
                    .map((item, idx) => item.title).sort(),
            }]);

    }

    writeAggregates() {
        if (this.answers.aggregate === ALL_AGGREGATES) {
            config.aggregates.forEach(aggregate => {
                this.answers.aggregate_slices = this._aggregateSliceTitles(aggregate)
                this._writeAggregates(aggregate)
            })
            return
        }

        this._writeAggregates(config.aggregates.find(item => item.title === this.answers.aggregate))
    }

    _writeAggregates(aggregate) {
        var aggregateIdField = this._aggregateIdField(aggregate)
        var fields = aggregate?.fields?.filter(it => it.name !== aggregateIdField.name).filter(it => !it.idAttribute) ?? []
        var stateField = this._aggregateStateField(aggregate, fields)
        if (stateField) {
            fields = fields.concat(stateField)
        }
        var idFields = aggregateIdField.name
        var idFieldType = typeMapping(aggregateIdField.type, aggregateIdField.cardinality, aggregateIdField.optional, aggregateIdField.mutable)
        var contextPackageName = this._aggregateContextPackage(aggregate)


        const fileExists = fileExistsByGlob(
            `./src/main/kotlin/${_packageFolderName(this.givenAnswers.rootPackageName, contextPackageName, false)}/domain`,
            `${_aggregateTitle(aggregate.title)}.kt`,
            false
        );
        const aggregateFile = fileExists ? `${_aggregateTitle(aggregate.title)}.kt.generated` : `${_aggregateTitle(aggregate.title)}.kt`

        this.fs.copyTpl(
            this.templatePath(`src/components/Aggregate.kt.tpl`),
            this.destinationPath(`./src/main/kotlin/${_packageFolderName(this.givenAnswers.rootPackageName, contextPackageName, false)}/domain/${aggregateFile}`),
            {
                _rootPackageName: this.givenAnswers.rootPackageName,
                _packageName: _packageName(this.givenAnswers.rootPackageName, contextPackageName, false),
                _name: _aggregateTitle(aggregate.title),
                _fields: VariablesGenerator.generateVariables(
                    //aggregate Id is rendered anyways. for this case just filter it
                    fields
                ),
                _idField: idFields,
                _idType: idFieldType,
                _typeImports: typeImports(fields),
                _commandHandlers: this._renderCommandHandlers(aggregate, aggregateIdField),
                _elementImports: this._generateImports(aggregate, this.givenAnswers.rootPackageName)

            }
        )
    }

    _aggregateCommands(aggregate) {
        return config.slices
            .filter(slice => this.answers.aggregate_slices?.includes(slice.title))
            .flatMap(it => it.commands)
            .filter(it => it.aggregateDependencies?.includes(aggregate.title));
    }

    _aggregateSliceTitles(aggregate) {
        return config.slices
            .filter(slice => slice.commands?.some(command => command.aggregateDependencies?.includes(aggregate.title)))
            .map(slice => slice.title)
    }

    _aggregateIdField(aggregate) {
        var aggregateField = aggregate.fields?.find(it => it.idAttribute)
        if (aggregateField) {
            return aggregateField
        }

        var commandFields = this._aggregateCommands(aggregate).flatMap(command => command.fields ?? [])
        return commandFields.find(field => field.idAttribute && field.generated)
            ?? commandFields.find(field => field.idAttribute)
            ?? {name: "aggregateId", type: "UUID", cardinality: "Single", optional: false}
    }

    _aggregateStateField(aggregate, fields) {
        if (!aggregate.states?.length || fields.some(field => field.name === "state")) {
            return undefined
        }
        var concept = codegenModel.concepts?.find(candidate =>
            candidate.name === aggregate.name || candidate.title === aggregate.title
        )

        return {
            name: "state",
            type: concept ? `${concept.name}.State` : "String",
            cardinality: "Single",
            optional: true
        }
    }

    _renderCommandHandlers(aggregate, aggregateIdField) {


        var commands = this._aggregateCommands(aggregate);

        var handlers = commands.map((command) => {
            var eventDeps = uniqBy(command.dependencies.filter(it => it.type === "OUTBOUND")
                .filter(it => it.elementType === "EVENT").map(item => item.id), (eventId) => eventId)
            var events = uniqBy(config.slices.flatMap(slice => slice.events).filter(item => eventDeps.includes(item.id)), (event) => event.id)

            var slice = config.slices.find(it => it.title === command.slice)
            var specs = slice?.specifications?.map(spec => analyzeSpecs(spec))

            return `
            ${specs.length > 0 ? `/*
//AI-TODO: 
        ${specs.join("\n")}
        */` : ``}
    ${command.startsLifecycle ? "@CreationPolicy(AggregateCreationPolicy.CREATE_IF_MISSING)" : ""}
        @CommandHandler
        fun handle(command: ${_commandTitle(command.title)}) {
           ${events.map(event => {
                return `
               AggregateLifecycle.apply(${_eventTitle(event.title)}(${variableAssignments(event.fields, "command", command, ",\n", "=", {includeUnmapped: true})}))
               `
            }).join("\n")}
        }
        
        ${events.map(event => `
        @EventSourcingHandler
        fun on(event: ${_eventTitle(event.title)}){
        // handle event
            ${this._renderEventSourcingAssignments(aggregate, event, aggregateIdField, command.startsLifecycle)}
        }`).join("\n")}
        `
        })

        return handlers.join("\n")

    }

    _renderEventSourcingAssignments(aggregate, event, aggregateIdField, assignAggregateId) {
        var assignments = []
        if (assignAggregateId && event.fields?.some(field => field.name === aggregateIdField.name)) {
            assignments.push(`${aggregateIdField.name}=event.${aggregateIdField.name}`)
        }

        var aggregateAssignments = variableAssignments(
            aggregate.fields?.filter(field => field.name !== aggregateIdField.name).filter(field => !field.idAttribute),
            "event",
            event,
            "\n",
            "="
        )
        if (aggregateAssignments) {
            assignments.push(aggregateAssignments)
        }

        var stateChange = this._stateChangeForEvent(event)
        if (stateChange) {
            var concept = config.slices.find(slice =>
                slice.events?.some(candidate => candidate.id === event.id)
            )?.concepts?.[0]
            var enumStateField = aggregate.fields?.find(field => field.type === `${concept}.State`)
                ?? (concept && aggregate.states?.length ? {name: "state"} : undefined)
            assignments.push(enumStateField
                ? `${enumStateField.name}=${concept}State.${constantCase(stateChange.to)}`
                : `state="${constantCase(stateChange.to)}"`)
        }

        return assignments.join("\n")
    }

    _stateChangeForEvent(event) {
        return config.slices
            .map(slice => slice.stateChange)
            .find(stateChange => stateChange?.eventId === event.id)
    }

    _aggregateContextPackage(aggregate) {
        var slice = config.slices.find(slice =>
            this.answers.aggregate_slices?.includes(slice.title)
            && slice.commands?.some(command => command.aggregateDependencies?.includes(aggregate.title))
        )
        return contextPackage(slice?.context)
    }

    _sliceContextPackage(sliceName) {
        return contextPackage(config.slices.find(slice => slice.title === sliceName)?.context)
    }

    _generateImports(aggregate, rootPackageName) {

        var commands = config.slices
            .filter(slice => this.answers.aggregate_slices?.includes(slice.title))
            .flatMap(it => it.commands)
            .filter(it => it.aggregateDependencies?.includes(aggregate.title));

        var eventDeps = commands.flatMap(command => command.dependencies.filter(it => it.type === "OUTBOUND")
            .filter(it => it.elementType === "EVENT").map(it => it.id))
        var events = config.slices.flatMap(slice => slice.events ?? []).filter(event => eventDeps.includes(event.id))
        var commandImports = commands?.map((command) =>
            `import ${_packageName(rootPackageName, this._sliceContextPackage(command.slice), false)}.domain.commands.${_sliceTitle(command.slice)}.${_commandTitle(command.title)}`) ?? []
        var eventImports = events?.map((event) =>
            `import ${_packageName(rootPackageName, this._sliceContextPackage(event.slice), false)}.events.${_eventTitle(event.title)}`) ?? []

        return commandImports.concat(eventImports).join("\n")
    }
};


class VariablesGenerator {

//(: {name, type, example, mapping}
    static generateVariables(fields) {
        return fields?.map((variable) => {
            if (variable.cardinality?.toLowerCase() === "list") {
                return `\tvar ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional)} = emptyList();`;
            } else {
                return `\tvar ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional)}? = null;`;
            }
        }).join("\n")
    }

    static generateInvocation(fields) {
        return fields?.map((variable) => {

            return `${variable.name}`;

        }).filter((it) => it !== "").join(",")
    }

    static generateRestParamInvocation(fields) {
        return fields?.map((variable) => {
            if (variable.type?.toLowerCase() === "date") {

                return `@DateTimeFormat(pattern = "dd.MM.yyyy") @RequestParam ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional)}`;
            } else if (variable.type?.toLowerCase() === "datetime") {

                return `@DateTimeFormat(pattern = "dd.MM.yyyy HH:MM:SS") @RequestParam ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional)}`;
            }
            {
                return `@RequestParam ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional)}`;
            }

        }).filter((it) => it !== "").join(",")
    }
}

const constantCase = (value) => {
    return `${value}`
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/[\s-]+/g, "_")
        .replace(/_+/g, "_")
        .toUpperCase()
}

function contextPackage(context) {
    return context ? slugify(`${context}`).replaceAll("-", "").replaceAll("_", "").toLowerCase() : undefined
}
