/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {
    selectionFor,
    uniqueReservationsForSlice,
    parseUniqueExpression,
    reservationForUniqueExpression,
    uniqueFieldLabel,
    normalizedFieldExpression,
    conceptSelectionFor,
    sliceSelectionFor,
    explicitConsistencyTags,
    selectionFromTags,
    commandFieldsWithSelection,
    fieldsWithSelection,
    eventFieldsWithTags,
    eventTagFieldsFor,
    injectEntityExpression,
    uniqueTags,
    commandIdFields,
    fallbackTags,
    selectionTargetFor,
    stateTargetFor,
    primaryConcept,
    childStateTransitions,
    childTransitionKeyField,
    tagSource,
    renderTagExpression,
    compositeKeyExpression,
    renderDerivedEventTags,
    derivedEventTagProperty,
    relatedEventsForSlice,
    outboundEvents,
    transitionForCommand,
    conceptStateEnumName,
    conceptHasState,
    transitionUsesConceptState,
    renderStateGuard,
    eventArguments,
    fallbackValue,
    nullableType,
    stateFieldType,
    stateFieldDefault,
    readModelStorageImports,
    readModelStorageField,
    readModelStorageType,
    readModelStorageFieldType,
    readModelStorageFieldDefault,
    readModelStorageExpression,
    isScalarValueTypeField,
    valueTypeForField,
    METADATA_FIELD_DEFINITIONS,
    readModelMetadataFields,
    readModelMetadataParameters,
    readModelMetadataAssignments,
    mappedType,
    kotlinFieldImports,
    kotlinEnumImports,
    isJpaEnumField,
    uniqueFields,
    uniqueBy,
    groupByMap,
    stringList,
    pascal,
    kebab,
    safeDatabaseName,
    safeIdentifier,
    httpRoute,
    constant,
    kotlinPrimitive,
    kotlinImports,
    renderScalarValueType,
    renderEnum,
    renderObjectValueType,
    renderValidation,
    literal,
    escapeKotlin,
    filterModelByDeployment
} = require('./model-helpers');
const {contextPackage} = require('../../common/util/value-types');
const {_commandTitle, _eventTitle, _readmodelTitle, _sliceTitle} = require('../../common/util/naming');

const readModelWriterMethods = {
    _writeReadModel(packageName, context, slicePackage, slice, readmodel) {
        const name = _readmodelTitle(readmodel.title);
        const imports = readModelStorageImports(readmodel.fields, this.model.rootPackage);
        const metadataFields = readModelMetadataFields(readmodel);
        const allImports = [imports].filter(Boolean).join('\n');
        const ids = readmodel.fields.filter((field) => field.idAttribute);
        const idFields = ids.length > 0 ? ids : readmodel.fields.slice(0, 1);
        const id = idFields[0];
        const compositeId = idFields.length > 1;
        const entityFields = [
            ...readmodel.fields.map((field) => {
                const annotation = idFields.some((candidate) => candidate.name === field.name) ? '    @Id\n' : '';
                const enumAnnotation = isJpaEnumField(field) ? '    @Enumerated(EnumType.STRING)\n' : '';
                return `${annotation}${enumAnnotation}    var ${field.name}: ${readModelStorageFieldType(field)} = ${readModelStorageFieldDefault(field)}`;
            }),
            ...metadataFields.map((field) => `    override var ${field.name}: ${field.type} = null`)
        ].join('\n');
        const keyName = `${name}Key`;
        const keyDeclaration = compositeId
            ? `@Embeddable\ndata class ${keyName}(\n${idFields.map((field) => `    var ${field.name}: ${readModelStorageType(field, true)} = null`).join(',\n')}\n) : java.io.Serializable\n\n`
            : '';
        const idClassAnnotation = compositeId ? `@IdClass(${keyName}::class)\n` : '';
        const resultFields = [
            ...readmodel.fields.map((field) => `    val ${field.name}: ${readModelStorageType(field, true)}`),
            ...metadataFields.map((field) => `    val ${field.name}: ${field.type}`)
        ].join(',\n');
        const queryDeclaration = readmodel.listElement || !id
            ? `class ${name}Query`
            : `data class ${name}Query(val ${id.name}: ${readModelStorageType(id, false)})`;
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${name}.kt`), `package ${packageName}

import jakarta.persistence.Embeddable
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.IdClass
${metadataFields.length > 0 ? `import ${this.model.rootPackage}.support.metadata.MetadataProjection\n` : ''}
${allImports}

${queryDeclaration}

${keyDeclaration}${idClassAnnotation}
@Entity
class ${name}Entity${metadataFields.length > 0 ? ' : MetadataProjection' : ''} {
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
    },

    _writeReadModelResource(packageName, context, slicePackage, slice, readmodel, name, idFields) {
        const entityName = `${name}Entity`;
        const repositoryName = `${name}Repository`;
        const resourceName = `${name}Resource`;
        const id = idFields[0];
        const idType = idFields.length > 1 ? `${name}Key` : readModelStorageType(id, false);
        const conceptRoute = httpRoute(slice.concepts[0] ?? slice.name);
        const readmodelRoute = httpRoute(readmodel.title);
        const imports = readModelStorageImports(idFields, this.model.rootPackage);
        const partialLookupMethods = idFields.length > 1
            ? idFields.map((field) =>
                `    fun findAllBy${pascal(field.name)}(${field.name}: ${readModelStorageType(field, false)}): List<${entityName}>`
            ).join('\n')
            : '';
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${resourceName}.kt`), `package ${packageName}

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.web.PageableDefault
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
    fun findAll(@PageableDefault(size = 20) pageable: Pageable): Page<${entityName}> =
        repository.findAll(pageable)

${idFields.length === 1 ? `
    @GetMapping("/{id}")
    fun findOne(@PathVariable id: ${idType}): ResponseEntity<${entityName}> =
        repository.findById(id)
            .map { ResponseEntity.ok(it) }
            .orElseGet { ResponseEntity.notFound().build() }
` : ''}
}
`);
    },

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
        const metadataFields = readModelMetadataFields(readmodel);
        const includeMetadata = metadataFields.length > 0;
        const metadataAssignments = readModelMetadataAssignments(metadataFields, '            ');
        const metadataParameters = includeMetadata
            ? `,\n${readModelMetadataParameters(metadataFields, '        ')}`
            : '';
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
                    ? `import ${this.model.rootPackage}.${contextPackage(ownerSlice.context)}.domain.states.${conceptStateEnumName(concept)}`
                    : undefined;
            })
            .filter(Boolean), (value) => value)
            .join('\n');
        const handlers = events.map((event) => {
            const eventFields = new Set((event.fields ?? []).map((field) => field.name));
            const directFieldNames = new Set(readmodel.fields
                .filter((field) => eventFields.has(field.name))
                .map((field) => field.name));
            const derivedAssignments = this._readModelDerivedAssignments(readmodel, event, directFieldNames);
            const assignments = [
                ...readmodel.fields
                .filter((field) => eventFields.has(field.name))
                .map((field) => `            entity.${field.name} = ${readModelStorageExpression(field, `event.${field.name}`)}`),
                ...derivedAssignments.map((assignment) => `            ${assignment}`)
            ]
                .join('\n');
            const saveAssignments = [assignments, metadataAssignments].filter(Boolean).join('\n');
            const availableIds = idFields.filter((field) => eventFields.has(field.name));

            if (availableIds.length === idFields.length) {
                const keyExpression = idFields.length > 1
                    ? `${keyName}(${idFields.map((field) => `${field.name} = ${readModelStorageExpression(field, `event.${field.name}`)}`).join(', ')})`
                    : readModelStorageExpression(idFields[0], `event.${idFields[0].name}`);
                const initializeIds = idFields
                    .map((field) => `                this.${field.name} = ${readModelStorageExpression(field, `event.${field.name}`)}`)
                    .join('\n');
                return `    @EventHandler
    fun on(
        event: ${_eventTitle(event.title)}${metadataParameters}
    ) {
        val entity = repository.findById(${keyExpression}).orElseGet {
            ${entityName}().apply {
${initializeIds}
            }
        }
${saveAssignments || '        // No read-model fields are present on this event.'}
        repository.save(entity)
    }`;
            }

            if (availableIds.length === 1 && idFields.length > 1) {
                const lookupField = availableIds[0];
                return `    @EventHandler
    fun on(
        event: ${_eventTitle(event.title)}${metadataParameters}
    ) {
        repository.findAllBy${pascal(lookupField.name)}(${readModelStorageExpression(lookupField, `event.${lookupField.name}`)}).forEach { entity ->
${saveAssignments || '            // No read-model fields are present on this event.'}
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
${includeMetadata ? 'import org.axonframework.messaging.core.annotation.MetadataValue\n' : ''}import org.springframework.stereotype.Component
${includeMetadata ? `import ${this.model.rootPackage}.support.metadata.MetadataKeys\nimport ${this.model.rootPackage}.support.metadata.ProjectionMetadata\n` : ''}${eventImports}
${stateImports}

@Component
class ${name}Projector(private val repository: ${repositoryName}) {
${handlers}
}
`);
    },

    _readModelDerivedAssignments(readmodel, event, directFieldNames = new Set()) {
        const assignments = [];
        const eventFields = event.fields ?? [];
        for (const field of readmodel.fields ?? []) {
            const lookup = field.source?.lookup;
            if (field.source?.kind !== 'derived' || !lookup) {
                continue;
            }
            const targetField = lastPathSegment(lookup.targetField) ?? field.name;
            if (targetField !== field.name || directFieldNames.has(field.name)) {
                continue;
            }
            if (!matchesLookupEvent(lookup, event, field.source.from)) {
                continue;
            }
            const sourceField = lastPathSegment(lookup.sourceField)
                ?? sourceFieldFromMappings(field.source.from, event)
                ?? field.name;
            const eventField = eventFields.find((candidate) => candidate.name === sourceField);
            if (!eventField) {
                continue;
            }

            const expression = readModelStorageExpression(field, `event.${eventField.name}`);
            if (String(lookup.missingValuePolicy ?? '').toLowerCase() === 'keep' && (eventField.optional || field.optional)) {
                assignments.push(`event.${eventField.name}?.let { entity.${field.name} = ${readModelStorageExpression(field, 'it')} }`);
            } else {
                assignments.push(`entity.${field.name} = ${expression}`);
            }
        }

        const ownerSlice = this.model.slices.find((slice) =>
            (slice.events ?? []).some((candidate) => candidate.id === event.id)
        );
        const stateChange = ownerSlice?.stateChange?.eventId === event.id ? ownerSlice.stateChange : undefined;
        const concept = ownerSlice?.concepts?.[0];
        if (!stateChange || !concept) {
            return assignments;
        }
        const field = readmodel.fields.find((candidate) => candidate.type === `${concept}.State`);
        if (field
            && !directFieldNames.has(field.name)
            && !eventFields.some((candidate) => candidate.name === field.name)
            && conceptHasState(this.model, ownerSlice.context, concept, stateChange.to)) {
            assignments.push(`entity.${field.name} = ${conceptStateEnumName(concept)}.${constant(stateChange.to)}`);
        }

        return assignments;
    },

    _eventPackage(event, fallbackSlice) {
        const slice = this.model.slices.find((candidate) => candidate.title === event.slice || candidate.name === event.slice) ?? fallbackSlice;
        return `${this.model.rootPackage}.${contextPackage(slice.context)}.events`;
    }
};

function matchesLookupEvent(lookup, event, mappings = []) {
    const sourceEvent = lookup.sourceEvent ?? mappings
        .map((source) => String(source).split('.')[0])
        .find(Boolean);
    if (!sourceEvent) {
        return true;
    }
    const candidates = [
        event.name,
        event.title,
        _eventTitle(event.title),
        pascal(event.name),
        pascal(event.title)
    ].filter(Boolean).map((value) => String(value).toLowerCase());
    return candidates.includes(String(sourceEvent).toLowerCase());
}

function sourceFieldFromMappings(mappings = [], event) {
    const eventNames = new Set([
        event.name,
        event.title,
        _eventTitle(event.title),
        pascal(event.name),
        pascal(event.title)
    ].filter(Boolean).map((value) => String(value).toLowerCase()));
    return mappings
        .map((source) => String(source).split('.'))
        .find((parts) => parts.length > 1 && eventNames.has(String(parts[0]).toLowerCase()))
        ?.at(-1);
}

function lastPathSegment(value) {
    if (!value) {
        return undefined;
    }
    return String(value).split('.').filter(Boolean).at(-1);
}

module.exports = {readModelWriterMethods};
