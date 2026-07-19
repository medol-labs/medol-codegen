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

function readModelPersistencePackage(rootPackage, context, readmodelName) {
    return `${rootPackage}.${context}.infrastructure.secondary.persistence.${_sliceTitle(readmodelName)}`;
}

function readModelPersistencePath(context, readmodelName) {
    return `${context}/infrastructure/secondary/persistence/${_sliceTitle(readmodelName)}`;
}

function readModelRepositoryMethodName(filterFields) {
    return filterFields.length > 0 ? 'findAllByFilter' : 'findAll';
}

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
            ? `data class ${keyName}(\n${idFields.map((field) => `    var ${field.name}: ${readModelStorageType(field, true)} = null`).join(',\n')}\n) : java.io.Serializable\n\n`
            : '';
        const projectionFields = [
            ...readmodel.fields.map((field) => `    var ${field.name}: ${readModelStorageFieldType(field)} = ${readModelStorageFieldDefault(field)}`),
            ...metadataFields.map((field) => `    override var ${field.name}: ${field.type} = null`)
        ].join('\n');
        const idClassAnnotation = compositeId ? `@IdClass(${keyName}::class)\n` : '';
        const resultFields = [
            ...readmodel.fields.map((field) => `    val ${field.name}: ${readModelStorageType(field, true)}`),
            ...metadataFields.map((field) => `    val ${field.name}: ${field.type}`)
        ].join(',\n');
        const resultArguments = [
            ...readmodel.fields.map((field) => `    ${field.name} = ${field.name}`),
            ...metadataFields.map((field) => `    ${field.name} = ${field.name}`)
        ].join(',\n');
        const queryDeclaration = readmodel.listElement || !id
            ? `class ${name}Query`
            : `data class ${name}Query(val ${id.name}: ${readModelStorageType(id, false)})`;
        const idType = compositeId ? keyName : readModelStorageType(id, false);
        const filterFields = readModelFilterFields(readmodel);
        const filterParameters = filterFields
            .map((field) => `${field.name}: ${readModelStorageType(field, false)}?`)
            .join(', ');
        const filterSignaturePrefix = filterFields.length > 0 ? `${filterParameters}, ` : '';
        const partialLookupMethods = compositeId
            ? idFields.map((field) =>
                `    fun findProjectionsBy${pascal(field.name)}(${field.name}: ${readModelStorageType(field, false)}): List<${name}Projection>`
            ).join('\n')
            : '';
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${name}.kt`), `package ${packageName}

import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
${metadataFields.length > 0 ? `import ${this.model.rootPackage}.shared.application.metadata.MetadataProjection\n` : ''}${allImports}

${keyDeclaration}${queryDeclaration}

class ${name}Projection${metadataFields.length > 0 ? ' : MetadataProjection' : ''} {
${projectionFields}
}

fun ${name}Projection.toReadModel(): ${name} =
    ${name}(
${resultArguments}
    )

interface ${name}Repository {
    fun ${readModelRepositoryMethodName(filterFields)}(${filterSignaturePrefix}pageable: Pageable): Page<${name}>
${id ? `    fun findById(id: ${idType}): ${name}?\n` : ''}    fun findProjectionById(id: ${idType}): ${name}Projection?
${partialLookupMethods ? `${partialLookupMethods}\n` : ''}    fun save(projection: ${name}Projection)
}

data class ${name}(
${resultFields}
)
`);
        this.fs.write(this._kotlinPath(`${readModelPersistencePath(context, name)}/${name}Entity.kt`), `package ${readModelPersistencePackage(this.model.rootPackage, context, name)}

import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.IdClass
${metadataFields.length > 0 ? `import ${this.model.rootPackage}.shared.application.metadata.MetadataProjection\n` : ''}${compositeId ? `import ${packageName}.${keyName}\n` : ''}${allImports}

${idClassAnnotation}@Entity
class ${name}Entity${metadataFields.length > 0 ? ' : MetadataProjection' : ''} {
${entityFields}
}
`);
        if (id) {
            this._writeReadModelJpaRepository(packageName, context, slicePackage, slice, readmodel, name, idFields);
            this._writeReadModelResource(packageName, context, slicePackage, slice, readmodel, name, idFields);
            this._writeReadModelProjector(packageName, context, slicePackage, slice, readmodel, name, idFields);
        }
    },

    _writeReadModelJpaRepository(readModelPackageName, context, slicePackage, slice, readmodel, name, idFields) {
        const entityName = `${name}Entity`;
        const springDataRepositoryName = `SpringData${name}Repository`;
        const repositoryName = `${name}Repository`;
        const adapterName = `Jpa${name}Repository`;
        const id = idFields[0];
        const idType = idFields.length > 1 ? `${name}Key` : readModelStorageType(id, false);
        const filterFields = readModelFilterFields(readmodel);
        const imports = readModelStorageImports([...idFields, ...filterFields], this.model.rootPackage);
        const partialLookupMethods = idFields.length > 1
            ? idFields.map((field) =>
                `    fun findAllBy${pascal(field.name)}(${field.name}: ${readModelStorageType(field, false)}): List<${entityName}>`
            ).join('\n')
            : '';
        const projectionLookupMethods = idFields.length > 1
            ? idFields.map((field) =>
                `    override fun findProjectionsBy${pascal(field.name)}(${field.name}: ${readModelStorageType(field, false)}): List<${name}Projection> =
        jpaRepository.findAllBy${pascal(field.name)}(${field.name}).map { it.toProjection() }`
            ).join('\n\n')
            : '';
        const packageName = readModelPersistencePackage(this.model.rootPackage, context, name);
        const filterParameters = filterFields
            .map((field) => `${field.name}: ${readModelStorageType(field, false)}?`)
            .join(', ');
        const filterSignaturePrefix = filterFields.length > 0 ? `${filterParameters}, ` : '';
        const filterArguments = filterFields.map((field) => field.name).join(', ');
        const findAllImplementation = filterFields.length > 0
            ? `    override fun findAllByFilter(${filterSignaturePrefix}pageable: Pageable): Page<${name}> =
        jpaRepository.findAll(filters(${filterArguments}), pageable).map { it.toProjection().toReadModel() }`
            : `    override fun findAll(pageable: Pageable): Page<${name}> =
        jpaRepository.findAll(pageable).map { it.toProjection().toReadModel() }`;
        const filterSpecification = filterFields.length > 0
            ? `

    private fun filters(${filterParameters}): Specification<${entityName}> =
        Specification { root, _, criteriaBuilder ->
            val predicates = mutableListOf<Predicate>()
${filterFields.map((field) => `            ${field.name}?.let { predicates.add(criteriaBuilder.equal(root.get<${readModelStorageType(field, false)}>("${field.name}"), it)) }`).join('\n')}
            criteriaBuilder.and(*predicates.toTypedArray())
        }
`
            : '';
        const entityToProjectionAssignments = [
            ...readmodel.fields.map((field) => `            it.${field.name} = this@toProjection.${field.name}`),
            ...readModelMetadataFields(readmodel).map((field) => `            it.${field.name} = this@toProjection.${field.name}`)
        ].join('\n');
        const projectionToEntityAssignments = [
            ...readmodel.fields.map((field) => `            it.${field.name} = this@toEntity.${field.name}`),
            ...readModelMetadataFields(readmodel).map((field) => `            it.${field.name} = this@toEntity.${field.name}`)
        ].join('\n');
        this.fs.write(this._kotlinPath(`${readModelPersistencePath(context, name)}/${springDataRepositoryName}.kt`), `package ${packageName}

import org.springframework.data.jpa.repository.JpaRepository
${filterFields.length > 0 ? 'import org.springframework.data.jpa.repository.JpaSpecificationExecutor\n' : ''}${imports}
${idFields.length > 1 ? `import ${readModelPackageName}.${name}Key\n` : ''}
interface ${springDataRepositoryName} : JpaRepository<${entityName}, ${idType}>${filterFields.length > 0 ? `, JpaSpecificationExecutor<${entityName}>` : ''} {
${partialLookupMethods}
}
`);
        this.fs.write(this._kotlinPath(`${readModelPersistencePath(context, name)}/${adapterName}.kt`), `package ${packageName}

${filterFields.length > 0 ? 'import jakarta.persistence.criteria.Predicate\nimport org.springframework.data.jpa.domain.Specification\n' : ''}import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.stereotype.Repository
${imports}
import ${readModelPackageName}.${name}
${idFields.length > 1 ? `import ${readModelPackageName}.${name}Key\n` : ''}import ${readModelPackageName}.${name}Projection
import ${readModelPackageName}.${repositoryName}
import ${readModelPackageName}.toReadModel

@Repository
class ${adapterName}(private val jpaRepository: ${springDataRepositoryName}) : ${repositoryName} {
${findAllImplementation}

    override fun findById(id: ${idType}): ${name}? =
        jpaRepository.findById(id).map { it.toProjection().toReadModel() }.orElse(null)

    override fun findProjectionById(id: ${idType}): ${name}Projection? =
        jpaRepository.findById(id).map { it.toProjection() }.orElse(null)

${projectionLookupMethods ? `${projectionLookupMethods}\n\n` : ''}    override fun save(projection: ${name}Projection) {
        jpaRepository.save(projection.toEntity())
    }${filterSpecification}

    private fun ${entityName}.toProjection(): ${name}Projection =
        ${name}Projection().also {
${entityToProjectionAssignments}
        }

    private fun ${name}Projection.toEntity(): ${entityName} =
        ${entityName}().also {
${projectionToEntityAssignments}
        }
}
`);
    },

    _writeReadModelResource(packageName, context, slicePackage, slice, readmodel, name, idFields) {
        const repositoryName = `${name}Repository`;
        const resourceName = `${name}Resource`;
        const id = idFields[0];
        const idType = idFields.length > 1 ? `${name}Key` : readModelStorageType(id, false);
        const conceptRoute = httpRoute(slice.concepts[0] ?? slice.name);
        const readmodelRoute = httpRoute(readmodel.title);
        const filterFields = readModelFilterFields(readmodel);
        const imports = readModelStorageImports([...idFields, ...filterFields], this.model.rootPackage);
        const filterRequestParams = filterFields
            .map((field) => `        @RequestParam(required = false) ${field.name}: ${readModelStorageType(field, false)}?`)
            .join(',\n');
        const findAllParameters = [
            filterRequestParams,
            '        @PageableDefault(size = 20) pageable: Pageable'
        ].filter(Boolean).join(',\n');
        const filterArguments = filterFields.length > 0 ? `${filterFields.map((field) => field.name).join(', ')}, ` : '';
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${resourceName}.kt`), `package ${packageName}

import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.web.PageableDefault
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.CrossOrigin
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
${filterFields.length > 0 ? 'import org.springframework.web.bind.annotation.RequestParam\n' : ''}import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
${imports}

@CrossOrigin
@RestController
@RequestMapping("/${conceptRoute}/${readmodelRoute}")
class ${resourceName}(private val repository: ${repositoryName}) {
    @GetMapping
    fun findAll(
${findAllParameters}
    ): Page<${name}> =
        repository.${readModelRepositoryMethodName(filterFields)}(${filterArguments}pageable)

${idFields.length === 1 ? `
    @GetMapping("/{id}")
    fun findOne(@PathVariable id: ${idType}): ResponseEntity<${name}> =
        repository.findById(id)?.let { ResponseEntity.ok(it) } ?: ResponseEntity.notFound().build()
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
                const rawKeyExpression = idFields.length > 1
                    ? `${keyName}(${idFields.map((field) => `${field.name} = ${readModelStorageExpression(field, `event.${field.name}`)}`).join(', ')})`
                    : readModelStorageExpression(idFields[0], `event.${idFields[0].name}`);
                const singleKeyEventField = idFields.length === 1
                    ? event.fields.find((field) => field.name === idFields[0].name)
                    : undefined;
                const keyGuard = singleKeyEventField?.optional
                    ? `        val key = ${rawKeyExpression} ?: return\n`
                    : '';
                const keyExpression = singleKeyEventField?.optional ? 'key' : rawKeyExpression;
                const initializeIds = idFields
                    .map((field) => `                this.${field.name} = ${singleKeyEventField?.optional && field.name === idFields[0].name ? 'key' : readModelStorageExpression(field, `event.${field.name}`)}`)
                    .join('\n');
                return `    @EventHandler
    fun on(
        event: ${_eventTitle(event.title)}${metadataParameters}
    ) {
${keyGuard}
        val entity = repository.findProjectionById(${keyExpression}) ?: ${name}Projection().apply {
${initializeIds}
        }
${saveAssignments || '        // No read-model fields are present on this event.'}
        repository.save(entity)
    }`;
            }

            if (availableIds.length === 1 && idFields.length > 1) {
                const lookupField = availableIds[0];
                const lookupEventField = event.fields.find((field) => field.name === lookupField.name);
                const rawLookupExpression = readModelStorageExpression(lookupField, `event.${lookupField.name}`);
                const lookupGuard = lookupEventField?.optional
                    ? `        val lookupValue = ${rawLookupExpression} ?: return\n`
                    : '';
                const lookupExpression = lookupEventField?.optional ? 'lookupValue' : rawLookupExpression;
                return `    @EventHandler
    fun on(
        event: ${_eventTitle(event.title)}${metadataParameters}
    ) {
${lookupGuard}
        repository.findProjectionsBy${pascal(lookupField.name)}(${lookupExpression}).forEach { entity ->
${saveAssignments || '            // No read-model fields are present on this event.'}
            repository.save(entity)
        }
    }`;
            }

            return `    @EventHandler
    fun on(event: ${_eventTitle(event.title)}) {
        // Skipped: ${_eventTitle(event.title)} does not provide enough key fields to locate ${name}Projection.
    }`;
        }).join('\n\n');

        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${name}Projector.kt`), `package ${packageName}

import org.axonframework.messaging.eventhandling.annotation.EventHandler
${includeMetadata ? 'import org.axonframework.messaging.eventhandling.EventMessage\n' : ''}import org.springframework.stereotype.Component
${includeMetadata ? `import ${this.model.rootPackage}.shared.application.metadata.ProjectionMetadata\n` : ''}
${eventImports}
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

function readModelFilterFields(readmodel) {
    const providerFilterFields = [
        readmodel.dictionaryProvider?.code,
        readmodel.dictionaryProvider?.state,
        readmodel.dictionaryProvider?.active
    ].filter(Boolean);
    const filterFieldNames = new Set([
        ...(readmodel.fields ?? [])
            .filter((field) => field.query)
            .map((field) => field.name),
        ...providerFilterFields
    ]);

    return uniqueBy(
        (readmodel.fields ?? [])
            .filter((field) => filterFieldNames.has(field.name))
            .filter((field) => field.cardinality !== 'Multiple'),
        (field) => field.name
    );
}

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
