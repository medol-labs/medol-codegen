/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

var Generator = require('yeoman-generator').default;
var slugify = require('slugify')
const {answers} = require("../app");
const {
    _eventTitle,
    _commandTitle,
    _processorTitle,
    _readmodelTitle,
    _sliceTitle,
    _aggregateTitle,
    _restResourceTitle
} = require("../../common/util/naming");
const {variableAssignments, processSourceMapping} = require("../../common/util/variables");
const {ClassesGenerator, configureValueTypes, typeMapping, typeImports, idType} = require("../../common/util/generator");
const {findValueType, resolvedBaseType} = require('../../common/util/value-types');
const {_sliceSpecificClassTitle, _packageName, _packageFolderName} = require("../../common/util/naming");
const {camelCaseToUnderscores, idField} = require("../../common/util/util");
const {analyzeSpecs} = require("../../common/util/specs");
const {buildLink} = require("../../common/util/config");
const {loadGeneratorModel} = require("../../common/core/config-loader");

let config = {}
let codegenModel = {}

module.exports = class extends Generator {

    constructor(args, opts) {
        super(args, opts);
        this.opts = opts ?? {};
        this.givenAnswers = opts.answers

        this.argument('appname', { type: String, required: false });

        const loaded = loadGeneratorModel(this.env.cwd);
        config = loaded.config;
        codegenModel = loaded.codegenModel;
        configureValueTypes(codegenModel.valueTypes, codegenModel.rootPackage);
    }

    async prompting() {
        if (this.opts.allSlices || this.givenAnswers.allSlices) {
            this.answers = {
                slice: config.slices.map((slice) => slice.title),
                liveReportModels: [],
                processTriggers: []
            };
            return;
        }

        this.answers = await this.prompt([
            {
                type: 'checkbox',
                name: 'slice',
                loop: false,
                message: 'Choose Slices to generate?',
                choices: (items) => config.slices.filter((slice) => !items.context || items.context?.length === 0 || items.context?.includes(slice.context)).map((item, idx) => item.title).sort(),
                when: (answers) => !answers.allSlices
            },
            {
                type: 'checkbox',
                name: 'liveReportModels',
                message: 'Which ReadModels should read directly from the Eventstream?',
                when: (input) => {
                    return input.slice?.length == 1
                        && config.slices.find((slice) => slice.title === input.slice[0])?.readmodels?.length > 0
                        // for now don´t use list elements for live models, as it´s uncler how to handle ids
                        && !config.slices.find((slice) => slice.title === input.slice[0])?.readmodels[0]?.listElement
                },
                choices: (items) => config.slices.filter((slice) => !items.context || items.context?.length === 0 || items.context?.includes(slice.context)).filter((item) => item.title === items.slice[0]).flatMap((slice) => slice.readmodels).map(item => item.title)
            },
            {
                type: 'checkbox',
                name: 'processTriggers',
                message: 'Which event triggers the Automation?',
                when: (input) => input.slice.length === 1 && (this._findTriggerEvents(input)?.length > 0),
                choices: (items) => this._findTriggerEvents(items)
            }])

    }

    _findTriggerEvents(items) {
        var slice = config.slices.filter((slice) => !items.context || items.context?.length === 0 || items.context?.includes(slice.context)).filter((item) => item.title === items.slice[0])[0]
        if (!slice) {
            return []
        }

        var processor = slice.processors[0]
        if (!processor) {
            return []
        }

        var inboundDepIds = processor.dependencies.filter((dep) => dep.type === "INBOUND" && dep.elementType === "READMODEL").map(it => it.id)

        var readModels = config.slices.flatMap((slice) => slice.readmodels).filter((readmodel) => inboundDepIds.includes(readmodel.id))

        var events = readModels.flatMap(it => it.dependencies.filter(dep => dep.type === "INBOUND" && dep.elementType === "EVENT")).map(it => it.title)

        return events
    }

    async writeSlice() {

        if (this.answers.slice.length === 0)
            return
        if (this.answers.slice.length > 1) {
            for (const slice of this.answers.slice) {
                await this._writeSingleSlice(slice)
            }
        } else {
            await this._writeSingleSlice(this.answers.slice[0])
        }


    }

    async _writeSingleSlice(slice) {
        var sliceName = slice
        this._writeReadme(sliceName)
        this._writeSliceDescription(sliceName)
        this._writeCommands(sliceName);
        this._writeEvents(sliceName)
        this._writeReadModels(sliceName)
        this._writeRestControllers(sliceName)
        const generatorPath = require.resolve('../specifications');
        const GeneratorClass = require(generatorPath);
        await this.composeWith({
            Generator: GeneratorClass.default ?? GeneratorClass,
            path: generatorPath
        }, {
            answers: {...this.answers, ...this.givenAnswers, slice: sliceName},
            appName: this.answers.appName ?? this.appName
        });
        this._writeProcessors(sliceName)

    }

    _contextPackage(slice) {
        return contextPackage(slice?.context)
    }

    _contextPackageForSliceName(sliceName) {
        return this._contextPackage(this._findSlice(sliceName))
    }

    _contextPackageForElement(element) {
        return this._contextPackageForSliceName(element?.slice)
    }

    _packageNameForContext(contextPackageName) {
        return _packageName(this.givenAnswers.rootPackageName, contextPackageName, false)
    }

    _packageFolderForContext(contextPackageName) {
        return _packageFolderName(this.givenAnswers.rootPackageName, contextPackageName, false)
    }

    _writeSliceDescription(sliceName) {
        var slice = this._findSlice(sliceName)
        var contextPackageName = this._contextPackage(slice)
        this.fs.copyTpl(
            this.templatePath(`.slice.json.tpl`),
            this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${_sliceTitle(sliceName)}/.slice.json`),
            {
                title: sliceName,
                id: slice.id,
                context: slice.context,
                link: buildLink(config.boardId, slice.id)
            }
        )
    }

    _writeReadme(sliceName) {
        var slice = this._findSlice(sliceName)
        var title = _slicePackage(slice.title).toLowerCase()
        var contextPackageName = this._contextPackage(slice)


        this.fs.copyTpl(
            this.templatePath(`src/components/README.md.tpl`),
            this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${title}/README.md`),
            {
                _name: slice.title,
                _link: boardlLink(config.boardId, slice.id)
            }
        )

    }

    _writeCommands(sliceName) {
        var slice = this._findSlice(sliceName)
        var title = _slicePackage(slice.title).toLowerCase()
        var contextPackageName = this._contextPackage(slice)


        slice.commands?.filter((command) => command.title).forEach((command) => {

            this.fs.copyTpl(
                this.templatePath(`src/components/package-info.java.tpl`),
                this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/domain/commands/${title}/package-info.java`),
                {
                    _slice: title,
                    _rootPackageName: this.givenAnswers.rootPackageName,
                    _packageName: this._packageNameForContext(contextPackageName),
                    link: boardlLink(config.boardId, command.id)
                }
            )


            this.fs.copyTpl(
                this.templatePath(`src/components/Command.kt.tpl`),
                this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/domain/commands/${title}/${_commandTitle(command.title)}.kt`),
                {
                    _slice: title,
                    _rootPackageName: this.givenAnswers.rootPackageName,
                    _packageName: this._packageNameForContext(contextPackageName),
                    _name: _commandTitle(command.title),
                    _fields: ConstructorGenerator.generateCommandConstructorVariables(
                        command.fields,
                        [],
                        idField(command) ?? "aggregateId"
                    ),
                    link: boardlLink(config.boardId, command.id),
                    _typeImports: typeImports(command.fields)

                }
            )
        })


    }


    _writeEvents(sliceName, eventFilter = []) {

        var slice = this._findSlice(sliceName)
        var title = _slicePackage(slice?.title).toLowerCase()
        var contextPackageName = this._contextPackage(slice)

        slice.events?.filter((event) => event.title)
            .filter((event) => {
                return !eventFilter || eventFilter.length === 0 || eventFilter.includes(event.title)
            })
            .filter(event => event.context !== "EXTERNAL")
            .forEach((event) => {

                this.fs.copyTpl(
                    this.templatePath(`src/components/Event.kt.tpl`),
                    this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/events/${_eventTitle(event.title)}.kt`),
                    {
                        _slice: title,
                        _rootPackageName: this.givenAnswers.rootPackageName,
                        _packageName: this._packageNameForContext(contextPackageName),
                        _name: _eventTitle(event.title),
                        _fields: ConstructorGenerator.generateConstructorVariables(
                            event.fields
                        ),
                        //for now take first aggregate
                        _typeImports: typeImports(event.fields),
                        link: boardlLink(config.boardId, event.id),

                    }
                )
            })


    }


    _writeReadModels(sliceName) {
        var slice = this._findSlice(sliceName)
        var title = _slicePackage(slice.title).toLowerCase()

        slice.readmodels?.filter((readmodel) => readmodel.title).forEach((readmodel) => {


            let liveReport = this.answers.liveReportModels?.includes(readmodel.title)

            let sliceEvents = config.slices.flatMap(it => it.events)
            let inboundEvents = readmodel.dependencies?.filter(it => it.type === "INBOUND").filter(it => it.elementType === "EVENT").map(it => sliceEvents.find(sliceEvent => it.id === sliceEvent.id)).filter(it => it)

            let idAttributes = readmodel.fields.filter(it => it.idAttribute)

            if (liveReport) {
                this._writeLiveReportReadModel(title, readmodel, inboundEvents)
            } else {
                if (idAttributes.length <= 1) {
                    this._writeQueryableReportReadModel(title, readmodel, inboundEvents, slice)
                } else {
                    this._writeQueryableMultiKeyReportReadModel(title, readmodel, inboundEvents, slice)
                }
            }

            var eventDeps = readmodel.dependencies.filter(it => it.type === "INBOUND" && it.elementType === "EVENT")
            var events = config.slices.flatMap(slice => slice.events).filter(event => eventDeps.map(it => it.id).includes(event.id))
            events.forEach(event => {
                this._writeEvents(event.slice, [event.title])
            })
        })

    }

    _repositoryQuery(readModel) {
        var idAttributes = readModel.fields?.filter(it => it.idAttribute) ?? []
        var idField = idAttributes[0]?.name ?? "aggregateId"
        if (readModel.listElement ?? false) {
            if (idAttributes.length > 1) {
                var key = `${_readmodelTitle(readModel.title)}Key(${VariablesGenerator.generateInvocation(idAttributes, "query")})`
                return `
            if(!repository.existsById(${key})) {
                return ${_readmodelTitle(readModel.title)}(emptyList())
            }
            return ${_readmodelTitle(readModel.title)}(listOf(repository.findById(${key}).get()))`
            }
            return `return ${_readmodelTitle(readModel.title)}(repository.findAll())`
        } else {
            return `
            if(!repository.existsById(query.${idField})) {
                return null
            }
            return ${_readmodelTitle(readModel.title)}(repository.findById(query.${idField}).get())`
        }
    }

    _writeLiveReportReadModel(slice, readmodel, inboundEvents) {
        const idAttribute = readmodel.fields.find(it => it.idAttribute)?.name
        const idTypeVar = idType(readmodel)
        const contextPackageName = this._contextPackageForElement(readmodel)
        if (readmodel.listElement) {

            this.fs.copyTpl(
                this.templatePath(`src/components/LiveReportListReadModel.kt.tpl`),
                this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${slice}/${_readmodelTitle(readmodel.title)}.kt`),
                {
                    _slice: slice,
                    _rootPackageName: this.givenAnswers.rootPackageName,
                    _packageName: this._packageNameForContext(contextPackageName),
                    _name: _readmodelTitle(readmodel.title),
                    _fields: ConstructorGenerator.generateConstructorVariables(
                        readmodel.fields
                    ),
                    _eventsImports: this._eventsImports(inboundEvents.map(it => it.title)),

                    _eventLoop: _renderReadModelSwitchCase(readmodel, inboundEvents),

                    _typeImports: typeImports(readmodel.fields),
                    link: boardlLink(config.boardId, readmodel.id),
                    idAttribute: idAttribute,
                    idType: idTypeVar
                }
            )
        } else {

            this.fs.copyTpl(
                this.templatePath(`src/components/LiveReportReadModel.kt.tpl`),
                this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${slice}/${_readmodelTitle(readmodel.title)}.kt`),
                {
                    _slice: slice,
                    _rootPackageName: this.givenAnswers.rootPackageName,
                    _packageName: this._packageNameForContext(contextPackageName),
                    _name: _readmodelTitle(readmodel.title),
                    _fields: VariablesGenerator.generateLiveReportVariables(
                        readmodel.fields
                    ),
                    _eventsImports: this._eventsImports(inboundEvents.map(it => it.title)),

                    _eventLoop: _renderReadModelSwitchCase(readmodel, inboundEvents),

                    _typeImports: typeImports(readmodel.fields),
                    link: boardlLink(config.boardId, readmodel.id),
                    idAttribute: idAttribute,
                    idType: idTypeVar
                }
            )
        }

        this.fs.copyTpl(
            this.templatePath(`src/components/LiveReportQueryHandler.kt.tpl`),
            this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${slice}/internal/${_readmodelTitle(readmodel.title)}QueryHandler.kt`),
            {
                _slice: slice,
                _rootPackageName: this.givenAnswers.rootPackageName,
                _packageName: this._packageNameForContext(contextPackageName),
                _name: _readmodelTitle(readmodel.title),
                _typeImports: typeImports(readmodel.fields),
                link: boardlLink(config.boardId, readmodel.id),
                idAttribute: idAttribute,
                idType: idTypeVar
            }
        )

        this.fs.copyTpl(
            this.templatePath(`src/components/ReadOnlyRestResource.kt.tpl`),
            this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${slice}/internal/ReadOnly${_restResourceTitle(readmodel.title)}.kt`),
            {
                _slice: slice,
                _rootPackageName: this.givenAnswers.rootPackageName,
                _packageName: this._packageNameForContext(contextPackageName),
                _name: slice,
                _readModel: _readmodelTitle(readmodel.title),
                _controller: capitalizeFirstCharacter(slice),
                _aggregate: this._aggregatePath(readmodel, slice),
                _typeImports: typeImports(readmodel.fields),
                _endpoint: this._generateGetRestCall(slice, VariablesGenerator.generateRestParamInvocation(
                    readmodel.fields
                ), readmodel, readmodel.apiEndpoint),
                link: boardlLink(config.boardId, readmodel.id),
                idAttribute: idAttribute,
                idType: idTypeVar
            }
        )
    }

    _readModelQueryElement(readModel) {
        var idField = readModel.fields?.find(it => it.idAttribute)
        var idFieldName = idField?.name ?? "aggregateId"
        var idType = idField ? typeMapping(idField?.type, idField?.cardinality, idField?.optional, idField?.mutable) : "UUID"

        if (readModel.listElement ?? false) {
            return `class ${_readmodelTitle(readModel.title)}Query()`
        } else {
            return `data class ${_readmodelTitle(readModel.title)}Query(val ${idFieldName}:${idType})
`
        }
    }

    _writeQueryableMultiKeyReportReadModel(sliceTitle, readModel, inboundEvents, slice) {

        var specs = slice?.specifications?.map(spec => analyzeSpecs(spec))
        var aiComment = specs?.length > 0 ? `/*
         // AI-TODO:
         ${specs.join(`\n`)} */` : ""
        var contextPackageName = this._contextPackage(slice)


        this.fs.copyTpl(
            this.templatePath(`src/components/QueryableMultiKeyReadModelProjector.kt.tpl`),
            this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${sliceTitle}/internal/${_readmodelTitle(readModel.title)}Projector.kt`),
            {
                _slice: sliceTitle,
                _aiComment: aiComment,
                _rootPackageName: this.givenAnswers.rootPackageName,
                _packageName: this._packageNameForContext(contextPackageName),
                _name: _readmodelTitle(readModel.title),
                _fields: VariablesGenerator.generateVariables(
                    readModel.fields
                ),
                _eventsImports: this._eventsImports(inboundEvents.map(it => it?.title)),
                _eventHandlers: this._renderMultiKeyEventHandlers(readModel, inboundEvents),

                //no UUID, as this is fixed in the Projector
                _typeImports: typeImports(readModel.fields, "import java.util.UUID"),
                link: boardlLink(config.boardId, readModel.id),
            }
        )

        this.fs.copyTpl(
            this.templatePath(`src/components/QueryableMultiKeyReadModelQueryHandler.kt.tpl`),
            this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${sliceTitle}/internal/${_readmodelTitle(readModel.title)}QueryHandler.kt`),
            {
                _slice: sliceTitle,
                _rootPackageName: this.givenAnswers.rootPackageName,
                _packageName: this._packageNameForContext(contextPackageName),
                _name: _readmodelTitle(readModel.title),
                _query: this._repositoryQuery(readModel),
                _listElement: readModel.listElement,
                _typeImports: typeImports(readModel.fields),
                _fields: VariablesGenerator.generateInvocation(readModel.fields.filter(it => it.idAttribute), "query"),
                link: boardlLink(config.boardId, readModel.id),
            }
        )

        this.fs.copyTpl(
            this.templatePath(`src/components/QueryableMultiKeyReadModel.kt.tpl`),
            this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${sliceTitle}/${_readmodelTitle(readModel.title)}.kt`),
            {
                _slice: sliceTitle,
                _packageName: this._packageNameForContext(contextPackageName),
                _rootPackageName: this.givenAnswers.rootPackageName,
                _typeImports: typeImports(readModel.fields),
                _name: _readmodelTitle(readModel.title),
                _data: this._readModelData(readModel),
                _keyFields: this._keyFields(readModel, false),
                _annotatedKeyFields: this._keyFields(readModel, true),
                _entityFields: VariablesGenerator.generateEntityVariables(
                    sliceTitle,
                    readModel.fields,
                    readModel?.fields.find(it => it?.idAttribute).name ?? "aggregateId"
                ),
                link: boardlLink(config.boardId, readModel.id),
            }
        )

        this.fs.copyTpl(
            this.templatePath(`src/components/ReadOnlyRestResource.kt.tpl`),
            this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${sliceTitle}/internal/ReadOnly${_restResourceTitle(readModel.title)}.kt`),
            {
                _slice: sliceTitle,
                _rootPackageName: this.givenAnswers.rootPackageName,
                _packageName: this._packageNameForContext(contextPackageName),
                _name: sliceTitle,
                _readModel: _readmodelTitle(readModel.title),
                _controller: capitalizeFirstCharacter(sliceTitle),
                _aggregate: this._aggregatePath(readModel, sliceTitle),
                _typeImports: typeImports(readModel.fields),
                _endpoint: this._generateGetRestCall(sliceTitle, VariablesGenerator.generateRestParamInvocation(
                    //only provide aggregateId (so that proper imports are generated)
                    readModel.fields?.filter(item => item.name === "aggregateId")
                ), readModel, readModel.apiEndpoint),
                link: boardlLink(config.boardId, readModel.id),
            }
        )

        this.fs.copyTpl(
            this.templatePath(`src/components/ReadOnlyRestResource.kt.tpl`),
            this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${sliceTitle}/internal/ReadOnly${_restResourceTitle(readModel.title)}.kt`),
            {
                _slice: sliceTitle,
                _rootPackageName: this.givenAnswers.rootPackageName,
                _packageName: this._packageNameForContext(contextPackageName),
                _name: sliceTitle,
                _readModel: _readmodelTitle(readModel.title),
                _controller: capitalizeFirstCharacter(sliceTitle),
                _aggregate: this._aggregatePath(readModel, sliceTitle),
                _typeImports: typeImports(readModel.fields),
                _endpoint: this._generateGetRestCall(sliceTitle, VariablesGenerator.generateRestParamInvocation(
                    readModel.fields
                ), readModel, readModel.apiEndpoint),
                link: boardlLink(config.boardId, readModel.id),
            }
        )
    }

    _keyFields(readModel) {
        return ConstructorGenerator.generateConstructorVariables(readModel.fields?.filter(it => it.idAttribute))
    }

    _writeQueryableReportReadModel(sliceTitle, readModel, inboundEvents, slice) {

        var specs = slice?.specifications?.map(spec => analyzeSpecs(spec))
        var aiComment = specs?.length > 0 ? `/* 
        // AI-TODO:
        ${specs.join(`\n`)} */` : ""
        var contextPackageName = this._contextPackage(slice)

        this.fs.copyTpl(
            this.templatePath(`src/components/QueryableReadModelProjector.kt.tpl`),
            this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${sliceTitle}/internal/${_readmodelTitle(readModel.title)}Projector.kt`),
            {
                _slice: sliceTitle,
                _aiComment: aiComment,
                _idType: idType(readModel),
                _rootPackageName: this.givenAnswers.rootPackageName,
                _packageName: this._packageNameForContext(contextPackageName),
                _name: _readmodelTitle(readModel.title),
                _fields: VariablesGenerator.generateVariables(
                    readModel.fields
                ),
                _eventsImports: this._eventsImports(inboundEvents.map(it => it?.title)),
                _eventHandlers: this._renderEventHandlers(readModel, inboundEvents),

                //no UUID, as this is fixed in the Projector
                _typeImports: typeImports(readModel.fields, "import java.util.UUID"),
                link: boardlLink(config.boardId, readModel.id),
            }
        )

        this.fs.copyTpl(
            this.templatePath(`src/components/QueryableReadModelQueryHandler.kt.tpl`),
            this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${sliceTitle}/internal/${_readmodelTitle(readModel.title)}QueryHandler.kt`),
            {
                _slice: sliceTitle,
                _rootPackageName: this.givenAnswers.rootPackageName,
                _packageName: this._packageNameForContext(contextPackageName),
                _name: _readmodelTitle(readModel.title),
                //for now take first aggregate
                _query: this._repositoryQuery(readModel),
                _typeImports: typeImports(readModel.fields),
                link: boardlLink(config.boardId, readModel.id),

            }
        )

        this.fs.copyTpl(
            this.templatePath(`src/components/QueryableReadModel.kt.tpl`),
            this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${sliceTitle}/${_readmodelTitle(readModel.title)}.kt`),
            {
                _slice: sliceTitle,
                _data: this._readModelData(readModel),
                _queryElement: this._readModelQueryElement(readModel),
                _rootPackageName: this.givenAnswers.rootPackageName,
                _packageName: this._packageNameForContext(contextPackageName),
                _name: _readmodelTitle(readModel.title),
                //for now take first aggregate
                _entityFields: VariablesGenerator.generateEntityVariables(
                    sliceTitle,
                    readModel.fields,
                    readModel.fields?.find(it => it.idAttribute)?.name ?? "aggregateId"
                ),
                _typeImports: typeImports(readModel.fields),
                link: boardlLink(config.boardId, readModel.id),
            }
        )

        this.fs.copyTpl(
            this.templatePath(`src/components/ReadOnlyRestResource.kt.tpl`),
            this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${sliceTitle}/internal/ReadOnly${_restResourceTitle(readModel.title)}.kt`),
            {
                _slice: sliceTitle,
                _rootPackageName: this.givenAnswers.rootPackageName,
                _packageName: this._packageNameForContext(contextPackageName),
                _name: sliceTitle,
                _readModel: _readmodelTitle(readModel.title),
                _controller: capitalizeFirstCharacter(sliceTitle),
                _aggregate: this._aggregatePath(readModel, sliceTitle),
                _typeImports: typeImports(readModel.fields),
                _endpoint: this._generateGetRestCall(sliceTitle, VariablesGenerator.generateRestParamInvocation(
                    readModel.fields
                ), readModel, readModel.apiEndpoint),
                link: boardlLink(config.boardId, readModel.id),
            }
        )
    }

    _renderMultiKeyEventHandlers(readModel, events) {
        var readModelTitle = _readmodelTitle(readModel.title)
        var readModelIdFields = readModel.fields.filter(it => it.idAttribute)
        return events.map(it => {
            var lookup = this._readModelLookup(readModel, it)
            return `
@EventHandler
fun on(event: ${_eventTitle(it.title)}) {
    //throws exception if not available (adjust logic)
    ${lookup.declarations}
    val entity = this.repository.findById(${readModelTitle}Key(${lookup.expressions.join(", ")})).orElse(${_readmodelTitle(readModel.title)}Entity())
    entity.apply {
        ${readModelAssignments(readModel, it, "\n", lookup.fallbacks)}
    }.also { this.repository.save(it) }
}`
        }).join("\n")
    }

    _renderEventHandlers(readModel, events) {
        return events.map(it => {
            var lookup = this._readModelLookup(readModel, it)
            return `
@EventHandler
fun on(event: ${_eventTitle(it.title)}) {
    //throws exception if not available (adjust logic)
    ${lookup.declarations}
    val entity = this.repository.findById(${lookup.expressions[0]}).orElse(${_readmodelTitle(readModel.title)}Entity())
    entity.apply {
        ${readModelAssignments(readModel, it, "\n", lookup.fallbacks)}
    }.also { this.repository.save(it) }
}`
        }).join("\n")
    }

    _readModelLookup(readModel, event) {
        var idFields = readModel.fields.filter(field => field.idAttribute)
        var fallbacks = {}
        var declarations = []
        var expressions = idFields.map(field => {
            if (event.fields?.some(eventField => eventField.name === field.name)) {
                return `event.${field.name}`
            }

            var fallbackName = `${field.name}ForLookup`
            fallbacks[field.name] = fallbackName
            declarations.push(`val ${fallbackName} = ${fallbackValue(field)} /* TODO resolve ${field.name} for ${_eventTitle(event.title)} */`)
            return fallbackName
        })

        return {
            declarations: declarations.join("\n    "),
            expressions,
            fallbacks
        }
    }

    _writeRestControllers(sliceName) {
        var slice = this._findSlice(sliceName)
        var title = _slicePackage(slice.title).toLowerCase()
        var contextPackageName = this._contextPackage(slice)


        slice.commands?.filter((command) => command.title).forEach((command) => {
            const apiFields = command.fields?.filter(field => !field.generated)
            this.fs.copyTpl(
                this.templatePath(`src/components/RestResource.kt.tpl`),
                this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${title}/internal/${_restResourceTitle(command.title)}.kt`),
                {
                    _slice: title,
                    _rootPackageName: this.givenAnswers.rootPackageName,
                    _packageName: this._packageNameForContext(contextPackageName),
                    _name: title,
                    _command: _commandTitle(command.title),
                    _controller: _restResourceTitle(command.title),
                    _aggregate: this._aggregatePath(command, title),
                    _typeImports: typeImports(command.fields),
                    _debugendpoint: this._generateDebugPostRestCall(title, VariablesGenerator.generateRestParamInvocation(
                        apiFields
                    ), command, VariablesGenerator.generateInvocation(
                        command.fields
                    ), command.apiEndpoint),
                    _payload: ClassesGenerator.generateDataClass(_sliceSpecificClassTitle(sliceName, "Payload"), apiFields),
                    _endpoint: this._generatePostRestCall(slice.title, command,
                        variableAssignments(command.fields, "payload", command, ",\n", "="), command.apiEndpoint),
                    link: boardlLink(config.boardId, command.id),
                }
            )
        })

    }

    _readModelData(readModel) {
        if (readModel?.listElement) {
            return `val data: List<${_readmodelTitle(readModel.title)}Entity>`
        } else {
            return `val data: ${_readmodelTitle(readModel.title)}Entity`
        }
    }

    _aggregatePath(element, fallback) {
        const aggregate = element.aggregate ?? element.aggregateDependencies?.[0] ?? fallback
        return _slicePackage(aggregate).toLowerCase()
    }

    _generateDebugPostRestCall(slice, restVariables, command, variables, endpoint) {
        let commandTitle = _commandTitle(command.title)
        let generatedAssignments = this._generateGeneratedFieldAssignments(command)
        return `
    @CrossOrigin
    @PostMapping(${endpoint ? `\"/debug${endpoint?.startsWith("/") ? endpoint : "/" + endpoint}\"` : `\"/debug/${slice}\"`})
    fun processDebugCommand(${restVariables}):CompletableFuture<Any> {
        ${generatedAssignments}return commandGateway.send(${commandTitle}(${variables}))
    }
    `
    }

    _generatePostRestCall(slice, command, variableAssignments, endpoint) {
        let commandTitle = _commandTitle(command.title)
        let generatedIdField = command.fields?.find(field => field.idAttribute && field.generated)
        let hasGeneratedIdField = !!generatedIdField
        let baseEndpoint = endpoint ? `"${endpoint}"` : `"/${_sliceTitle(slice)}"`
        let postMapping = hasGeneratedIdField
            ? baseEndpoint
            : endpoint ? `"${endpoint}/{id}"` : `"/${_sliceTitle(slice)}/{id}"`
        let idParameter = hasGeneratedIdField
            ? ""
            : `@PathVariable("id") ${idField(command)}: ${idType(command)},
        `
        let generatedAssignments = this._generateGeneratedFieldAssignments(command)
        let commandAssignments = this._applyGeneratedFieldAssignments(command, variableAssignments)
        return `
       @CrossOrigin
       @PostMapping(${postMapping})
    fun processCommand(
        ${idParameter}@RequestBody payload: ${_sliceSpecificClassTitle(slice, "Payload")}
    ):CompletableFuture<Any> {
         ${generatedAssignments}return commandGateway.send(${commandTitle}(${commandAssignments}))
        }
       `
    }

    _generateGeneratedFieldAssignments(command) {
        return command.fields?.filter(field => field.generated).map(field => {
            return `val ${field.name} = ${this._generatedFieldValue(field)}
        `
        }).join("") ?? ""
    }

    _applyGeneratedFieldAssignments(command, assignments) {
        return command.fields?.filter(field => field.generated).reduce((result, field) => {
            return result.replace(`${field.name}=payload.${field.name}`, `${field.name}=${field.name}`)
        }, assignments) ?? assignments
    }

    _generatedFieldValue(field) {
        switch (field.type?.toLowerCase()) {
            case "uuid":
                return "UUID.randomUUID()"
            case "date":
                return "LocalDate.now()"
            case "datetime":
                return "LocalDateTime.now()"
            case "string":
                return "\"\""
            case "boolean":
                return "false"
            case "int":
                return "0"
            case "long":
                return "0L"
            case "double":
                return "0.0"
            default:
                return "\"\""
        }
    }

    _generateQuery(slice, readModel) {
        var readModelTitle = _readmodelTitle(readModel.title)
        var idAttributes = readModel.fields?.filter(it => it.idAttribute) ?? []

        if (readModel.listElement ?? false) {
            if (idAttributes.length > 1) {
                return `queryGateway.query(${readModelTitle}Query(${VariablesGenerator.generateInvocation(idAttributes)}), ${readModelTitle}::class.java)`;
            }
            return `queryGateway.query(${readModelTitle}Query(), ${readModelTitle}::class.java)`
        } else {
            if (idAttributes.length <= 1) {
                return `queryGateway.query(${readModelTitle}Query(${idField(readModel)}), ${readModelTitle}::class.java)`;
            } else {
                return `queryGateway.query(${readModelTitle}Query(${VariablesGenerator.generateInvocation(idAttributes)}), ${readModelTitle}::class.java)`;
            }
        }
    }

    _generateGetRestCall(slice, restVariables, readModel, endpoint) {
        var readModelTitle = _readmodelTitle(readModel.title)
        var readModelIdAttributes = readModel.fields.filter(it => it.idAttribute)
        if (readModel.listElement) {
            if (readModelIdAttributes.length > 1) {
                var requestParams = readModelIdAttributes.map(it => `@RequestParam("${it.name}") ${it.name}:${typeMapping(it.type, it.cardinality, it.optional, it.mutable)}`).join(",\n")
                return `@GetMapping(${endpoint ? `"${endpoint}"` : `"/${slice}"`})
                    fun findReadModel(${requestParams}):CompletableFuture<${readModelTitle}> {
                         return ${this._generateQuery(slice, readModel)}
                    }`
            }
            return `@GetMapping(${endpoint ? `"${endpoint}"` : `"/${slice}"`})
                    fun findReadModel():CompletableFuture<${readModelTitle}> {
                         return ${this._generateQuery(slice, readModel)}  
                    }`
        } else {
            if (readModelIdAttributes.length <= 1) {
                return `@GetMapping(${endpoint ? `"${endpoint}/{id}"` : `"/${slice}/{id}"`})
                      fun findReadModel(@PathVariable("id") ${idField(readModel)}: ${idType(readModel)}):CompletableFuture<${readModelTitle}> {
                           return ${this._generateQuery(slice, readModel)}  
                      }`
            } else {
                var idAttributes = readModelIdAttributes.filter(it => it.name !== "aggregateId")
                var requestParams = idAttributes.map(it => `@RequestParam("${it.name}") ${it.name}:${typeMapping(it.type, it.cardinality, it.optional, it.mutable)}`).join(",\n")
                return `@GetMapping(${endpoint ? `"${endpoint}"` : `"/${slice}"`})
                      fun findReadModel(${requestParams}):CompletableFuture<${readModelTitle}> {
                           return ${this._generateQuery(slice, readModel)}  
                      }`
            }
        }

    }


    _writeProcessors(sliceName) {
        var slice = this._findSlice(sliceName)
        var title = _slicePackage(slice.title).toLowerCase()
        var command = slice.commands.length > 0 ? slice.commands[0] : null
        var contextPackageName = this._contextPackage(slice)

        slice.processors?.filter((processor) => processor.title).forEach((processor) => {

            var readModelDependency = processor?.dependencies?.filter((it) => it.type === "INBOUND" && it.elementType === "READMODEL")[0]

            var readModel = config.slices.flatMap(it => it.readmodels).find(it => it.id === readModelDependency?.id)


            var eventsDeps = readModel?.dependencies?.filter((it) => it.type === "INBOUND" && it.elementType === "EVENT").map(it => it.id) ?? [];

            var events = config.slices.flatMap(it => it.events).filter(it => eventsDeps.includes(it?.id));

            if (readModel) {
                this.fs.copyTpl(
                    this.templatePath(`src/components/StatelessProcessor.kt.tpl`),
                    this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${title}/internal/${_processorTitle(processor.title)}.kt`),
                    {
                        _slice: title,
                        _readModelSlice: _sliceTitle(readModel.slice),
                        _readModel: _readmodelTitle(readModel.title),
                        _typeImports: typeImports(readModel.fields),
                        _rootPackageName: this.givenAnswers.rootPackageName,
                        _packageName: this._packageNameForContext(contextPackageName),
                        _readModelPackageName: this._packageNameForContext(this._contextPackageForElement(readModel)),
                        _name: _processorTitle(processor.title),
                        _eventsImports: this._eventsImports(this.answers.processTriggers),
                        _fields: VariablesGenerator.generateVariables(
                            readModel.fields
                        ),
                        _triggers: this._renderStatelessProcessorTriggers(readModel, this.answers.processTriggers || [], events, command),
                        _command: command ? _commandTitle(command.title) : "",
                        link: boardlLink(config.boardId, processor.id),

                    })
            } else {
                this.fs.copyTpl(
                    this.templatePath(`src/components/StatelessStandaloneProcessor.kt.tpl`),
                    this.destinationPath(`./src/main/kotlin/${this._packageFolderForContext(contextPackageName)}/${title}/internal/${_processorTitle(processor.title)}.kt`),
                    {
                        _slice: title,
                        _rootPackageName: this.givenAnswers.rootPackageName,
                        _packageName: this._packageNameForContext(contextPackageName),
                        _name: _processorTitle(processor.title),
                        _eventsImports: this._eventsImports(this.answers.processTriggers),
                        _triggers: this._renderStatelessProcessorTriggers(readModel, this.answers.processTriggers || [], events, command),
                        _command: command ? _commandTitle(command.title) : "",
                        link: boardlLink(config.boardId, processor.id),

                    })
            }
        })


    }

    _eventsImports(triggers) {
        return triggers?.map((trigger) => {
            return `import ${this._eventPackageNameByTitle(trigger)}.events.${_eventTitle(trigger)}`
        }).join("\n")
    }

    _eventPackageNameByTitle(eventTitle) {
        var event = config.slices.flatMap(slice => slice.events ?? []).find(event => event.title === eventTitle)
        return this._packageNameForContext(this._contextPackageForElement(event))
    }

    _renderStatelessProcessorTriggers(readModel, triggers, events, command) {
        return triggers.map((event) => {
            var commandComment = command ? `/*commandGateway.send<${_commandTitle(command.title)}>(
                    ${_commandTitle(command.title)}(
                      ${variableAssignments(command.fields, "it", readModel, "\n", "=")})
                )*/` : "/* TODO dispatch command */"

            return readModel ? `
                @EventHandler
                fun on(event: ${_eventTitle(event)}) {
                     queryGateway.query(
            ${_readmodelTitle(readModel.title)}Query(${!readModel?.listElement ? "event.aggregateId" : ""}),
            ${_readmodelTitle(readModel.title)}::class.java
        ).thenAccept {
                ${commandComment}
        }
                }` : `@EventHandler
            fun on(event: ${_eventTitle(event)}) {
                    ${command ? `/*commandGateway.send<${_commandTitle(command.title)}>(
                        ${_commandTitle(command.title)}(
                    )*/` : "/* TODO dispatch command */"}
                }
            }`
        }).join("\n")
    }

    _findSlice(sliceName) {
        return config.slices.find((item) => item.title === sliceName)
    }

};


class ConstructorGenerator {

//(: {name, type, example, mapping}
    static generateConstructorVariables(fields, overrides) {
        return `${fields?.map((field) => (overrides?.includes(field.name) ? "override " : "") + "var " + field.name + ":" + typeMapping(field.type, field.cardinality, field.optional)).filter(it => it).join(",\n\t") ?? ""}`
    }

    static generateCommandConstructorVariables(fields, overrides) {
        return `${fields?.map((field) => (field.idAttribute ? "@TargetAggregateIdentifier " : "") + (overrides?.includes(field.name) ? "override " : "") + "var " + field.name + ":" + typeMapping(field.type, field.cardinality, field.optional)).filter(it => it).join(",\n\t") ?? ""}`
    }
}

class VariablesGenerator {

    static generateLiveReportVariables(fields, identifier) {
        return fields?.map((variable) => {
            if (variable.cardinality?.toLowerCase() === "list") {
                return `\tvar ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional, true)} = mutableListOf();`;
            } else {
                return `\t${variable.name == identifier ? "@AggregateIdentifier " : ""}var ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional)}${variable.optional ? "" : "?"} = null;`;
            }
        }).join("\n")
    }

    static generateEntityVariables(slice, fields, identifier) {
        return fields?.map((variable) => {
            if (variable.cardinality?.toLowerCase() === "list") {
                return `
                 //TODO review type mapping
                 @ElementCollection(fetch = FetchType.EAGER)
                 @CollectionTable(
                    name = "${slice}_${camelCaseToUnderscores(variable.name)}",
                    joinColumns = [JoinColumn(name = "aggregateId")]
                 )
                \tvar ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional, variable.mutable)} = mutableListOf();`;
            } else {
                return `\t${variable.idAttribute ? "@Id " : ""} @Column(name="${slugify(variable.name)}") var ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional)}${variable.optional ? "" : "?"} = null;`;
            }
        }).join("\n")
    }

    static generateVariables(fields, annotations, mutable) {
        if (!annotations) {
            annotations = []
        }
        return fields?.map((variable) => {
            if (variable.cardinality?.toLowerCase() === "list") {
                return `\tvar ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional, mutable)} = ${mutable ? "mutableListOf()" : "emptyList()"};`;
            } else {
                return `\tvar ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional)}? = null;`;
            }
        }).join("\n")
    }

    static generateInvocation(fields, source) {
        return fields?.map((variable) => {

            return source ? `${source}.${variable.name}` : `${variable.name}`;

        }).filter((it) => it !== "").join(",\n\t") ?? ""
    }

    static generateRestParamInvocation(fields) {
        return fields?.map((variable) => {
            if (variable.type?.toLowerCase() === "date") {
                return `@DateTimeFormat(pattern = "dd.MM.yyyy") @RequestParam ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional)}`;
            } else if (variable.type?.toLowerCase() === "datetime") {
                return `@DateTimeFormat(pattern = "dd.MM.yyyy HH:mm:ss") @RequestParam ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional)}`;
            } else {
                return `@RequestParam ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional)}`;
            }

        }).filter((it) => it !== "").join(",\n\t") ?? ""
    }
}

_renderReadModelSwitchCase = (readModel, events) => {
    if (!readModel.listElement) {
        return `
    events.forEach { event -> 
          when (event) {
             ${events.map(event => {
            return `
                    is ${_eventTitle(event.title)} -> {
                                ${readModelAssignments(readModel, event, "\n")}                        
                    }   
                 `
        }).join("\n")}
        }
        
    }
    `
    } else {
        return `
         events.forEach { event ->
          when (event) { 
             ${events.map(event => {
            return `
                    is ${_eventTitle(event.title)} -> {
                                this.data.add(Item(${readModelAssignments(readModel, event, ",\n")}))
                                                           
                    }   
                 `
        }).join("\n")}   
            }
        }
            
        `
    }
}

const readModelAssignments = (readModel, event, separator = "\n", fallbacks = {}) => {
    var stateChange = stateChangeForEvent(event)
    var shouldAssignState = stateChange && readModel.fields?.some(field => field.name === "state") && !event.fields?.some(field => field.name === "state")
    var fields = shouldAssignState ? readModel.fields?.filter(field => field.name !== "state") : readModel.fields
    var assignments = variableAssignments(fields, "event", event, separator, "=", {includeUnmapped: true, fallbacks})

    if (shouldAssignState) {
        var stateAssignment = `\t\t\tstate="${constantCase(stateChange.to)}"`
        assignments = assignments ? [assignments, stateAssignment].join(separator) : stateAssignment
    }

    return assignments
}

const stateChangeForEvent = (event) => {
    return config.slices
        .map(slice => slice.stateChange)
        .find(stateChange => stateChange?.eventId === event.id)
}

const constantCase = (value) => {
    return `${value}`
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/[\s-]+/g, "_")
        .replace(/_+/g, "_")
        .toUpperCase()
}

const fallbackValue = (field) => {
    if (field.optional) {
        return "null"
    }
    if (field.cardinality?.toLowerCase() === "list") {
        return "emptyList()"
    }
    const valueType = findValueType(field.type)
    if (valueType) {
        return `${valueType.name}(${fallbackValue({...field, type: resolvedBaseType(valueType)} )})`
    }

    switch (field.type?.toLowerCase()) {
        case "boolean":
            return "false"
        case "uuid":
            return "java.util.UUID.randomUUID()"
        case "date":
            return "java.time.LocalDate.now()"
        case "datetime":
            return "java.time.LocalDateTime.now()"
        case "int":
            return "0"
        case "long":
            return "0L"
        case "double":
            return "0.0"
        case "string":
        default:
            return "\"\""
    }
}


const defaultValue = (type, cardinality = "single") => {
    switch (type.toLowerCase()) {
        case "string":
            return cardinality.toLowerCase() === "list" ? "[]" : "\"\""
        case "boolean":
            return cardinality.toLowerCase() === "list" ? "[]" : "false"
    }
}

function _slicePackage(title) {
    return `${slugify(title.replaceAll("slice:", "")).replaceAll("-", "").replaceAll("_", "")}`
}

function contextPackage(context) {
    return context ? _slicePackage(context).toLowerCase() : undefined
}

function toCamelCase(prefix, variableName) {
    return (prefix + variableName).replace(/_([a-z])/g, function (match, group1) {
        return group1.toUpperCase();
    });
}

function capitalizeFirstCharacter(inputString) {
    // Check if the string is not empty
    if (inputString.length > 0) {
        // Capitalize the first character and concatenate the rest of the string
        return inputString.charAt(0).toUpperCase() + inputString.slice(1);
    } else {
        // Return an empty string if the input is empty
        return "";
    }
}

function boardlLink(boardId, componentId) {
    var link = `https://miro.com/app/board/${boardId}/?moveToWidget=${componentId}`
    return boardId && componentId ? link : undefined
}
