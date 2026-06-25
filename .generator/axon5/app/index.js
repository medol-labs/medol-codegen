/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const Generator = require('yeoman-generator').default;
const path = require('path');
const slugify = require('slugify');
const {loadCodegenModel} = require('../../common/core/codegen-model-loader');
const {configureValueTypes, typeMapping, typeImports} = require('../../common/util/generator');
const {contextPackage, resolvedBaseType, resolvedConstraints} = require('../../common/util/value-types');
const {_commandTitle, _eventTitle, _readmodelTitle, _sliceTitle} = require('../../common/util/naming');

module.exports = class extends Generator {
    constructor(args, opts) {
        super(args, opts);
        this.opts = opts ?? {};
        this.model = loadCodegenModel(this.env.cwd);
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
        if (!this.opts.allSlices && this.opts.generatorType === 'slices') {
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
        const type = this.answers.generatorType;
        if (type === 'Skeleton' || type === 'all') {
            this._writeSkeleton();
        }
        if (type === 'slices' || type === 'all') {
            const selected = this.answers.sliceNames ?? this.model.slices.map((slice) => slice.title);
            this.model.slices.filter((slice) => selected.includes(slice.title)).forEach((slice) => this._writeSlice(slice));
        }
    }

    _writeSkeleton() {
        const appName = slugify(this.model.domain, {lower: true, strict: true}) || 'medol-application';
        const applicationClass = `${pascal(this.model.domain)}Application`;
        this.fs.copyTpl(this.templatePath('pom.xml.tpl'), this.destinationPath('pom.xml'), {
            rootPackage: this.model.rootPackage,
            appName
        });
        this.fs.copyTpl(this.templatePath('Application.kt.tpl'), this._kotlinPath('Application.kt'), {
            rootPackage: this.model.rootPackage,
            applicationClass
        });
        this.fs.copyTpl(this.templatePath('README.md.tpl'), this.destinationPath('README.md'), {
            appName,
            domain: this.model.domain,
            rootPackage: this.model.rootPackage
        });
        this.fs.copyTpl(this.templatePath('ApplicationTest.kt.tpl'), this._testKotlinPath('ApplicationTest.kt'), {
            rootPackage: this.model.rootPackage,
            applicationClass
        });
        this.fs.copyTpl(this.templatePath('OpenApiConfig.kt.tpl'), this._kotlinPath('support/OpenApiConfig.kt'), {
            rootPackage: this.model.rootPackage,
            domain: this.model.domain
        });
        this.fs.copyTpl(this.templatePath('ApiExceptionHandler.kt.tpl'), this._kotlinPath('support/ApiExceptionHandler.kt'), {
            rootPackage: this.model.rootPackage
        });
        this.fs.copy(this.templatePath('application.yml'), this.destinationPath('src/main/resources/application.yml'));
        this.fs.copy(this.templatePath('docker-compose.yml'), this.destinationPath('docker-compose.yml'));
        this.fs.copy(this.templatePath('V1__baseline.sql'), this.destinationPath('src/main/resources/db/migration/V1__baseline.sql'));
        this.fs.copy(this.templatePath('gitignore'), this.destinationPath('.gitignore'));
        this._copyMavenWrapper();
        this._writeValueTypes();
        this._writeConceptStates();
        this._writeConceptCatalog();
    }

    _copyMavenWrapper() {
        const axonTemplates = path.resolve(__dirname, '../../axon/app/templates');
        this.fs.copy(path.join(axonTemplates, '.mvn'), this.destinationPath('.mvn'));
        this.fs.copy(path.join(axonTemplates, 'root/mvnw'), this.destinationPath('mvnw'));
        this.fs.copy(path.join(axonTemplates, 'root/mvnw.cmd'), this.destinationPath('mvnw.cmd'));
    }

    _writeValueTypes() {
        for (const valueType of this.model.valueTypes) {
            const packageName = `${this.model.rootPackage}.${contextPackage(valueType.context)}.domain.types`;
            const baseType = kotlinPrimitive(resolvedBaseType(valueType));
            const lines = [
                `package ${packageName}`,
                '',
                kotlinImports(baseType),
                '',
                valueType.kind === 'enum'
                    ? renderEnum(valueType)
                    : valueType.kind === 'object'
                        ? renderObjectValueType(valueType)
                        : renderScalarValueType(valueType, baseType)
            ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
            this.fs.write(this._kotlinPath(`${contextPackage(valueType.context)}/domain/types/${valueType.name}.kt`), `${lines}\n`);
        }
    }

    _writeConceptStates() {
        for (const concept of this.model.concepts.filter((candidate) => candidate.states?.length)) {
            const packageName = `${this.model.rootPackage}.${contextPackage(concept.context)}.domain.states`;
            const typeName = `${concept.name}State`;
            const values = concept.states.map((state) => `    ${constant(state)}`).join(',\n');
            this.fs.write(
                this._kotlinPath(`${contextPackage(concept.context)}/domain/states/${typeName}.kt`),
                `package ${packageName}\n\nenum class ${typeName} {\n${values}\n}\n`
            );
        }
    }

    _writeConceptCatalog() {
        const byContext = groupByMap(this.model.concepts, (concept) => concept.context);
        for (const [context, concepts] of byContext.entries()) {
            const packageName = `${this.model.rootPackage}.${contextPackage(context)}.domain`;
            const body = concepts.map((concept) => [
                `    data object ${pascal(concept.name)} {`,
                `        const val NAME = "${escapeKotlin(concept.name)}"`,
                `        val slices = ${stringList(concept.slices.map((slice) => slice.name))}`,
                `        val states = ${stringList(concept.states ?? [])}`,
                '    }'
            ].join('\n')).join('\n\n');
            this.fs.write(
                this._kotlinPath(`${contextPackage(context)}/domain/Concepts.kt`),
                `package ${packageName}\n\nobject Concepts {\n${body}\n}\n`
            );
        }
    }

    _writeSlice(slice) {
        const context = contextPackage(slice.context);
        const slicePackage = _sliceTitle(slice.title);
        const packageName = `${this.model.rootPackage}.${context}.${slicePackage}`;
        if (slice.commands.length > 0) {
            const selection = selectionFor(slice);
            const relatedEvents = relatedEventsForSlice(this.model, slice);
            this._writeSelection(packageName, context, slicePackage, slice, selection);
            slice.commands.forEach((command) => this._writeCommand(packageName, context, slicePackage, command, selection));
            relatedEvents.forEach((event) => this._writeEvent(event, slice, selection));
            this._writeState(packageName, context, slicePackage, slice, selection, relatedEvents);
            this._writeCommandHandlers(packageName, context, slicePackage, slice, selection, relatedEvents);
            this._writeCommandResource(packageName, context, slicePackage, slice);
        }
        slice.readmodels.forEach((readmodel) => this._writeReadModel(packageName, context, slicePackage, slice, readmodel));
    }

    _writeSelection(packageName, context, slicePackage, slice, selection) {
        const imports = typeImports(selection.fields);
        const properties = selection.fields.map((field) => `    val ${field.alias}: ${field.selectionType}`).join(',\n');
        const tagConstants = selection.tags.map((tag) => `    const val ${constant(tag.name)} = "${escapeKotlin(tag.name)}"`).join('\n');
        const conceptNames = slice.concepts.map((concept) => `"${escapeKotlin(concept)}"`).join(', ');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${selection.name}.kt`), `package ${packageName}

${imports}

data class ${selection.name}(
${properties}
)

object ${pascal(slice.name)}Tags {
${tagConstants}
}

object ${pascal(slice.name)}Metadata {
    val concepts = ${stringList(slice.concepts)}
}
`);
    }

    _writeCommand(packageName, context, slicePackage, command, selection) {
        const commandName = _commandTitle(command.title);
        const imports = typeImports(command.fields);
        const properties = command.fields.map((field) => {
            const defaultValue = field.generated ? ` = ${fallbackValue(field)}` : '';
            return `    val ${field.name}: ${mappedType(field, field.optional)}${defaultValue}`;
        }).join(',\n');
        const selectionArgs = selection.fields.map((field) => `${field.alias} = ${field.commandExpression}`).join(', ');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${commandName}.kt`), `package ${packageName}

import org.axonframework.messaging.commandhandling.annotation.Command
import org.axonframework.modelling.annotation.TargetEntityId
${imports}

@Command
data class ${commandName}(
${properties}
) {
    @TargetEntityId
    val selection: ${selection.name} = ${selection.name}(${selectionArgs})
}
`);
    }

    _writeEvent(event, ownerSlice, selection) {
        const eventSlice = this.model.slices.find((slice) => slice.title === event.slice || slice.name === event.slice) ?? ownerSlice;
        const context = contextPackage(eventSlice.context);
        const packageName = `${this.model.rootPackage}.${context}.events`;
        const eventName = _eventTitle(event.title);
        const imports = typeImports(event.fields);
        const annotated = new Set();
        const properties = event.fields.map((field) => {
            const matchingTags = selection.fields.filter((selectionField) => !selectionField.derived && selectionField.source === field.name);
            const annotations = matchingTags.map((selectionField) => {
                annotated.add(selectionField.tag.name);
                return `    @EventTag(key = "${escapeKotlin(selectionField.tag.name)}")`;
            }).join('\n');
            return `${annotations ? `${annotations}\n` : ''}    val ${field.name}: ${mappedType(field, field.optional)}`;
        }).join(',\n');
        const resolvedDerived = new Set(selection.fields
            .filter((field) => field.derived && event.fields.some((eventField) => eventField.name === field.source))
            .map((field) => field.tag.name));
        const unresolved = selection.tags.filter((tag) => !annotated.has(tag.name) && !resolvedDerived.has(tag.name));
        const note = unresolved.length
            ? `\n/* TODO: provide values for selection tags: ${unresolved.map((tag) => tag.expression ? `${tag.name} = ${tag.expression}` : tag.name).join(', ')} */\n`
            : '\n';
        this.fs.write(this._kotlinPath(`${context}/events/${eventName}.kt`), `package ${packageName}

import org.axonframework.eventsourcing.annotation.EventTag
import org.axonframework.messaging.eventhandling.annotation.Event
${imports}
${note}
@Event
data class ${eventName}(
${properties}
)${renderDerivedEventTags(selection, event)}
`);
    }

    _writeState(packageName, context, slicePackage, slice, selection, events) {
        const stateName = `${pascal(slice.name)}State`;
        const fields = uniqueFields(events.flatMap((event) => event.fields));
        const imports = typeImports(fields);
        const stateFields = fields.map((field) => `    private var ${field.name}: ${stateFieldType(field)} = ${stateFieldDefault(field)}`).join('\n');
        const sourcingHandlers = events.map((event) => {
            const assignments = event.fields.map((field) => `        ${field.name} = event.${field.name}`).join('\n');
            return `    @EventSourcingHandler\n    fun evolve(event: ${_eventTitle(event.title)}): ${stateName} = apply {\n${assignments}\n    }`;
        }).join('\n\n');
        const eventImports = events.map((event) => `import ${this._eventPackage(event, slice)}.${_eventTitle(event.title)}`).join('\n');
        const criteria = selection.fields
            .map((field) => `Tag.of("${escapeKotlin(field.tag.name)}", selection.${field.alias}.toString())`)
            .join(',\n                ');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${stateName}.kt`), `package ${packageName}

import org.axonframework.eventsourcing.annotation.EventCriteriaBuilder
import org.axonframework.eventsourcing.annotation.EventSourcingHandler
import org.axonframework.eventsourcing.annotation.reflection.EntityCreator
import org.axonframework.extension.spring.stereotype.EventSourced
import org.axonframework.messaging.eventstreaming.EventCriteria
import org.axonframework.messaging.eventstreaming.Tag
${eventImports}
${imports}

@EventSourced(idType = ${selection.name}::class)
class ${stateName} @EntityCreator constructor() {
    companion object {
        @JvmStatic
        @EventCriteriaBuilder
        fun resolveCriteria(selection: ${selection.name}): EventCriteria = EventCriteria.havingTags(
                ${criteria}
        )
    }

${stateFields}

${sourcingHandlers}
}
`);
    }

    _writeCommandHandlers(packageName, context, slicePackage, slice, selection, events) {
        const stateName = `${pascal(slice.name)}State`;
        const handlers = slice.commands.map((command) => {
            const commandName = _commandTitle(command.title);
            const outputs = outboundEvents(command, events);
            const appendStatement = outputs.length > 0
                ? `eventAppender.append(\n${outputs.map((event) => `            ${_eventTitle(event.title)}(${eventArguments(event, command)})`).join(',\n')}\n        )`
                : '// TODO: append the event produced by this command.';
            if (command.startsLifecycle) {
                return `    @CommandHandler\n    fun handle(command: ${commandName}, eventAppender: EventAppender) {\n        ${appendStatement}\n    }`;
            }
            return `    @CommandHandler\n    fun handle(command: ${commandName}, @InjectEntity state: ${stateName}, eventAppender: EventAppender) {\n        // TODO: validate domain rules against state before appending events.\n        ${appendStatement}\n    }`;
        }).join('\n\n');
        const commandImports = slice.commands.map((command) => `import ${packageName}.${_commandTitle(command.title)}`).join('\n');
        const eventImports = events.map((event) => `import ${this._eventPackage(event, slice)}.${_eventTitle(event.title)}`).join('\n');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${pascal(slice.name)}CommandHandler.kt`), `package ${packageName}

import org.axonframework.messaging.commandhandling.annotation.CommandHandler
import org.axonframework.messaging.eventhandling.gateway.EventAppender
import org.axonframework.modelling.annotation.InjectEntity
import org.springframework.stereotype.Component
${commandImports}
${eventImports}

@Component
class ${pascal(slice.name)}CommandHandler {
${handlers}
}
`);
    }

    _writeCommandResource(packageName, context, slicePackage, slice) {
        const resourceName = `${pascal(slice.name)}Resource`;
        const conceptRoute = httpRoute(slice.concepts[0] ?? slice.name);
        const methods = slice.commands.map((command) => {
            const commandName = _commandTitle(command.title);
            return `    @PostMapping("/${httpRoute(command.title)}")
    fun ${safeIdentifier(command.name)}(@Valid @RequestBody command: ${commandName}): CompletableFuture<${commandName}> =
        commandGateway.send(command).resultMessage.thenApply { command }`;
        }).join('\n\n');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${resourceName}.kt`), `package ${packageName}

import jakarta.validation.Valid
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.springframework.web.bind.annotation.CrossOrigin
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.concurrent.CompletableFuture

@CrossOrigin
@RestController
@RequestMapping("/${conceptRoute}")
class ${resourceName}(private val commandGateway: CommandGateway) {
${methods}
}
`);
    }

    _writeReadModel(packageName, context, slicePackage, slice, readmodel) {
        const name = _readmodelTitle(readmodel.title);
        const imports = typeImports(readmodel.fields);
        const ids = readmodel.fields.filter((field) => field.idAttribute);
        const idFields = ids.length > 0 ? ids : readmodel.fields.slice(0, 1);
        const id = idFields[0];
        const compositeId = idFields.length > 1;
        const entityFields = readmodel.fields.map((field) => {
            const annotation = idFields.some((candidate) => candidate.name === field.name) ? '    @Id\n' : '';
            const enumAnnotation = field.type?.endsWith('.State') ? '    @Enumerated(EnumType.STRING)\n' : '';
            return `${annotation}${enumAnnotation}    var ${field.name}: ${stateFieldType(field)} = ${stateFieldDefault(field)}`;
        }).join('\n');
        const keyName = `${name}Key`;
        const keyDeclaration = compositeId
            ? `@Embeddable\ndata class ${keyName}(\n${idFields.map((field) => `    var ${field.name}: ${mappedType(field, true)} = null`).join(',\n')}\n) : java.io.Serializable\n\n`
            : '';
        const idClassAnnotation = compositeId ? `@IdClass(${keyName}::class)\n` : '';
        const resultFields = readmodel.fields.map((field) => `    val ${field.name}: ${mappedType(field, true)}`).join(',\n');
        const queryDeclaration = readmodel.listElement || !id
            ? `class ${name}Query`
            : `data class ${name}Query(val ${id.name}: ${mappedType(id, false)})`;
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${name}.kt`), `package ${packageName}

import jakarta.persistence.Embeddable
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.IdClass
${imports}

${queryDeclaration}

${keyDeclaration}${idClassAnnotation}
@Entity
class ${name}Entity {
${entityFields}
}

data class ${name}(
${resultFields}
)
`);
        if (id) {
            this._writeReadModelResource(packageName, context, slicePackage, slice, readmodel, name, idFields);
            this._writeReadModelProjector(packageName, context, slicePackage, slice, readmodel, name, idFields);
        }
    }

    _writeReadModelResource(packageName, context, slicePackage, slice, readmodel, name, idFields) {
        const entityName = `${name}Entity`;
        const repositoryName = `${name}Repository`;
        const resourceName = `${name}Resource`;
        const id = idFields[0];
        const idType = idFields.length > 1 ? `${name}Key` : mappedType(id, false);
        const conceptRoute = httpRoute(slice.concepts[0] ?? slice.name);
        const readmodelRoute = httpRoute(readmodel.title);
        const imports = typeImports(idFields);
        const partialLookupMethods = idFields.length > 1
            ? idFields.map((field) =>
                `    fun findAllBy${pascal(field.name)}(${field.name}: ${mappedType(field, false)}): List<${entityName}>`
            ).join('\n')
            : '';
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${resourceName}.kt`), `package ${packageName}

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.CrossOrigin
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
${imports}

interface ${repositoryName} : JpaRepository<${entityName}, ${idType}> {
${partialLookupMethods}
}

@CrossOrigin
@RestController
@RequestMapping("/${conceptRoute}/${readmodelRoute}")
class ${resourceName}(private val repository: ${repositoryName}) {
    @GetMapping
    fun findAll(): List<${entityName}> = repository.findAll()

${idFields.length === 1 ? `
    @GetMapping("/{id}")
    fun findOne(@PathVariable id: ${idType}): ResponseEntity<${entityName}> =
        repository.findById(id)
            .map { ResponseEntity.ok(it) }
            .orElseGet { ResponseEntity.notFound().build() }
` : ''}
}
`);
    }

    _writeReadModelProjector(packageName, context, slicePackage, slice, readmodel, name, idFields) {
        const inboundEventIds = new Set((readmodel.dependencies ?? [])
            .filter((dependency) => dependency.direction === 'INBOUND' && dependency.elementType === 'EVENT')
            .map((dependency) => dependency.id));
        const events = this.model.slices
            .flatMap((candidate) => candidate.events ?? [])
            .filter((event) => inboundEventIds.has(event.id));
        if (events.length === 0) {
            return;
        }

        const entityName = `${name}Entity`;
        const repositoryName = `${name}Repository`;
        const keyName = `${name}Key`;
        const eventImports = events
            .map((event) => `import ${this._eventPackage(event, slice)}.${_eventTitle(event.title)}`)
            .join('\n');
        const stateImports = uniqueBy(events
            .map((event) => {
                const ownerSlice = this.model.slices.find((candidate) =>
                    (candidate.events ?? []).some((item) => item.id === event.id)
                );
                const concept = ownerSlice?.concepts?.[0];
                return ownerSlice?.stateChange?.eventId === event.id
                    && readmodel.fields.some((field) => field.type === `${concept}.State`)
                    ? `import ${this.model.rootPackage}.${contextPackage(ownerSlice.context)}.domain.states.${concept}State`
                    : undefined;
            })
            .filter(Boolean), (value) => value)
            .join('\n');
        const handlers = events.map((event) => {
            const eventFields = new Set((event.fields ?? []).map((field) => field.name));
            const stateAssignment = this._readModelStateAssignment(readmodel, event);
            const assignments = [
                ...readmodel.fields
                .filter((field) => eventFields.has(field.name))
                .map((field) => `            entity.${field.name} = event.${field.name}`),
                ...(stateAssignment ? [`            ${stateAssignment}`] : [])
            ]
                .join('\n');
            const availableIds = idFields.filter((field) => eventFields.has(field.name));

            if (availableIds.length === idFields.length) {
                const keyExpression = idFields.length > 1
                    ? `${keyName}(${idFields.map((field) => `${field.name} = event.${field.name}`).join(', ')})`
                    : `event.${idFields[0].name}`;
                const initializeIds = idFields
                    .map((field) => `                this.${field.name} = event.${field.name}`)
                    .join('\n');
                return `    @EventHandler
    fun on(event: ${_eventTitle(event.title)}) {
        val entity = repository.findById(${keyExpression}).orElseGet {
            ${entityName}().apply {
${initializeIds}
            }
        }
${assignments || '        // No read-model fields are present on this event.'}
        repository.save(entity)
    }`;
            }

            if (availableIds.length === 1 && idFields.length > 1) {
                const lookupField = availableIds[0];
                return `    @EventHandler
    fun on(event: ${_eventTitle(event.title)}) {
        repository.findAllBy${pascal(lookupField.name)}(event.${lookupField.name}).forEach { entity ->
${assignments || '            // No read-model fields are present on this event.'}
            repository.save(entity)
        }
    }`;
            }

            return `    @EventHandler
    fun on(event: ${_eventTitle(event.title)}) {
        // Skipped: ${_eventTitle(event.title)} does not provide enough key fields to locate ${entityName}.
    }`;
        }).join('\n\n');

        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${name}Projector.kt`), `package ${packageName}

import org.axonframework.messaging.eventhandling.annotation.EventHandler
import org.springframework.stereotype.Component
${eventImports}
${stateImports}

@Component
class ${name}Projector(private val repository: ${repositoryName}) {
${handlers}
}
`);
    }

    _readModelStateAssignment(readmodel, event) {
        const ownerSlice = this.model.slices.find((slice) =>
            (slice.events ?? []).some((candidate) => candidate.id === event.id)
        );
        const stateChange = ownerSlice?.stateChange?.eventId === event.id ? ownerSlice.stateChange : undefined;
        const concept = ownerSlice?.concepts?.[0];
        if (!stateChange || !concept) {
            return undefined;
        }
        const field = readmodel.fields.find((candidate) => candidate.type === `${concept}.State`);
        if (!field || event.fields.some((candidate) => candidate.name === field.name)) {
            return undefined;
        }
        return `entity.${field.name} = ${concept}State.${constant(stateChange.to)}`;
    }

    _eventPackage(event, fallbackSlice) {
        const slice = this.model.slices.find((candidate) => candidate.title === event.slice || candidate.name === event.slice) ?? fallbackSlice;
        return `${this.model.rootPackage}.${contextPackage(slice.context)}.events`;
    }

    _kotlinPath(relative) {
        return this.destinationPath(`src/main/kotlin/${this.model.rootPackage.split('.').join('/')}/${relative}`);
    }

    _testKotlinPath(relative) {
        return this.destinationPath(`src/test/kotlin/${this.model.rootPackage.split('.').join('/')}/${relative}`);
    }
};

function selectionFor(slice) {
    const firstCommand = slice.commands[0];
    const commandFields = firstCommand?.fields ?? [];
    const tags = slice.tags.length > 0 ? slice.tags : fallbackTags(slice, commandFields);
    const fields = tags.map((tag, index) => {
        const source = tagSource(tag, commandFields) ?? commandFields.find((field) => field.idAttribute)?.name ?? commandFields[0]?.name;
        const sourceField = commandFields.find((field) => field.name === source) ?? {name: source ?? `selection${index + 1}`, type: 'String', cardinality: 'Single'};
        const derived = Boolean(tag.expression) && String(tag.expression).trim() !== sourceField.name;
        const expression = derived ? renderTagExpression(tag.expression, sourceField, commandFields) : undefined;
        return {
            ...sourceField,
            tag,
            source: sourceField.name,
            alias: safeIdentifier(tag.name),
            derived,
            selectionType: derived ? 'String' : mappedType(sourceField, false),
            commandExpression: expression ?? sourceField.name,
            eventExpression: expression ?? sourceField.name
        };
    });
    return {name: `${pascal(slice.name)}Selection`, tags, fields};
}

function fallbackTags(slice, fields) {
    const idField = fields.find((field) => field.idAttribute) ?? fields[0];
    const concept = slice.concepts[0] ?? slice.aggregate?.name ?? slice.name;
    return [{name: concept, expression: idField?.name}];
}

function tagSource(tag, fields) {
    if (fields.some((field) => field.name === tag.name)) return tag.name;
    const identifiers = String(tag.expression ?? '').match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    return identifiers.find((identifier) => fields.some((field) => field.name === identifier));
}

function renderTagExpression(expression, sourceField, fields) {
    if (!expression) return undefined;
    const normalized = String(expression).trim();
    const normalizeMatch = normalized.match(/^normalize\(([A-Za-z_][A-Za-z0-9_]*)\)$/);
    if (normalizeMatch) {
        const field = fields.find((candidate) => candidate.name === normalizeMatch[1]) ?? sourceField;
        const primitive = ['string', 'boolean', 'int', 'integer', 'long', 'float', 'double', 'number', 'decimal', 'bigdecimal', 'uuid', 'date', 'datetime']
            .includes(String(field.type).toLowerCase());
        const value = primitive ? field.name : `${field.name}.value`;
        return `${value}.toString().trim().lowercase()`;
    }
    return `${sourceField.name}.toString() /* TODO Medol tag expression: ${escapeKotlin(normalized)} */`;
}

function renderDerivedEventTags(selection, event) {
    const derived = selection.fields.filter((field) => field.derived && event.fields.some((eventField) => eventField.name === field.source));
    if (derived.length === 0) return '';
    const properties = derived.map((field) => [
        `    @EventTag(key = "${escapeKotlin(field.tag.name)}")`,
        `    val ${derivedEventTagProperty(field, event)}: String = ${field.eventExpression}`
    ].join('\n')).join('\n\n');
    return ` {\n${properties}\n}`;
}

function derivedEventTagProperty(field, event) {
    const fieldNames = new Set(event.fields.map((eventField) => eventField.name));
    let candidate = `${field.alias}EventTag`;
    let suffix = 2;
    while (fieldNames.has(candidate)) {
        candidate = `${field.alias}EventTag${suffix}`;
        suffix += 1;
    }
    return candidate;
}

function relatedEventsForSlice(model, slice) {
    const ids = new Set(slice.commands.flatMap((command) => command.dependencies ?? [])
        .filter((dependency) => dependency.direction === 'OUTBOUND' && dependency.elementType === 'EVENT')
        .map((dependency) => dependency.id));
    const allEvents = model.slices.flatMap((candidate) => candidate.events);
    const related = allEvents.filter((event) => ids.has(event.id));
    return uniqueBy([...(slice.events ?? []), ...related], (event) => event.id ?? event.name);
}

function outboundEvents(command, events) {
    const ids = new Set((command.dependencies ?? [])
        .filter((dependency) => dependency.direction === 'OUTBOUND' && dependency.elementType === 'EVENT')
        .map((dependency) => dependency.id));
    const selected = events.filter((event) => ids.has(event.id));
    return selected.length > 0 ? selected : events.slice(0, 1);
}

function eventArguments(event, command) {
    return event.fields.map((field) => {
        if (command.fields.some((candidate) => candidate.name === field.name)) return `${field.name} = command.${field.name}`;
        const source = field.source?.from?.find((name) => command.fields.some((candidate) => candidate.name === name));
        if (source) return `${field.name} = command.${source}`;
        return `${field.name} = ${fallbackValue(field)} /* TODO: ${field.source?.rule ?? 'derive value'} */`;
    }).join(', ');
}

function fallbackValue(field) {
    if (field.optional) return 'null';
    if (field.cardinality === 'Multiple') return 'emptyList()';
    switch (String(field.type).toLowerCase()) {
        case 'boolean': return 'false';
        case 'int': return '0';
        case 'long': return '0L';
        case 'float': return '0f';
        case 'double':
        case 'number': return '0.0';
        case 'decimal':
        case 'bigdecimal': return 'java.math.BigDecimal.ZERO';
        case 'uuid': return 'java.util.UUID.randomUUID()';
        case 'date': return 'java.time.LocalDate.now()';
        case 'datetime': return 'java.time.LocalDateTime.now()';
        default: return '""';
    }
}

function nullableType(field) {
    return mappedType(field, true).replace(/\?\?$/, '?');
}

function stateFieldType(field) {
    return field.cardinality === 'Multiple' ? mappedType(field, false) : nullableType(field);
}

function stateFieldDefault(field) {
    return field.cardinality === 'Multiple' ? 'emptyList()' : 'null';
}

function mappedType(field, optional = field.optional) {
    const cardinality = field.cardinality === 'Multiple' ? 'List' : field.cardinality;
    return typeMapping(field.type, cardinality, optional, field.mutable);
}

function uniqueFields(fields) {
    return uniqueBy(fields, (field) => field.name);
}

function uniqueBy(items, key) {
    const seen = new Set();
    return items.filter((item) => {
        const value = key(item);
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
    });
}

function groupByMap(items, key) {
    const groups = new Map();
    for (const item of items) {
        const value = key(item);
        groups.set(value, [...(groups.get(value) ?? []), item]);
    }
    return groups;
}

function stringList(items) {
    return items.length > 0
        ? `listOf(${items.map((item) => `"${escapeKotlin(item)}"`).join(', ')})`
        : 'emptyList<String>()';
}

function pascal(value) {
    return String(value ?? '').split(/[^A-Za-z0-9]+|(?=[A-Z])/).filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('') || 'Medol';
}

function safeIdentifier(value) {
    const result = String(value ?? '').replace(/[^A-Za-z0-9_]/g, '');
    return result && /^[A-Za-z_]/.test(result) ? result : `tag${pascal(result)}`;
}

function httpRoute(value) {
    return String(value ?? '').replace(/[\s_-]+/g, '').toLowerCase();
}

function constant(value) {
    return String(value ?? '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
}

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
    return ({
        BigDecimal: 'import java.math.BigDecimal',
        LocalDate: 'import java.time.LocalDate',
        LocalDateTime: 'import java.time.LocalDateTime',
        UUID: 'import java.util.UUID'
    })[baseType] ?? '';
}

function renderScalarValueType(valueType, baseType) {
    const validations = resolvedConstraints(valueType).map((constraint) => renderValidation(valueType, constraint, baseType)).filter(Boolean);
    return `@JvmInline\nvalue class ${valueType.name}(val value: ${baseType}) {${validations.length ? `\n    init {\n${validations.map((line) => `        ${line}`).join('\n')}\n    }` : ''}\n}`;
}

function renderEnum(valueType) {
    return `enum class ${valueType.name} {\n${(valueType.values ?? []).map((value) => `    ${constant(value)}`).join(',\n')}\n}`;
}

function renderObjectValueType(valueType) {
    const imports = typeImports(valueType.fields ?? []);
    const fields = (valueType.fields ?? []).map((field) => `    val ${field.name}: ${mappedType(field, field.optional)}`).join(',\n');
    return `${imports ? `${imports}\n\n` : ''}data class ${valueType.name}(\n${fields}\n)`;
}

function renderValidation(valueType, constraint, baseType) {
    const label = `${valueType.name} violates ${constraint.kind} constraint`;
    if (constraint.kind === 'format' && constraint.format === 'email') return `require(Regex("^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$").matches(value.toString())) { "${label}" }`;
    if (constraint.kind === 'length') return `require(value.toString().length in ${constraint.min}..${constraint.max}) { "${label}" }`;
    if (constraint.kind === 'range') return `require(value >= ${literal(constraint.min, baseType)} && value <= ${literal(constraint.max, baseType)}) { "${label}" }`;
    if (constraint.kind === 'matches') return `require(Regex("${escapeKotlin(constraint.pattern)}").matches(value.toString())) { "${label}" }`;
    if (constraint.kind === 'oneOf') return `require(value in setOf(${(constraint.values ?? []).map((value) => literal(value, baseType)).join(', ')})) { "${label}" }`;
    return '';
}

function literal(value, type) {
    if (type === 'String') return `"${escapeKotlin(value)}"`;
    if (type === 'Long') return `${value}L`;
    if (type === 'Float') return `${value}f`;
    if (type === 'BigDecimal') return `BigDecimal("${value}")`;
    return String(value);
}

function escapeKotlin(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
