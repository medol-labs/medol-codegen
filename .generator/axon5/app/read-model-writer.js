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

function conventionallyCompatibleReadModelField(readModelField, eventField) {
    if (readModelField.type === eventField.type) {
        return true;
    }
    return valueTypeForField(readModelField)?.name === valueTypeForField(eventField)?.name;
}

function bestSemanticFieldMatch(event, candidates, hint) {
    if (!candidates.length) {
        return undefined;
    }
    const ranked = candidates
        .map((field) => {
            return {
                field,
                score: semanticFieldScore(event, field, hint)
            };
        })
        .sort((left, right) => right.score - left.score || left.field.name.length - right.field.name.length);
    return ranked[0]?.score > 0 ? ranked[0].field : undefined;
}

function semanticFieldScore(event, field, hint) {
    const eventWords = semanticWords([event.title, event.name, hint].filter(Boolean).join(' '));
    const fieldWords = semanticWords(field.name);
    const overlap = fieldWords.filter((word) => eventWords.includes(word)).length;
    const extraFieldWords = fieldWords.filter((word) => !eventWords.includes(word)).length;
    const suffixBonus = hint && field.name.toLowerCase().endsWith(String(hint).toLowerCase()) ? 2 : 0;
    return overlap * 3 + suffixBonus - extraFieldWords;
}

function bestSemanticStateMatch(event, states) {
    if (!states.length) {
        return undefined;
    }
    const eventWords = semanticWords([event.title, event.name].filter(Boolean).join(' '));
    const ranked = states
        .map((state) => {
            const stateWords = semanticWords(state);
            const overlap = stateWords.filter((word) => eventWords.includes(word)).length;
            const extraStateWords = stateWords.filter((word) => !eventWords.includes(word)).length;
            return {
                state,
                score: overlap * 3 - extraStateWords
            };
        })
        .sort((left, right) => right.score - left.score || left.state.length - right.state.length);
    return ranked[0]?.score > 0 ? ranked[0].state : undefined;
}

function conceptStates(model, context, conceptName) {
    const concept = (model.concepts ?? []).find((candidate) =>
        candidate.name === conceptName && (!context || candidate.context === context)
    );
    return concept?.states ?? [];
}

function isFailureEvent(event) {
    return semanticWords([event.title, event.name].filter(Boolean).join(' ')).includes('failed');
}

function semanticWords(value) {
    const synonyms = {
        failure: 'failed',
        fail: 'failed',
        fails: 'failed',
        failing: 'failed',
        installation: 'deployment',
        installed: 'deployment',
        install: 'deployment',
        succeeded: 'ready',
        success: 'ready',
        established: 'connected',
        profiled: 'metadata',
        profiling: 'metadata',
        profile: 'metadata',
        reprofiled: 'metadata',
        reprofiling: 'metadata',
        validated: 'contract',
        validation: 'contract',
        revalidated: 'contract',
        revalidation: 'contract'
    };
    return splitWords(value)
        .map((word) => synonyms[word] ?? word)
        .filter((word) => !['event', 'read', 'model', 'reason', 'at'].includes(word));
}

function splitWords(value) {
    return String(value ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[^A-Za-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.toLowerCase());
}

function lowerCamel(value) {
    const text = String(value ?? '');
    return text.charAt(0).toLowerCase() + text.slice(1);
}

function readModelPersistencePackage(rootPackage, context, readmodelName) {
    return `${rootPackage}.${context}.infrastructure.secondary.persistence.${_sliceTitle(readmodelName)}`;
}

function readModelPersistencePath(context, readmodelName) {
    return `${context}/infrastructure/secondary/persistence/${_sliceTitle(readmodelName)}`;
}

function readModelRepositoryMethodName(filterFields) {
    return filterFields.length > 0 ? 'findAllByFilter' : 'findAll';
}

function isJsonJpaField(field) {
    return field.cardinality === 'Multiple' || valueTypeForField(field)?.kind === 'object';
}

function jpaEntityFieldType(field) {
    return isJsonJpaField(field) ? 'String?' : readModelStorageFieldType(field);
}

function jpaEntityFieldDefault(field) {
    return isJsonJpaField(field) ? 'null' : readModelStorageFieldDefault(field);
}

function jpaEntityImports(fields, rootPackage) {
    return readModelStorageImports((fields ?? []).filter((field) => !isJsonJpaField(field)), rootPackage);
}

function jpaEntityColumnAnnotation(field) {
    return isJsonJpaField(field) || isLongTextField(field) ? '    @Column(columnDefinition = "text")\n' : '';
}

function isLongTextField(field) {
    if (field.cardinality === 'Multiple' || readModelStorageField(field).type !== 'String') {
        return false;
    }
    return /(?:reason|reasons|message|description|error|output|log|hint|detail|stackTrace)$/i.test(field.name);
}

function isCriteriaField(field) {
    return !isJsonJpaField(field);
}

function criteriaFilterType(field) {
    const type = readModelStorageType(field, false);
    switch (type) {
        case 'String': return 'StringFilter';
        case 'UUID': return 'StringFilter';
        case 'Int': return 'IntegerFilter';
        case 'Long': return 'LongFilter';
        case 'Float': return 'FloatFilter';
        case 'Double': return 'DoubleFilter';
        case 'BigDecimal': return 'BigDecimalFilter';
        case 'Boolean': return 'BooleanFilter';
        case 'LocalDate': return 'LocalDateFilter';
        case 'LocalDateTime': return 'RangeFilter<LocalDateTime>';
        default: return `Filter<${type}>`;
    }
}

function criteriaFilterImports(fields) {
    const filterTypes = new Set((fields ?? []).map(criteriaFilterType).map((type) => type.replace(/<.*$/, '')));
    return Array.from(filterTypes).sort().map((type) => `import tech.jhipster.service.filter.${type}`).join('\n');
}

function queryServiceSpecificationBuilder(field, entityName) {
    const type = readModelStorageType(field, false);
    const expression = type === 'UUID'
        ? `Function<Root<${entityName}>, Expression<String>> { root -> (root.get<UUID>("${field.name}") as JpaExpression<UUID>).cast(String::class.java) }`
        : `Function<Root<${entityName}>, Expression<${type}>> { root -> root.get("${field.name}") }`;
    const builder = type === 'LocalDateTime'
        ? 'buildLocalDateTimeRangeSpecification'
        : type === 'LocalDate'
            ? 'buildLocalDateRangeSpecification'
            : isRangeCriteriaType(type) ? 'buildExpressionRangeSpecification' : 'buildSpecification';
    return `            criteria.${field.name}?.let { specification = specification.and(${builder}(it, ${expression})) }`;
}

function isRangeCriteriaType(type) {
    return ['Int', 'Long', 'Float', 'Double', 'BigDecimal', 'LocalDate', 'LocalDateTime'].includes(type);
}

function jsonTypeReference(field) {
    return `object : com.fasterxml.jackson.core.type.TypeReference<${readModelStorageFieldType(field)}>() {}`;
}

const readModelWriterMethods = {
    _writeReadModel(packageName, context, slicePackage, slice, readmodel) {
        const name = _readmodelTitle(readmodel.title);
        const imports = readModelStorageImports(readmodel.fields, this.model.rootPackage);
        const entityImports = jpaEntityImports(readmodel.fields, this.model.rootPackage);
        const hasJsonJpaFields = (readmodel.fields ?? []).some(isJsonJpaField);
        const metadataFields = readModelMetadataFields(readmodel);
        const allImports = [imports].filter(Boolean).join('\n');
        const allEntityImports = [entityImports].filter(Boolean).join('\n');
        const ids = readmodel.fields.filter((field) => field.idAttribute);
        const idFields = ids.length > 0 ? ids : readmodel.fields.slice(0, 1);
        const id = idFields[0];
        const compositeId = idFields.length > 1;
        const entityFields = [
            ...readmodel.fields.map((field) => {
                const annotation = idFields.some((candidate) => candidate.name === field.name) ? '    @Id\n' : '';
                const enumAnnotation = isJpaEnumField(field) ? '    @Enumerated(EnumType.STRING)\n' : '';
                const columnAnnotation = jpaEntityColumnAnnotation(field);
                return `${annotation}${enumAnnotation}${columnAnnotation}    var ${field.name}: ${jpaEntityFieldType(field)} = ${jpaEntityFieldDefault(field)}`;
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
        const criteriaFields = (readmodel.fields ?? []).filter(isCriteriaField);
        const criteriaDeclaration = criteriaFields.length > 0
            ? `
class ${name}Criteria {
${criteriaFields.map((field) => `    var ${field.name}: ${criteriaFilterType(field)}? = null`).join('\n')}
}
`
            : '';
        const criteriaImports = criteriaFields.length > 0 ? criteriaFilterImports(criteriaFields) : '';
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
${criteriaImports ? `${criteriaImports}\n` : ''}

${keyDeclaration}${queryDeclaration}
${criteriaDeclaration}

class ${name}Projection${metadataFields.length > 0 ? ' : MetadataProjection' : ''} {
${projectionFields}
}

fun ${name}Projection.toReadModel(): ${name} =
    ${name}(
${resultArguments}
    )

interface ${name}Repository {
    fun ${readModelRepositoryMethodName(filterFields)}(${filterSignaturePrefix}pageable: Pageable): Page<${name}>
    fun findAllByCriteria(criteria: ${name}Criteria?, pageable: Pageable): Page<${name}>
${id ? `    fun findById(id: ${idType}): ${name}?\n` : ''}    fun findProjectionById(id: ${idType}): ${name}Projection?
${partialLookupMethods ? `${partialLookupMethods}\n` : ''}    fun save(projection: ${name}Projection)
}

data class ${name}(
${resultFields}
)
`);
        this.fs.write(this._kotlinPath(`${readModelPersistencePath(context, name)}/${name}Entity.kt`), `package ${readModelPersistencePackage(this.model.rootPackage, context, name)}

import jakarta.persistence.Entity
import jakarta.persistence.Column
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.IdClass
${metadataFields.length > 0 ? `import ${this.model.rootPackage}.shared.application.metadata.MetadataProjection\n` : ''}${compositeId ? `import ${packageName}.${keyName}\n` : ''}${allEntityImports}

${idClassAnnotation}@Entity
class ${name}Entity${metadataFields.length > 0 ? ' : MetadataProjection' : ''} {
${entityFields}
}
`);
        if (id) {
            this._writeReadModelJpaRepository(packageName, context, slicePackage, slice, readmodel, name, idFields, hasJsonJpaFields);
            this._writeReadModelResource(packageName, context, slicePackage, slice, readmodel, name, idFields);
            this._writeReadModelProjector(packageName, context, slicePackage, slice, readmodel, name, idFields);
        }
    },

    _writeReadModelJpaRepository(readModelPackageName, context, slicePackage, slice, readmodel, name, idFields, hasJsonJpaFields = false) {
        const entityName = `${name}Entity`;
        const springDataRepositoryName = `SpringData${name}Repository`;
        const repositoryName = `${name}Repository`;
        const adapterName = `Jpa${name}Repository`;
        const id = idFields[0];
        const idType = idFields.length > 1 ? `${name}Key` : readModelStorageType(id, false);
        const filterFields = readModelFilterFields(readmodel);
        const criteriaFields = (readmodel.fields ?? []).filter(isCriteriaField);
        const jsonFields = (readmodel.fields ?? []).filter(isJsonJpaField);
        const imports = readModelStorageImports([...idFields, ...filterFields, ...jsonFields, ...criteriaFields], this.model.rootPackage);
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
        findAllByCriteria(null, pageable)`;
        const criteriaImplementation = `    override fun findAllByCriteria(criteria: ${name}Criteria?, pageable: Pageable): Page<${name}> =
        queryService.findByCriteria(criteria, pageable)`;
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
            ...readmodel.fields.map((field) => isJsonJpaField(field)
                ? `            it.${field.name} = this@toProjection.${field.name}?.let { json -> objectMapper.readValue(json, ${jsonTypeReference(field)}) } ?: ${readModelStorageFieldDefault(field)}`
                : `            it.${field.name} = this@toProjection.${field.name}`),
            ...readModelMetadataFields(readmodel).map((field) => `            it.${field.name} = this@toProjection.${field.name}`)
        ].join('\n');
        const projectionToEntityAssignments = [
            ...readmodel.fields.map((field) => isJsonJpaField(field)
                ? `            it.${field.name} = objectMapper.writeValueAsString(this@toEntity.${field.name})`
                : `            it.${field.name} = this@toEntity.${field.name}`),
            ...readModelMetadataFields(readmodel).map((field) => `            it.${field.name} = this@toEntity.${field.name}`)
        ].join('\n');
        this.fs.write(this._kotlinPath(`${readModelPersistencePath(context, name)}/${springDataRepositoryName}.kt`), `package ${packageName}

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.JpaSpecificationExecutor
${imports}
${idFields.length > 1 ? `import ${readModelPackageName}.${name}Key\n` : ''}
interface ${springDataRepositoryName} : JpaRepository<${entityName}, ${idType}>, JpaSpecificationExecutor<${entityName}> {
${partialLookupMethods}
}
`);
        this.fs.write(this._kotlinPath(`${readModelPersistencePath(context, name)}/${adapterName}.kt`), `package ${packageName}

${filterFields.length > 0 ? 'import jakarta.persistence.criteria.Predicate\nimport org.springframework.data.jpa.domain.Specification\n' : ''}import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.stereotype.Repository
${hasJsonJpaFields ? 'import com.fasterxml.jackson.databind.ObjectMapper\n' : ''}${hasJsonJpaFields ? 'import com.fasterxml.jackson.module.kotlin.readValue\n' : ''}
${imports}
import ${readModelPackageName}.${name}
import ${readModelPackageName}.${name}Criteria
${idFields.length > 1 ? `import ${readModelPackageName}.${name}Key\n` : ''}import ${readModelPackageName}.${name}Projection
import ${readModelPackageName}.${repositoryName}
import ${readModelPackageName}.toReadModel

@Repository
class ${adapterName}(
    private val jpaRepository: ${springDataRepositoryName},
    private val queryService: ${name}QueryService${hasJsonJpaFields ? ',\n    private val objectMapper: ObjectMapper' : ''}
) : ${repositoryName} {
${findAllImplementation}

${criteriaImplementation}

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
        if (criteriaFields.length > 0) {
            const hasRangeCriteriaFields = criteriaFields.some((field) => isRangeCriteriaType(readModelStorageType(field, false)));
            const hasLocalDateCriteriaFields = criteriaFields.some((field) => readModelStorageType(field, false) === 'LocalDate');
            const hasLocalDateTimeCriteriaFields = criteriaFields.some((field) => readModelStorageType(field, false) === 'LocalDateTime');
            this.fs.write(this._kotlinPath(`${readModelPersistencePath(context, name)}/${name}QueryService.kt`), `package ${packageName}

import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.domain.Specification
import org.springframework.stereotype.Service
import jakarta.persistence.criteria.Expression
import jakarta.persistence.criteria.Root
import org.hibernate.query.criteria.JpaExpression
import tech.jhipster.service.QueryService
${hasRangeCriteriaFields ? 'import tech.jhipster.service.filter.RangeFilter\n' : ''}import java.util.function.Function
${imports}
import ${readModelPackageName}.${name}
import ${readModelPackageName}.${name}Criteria
import ${readModelPackageName}.${name}Projection
import ${readModelPackageName}.toReadModel

@Service
class ${name}QueryService(
    private val repository: ${springDataRepositoryName}${hasJsonJpaFields ? ',\n    private val objectMapper: com.fasterxml.jackson.databind.ObjectMapper' : ''}
) : QueryService<${entityName}>() {
    fun findByCriteria(criteria: ${name}Criteria?, pageable: Pageable): Page<${name}> =
        repository.findAll(createSpecification(criteria), pageable).map { it.toProjection().toReadModel() }

    private fun createSpecification(criteria: ${name}Criteria?): Specification<${entityName}> {
        var specification = Specification.where<${entityName}>(null)
        if (criteria != null) {
${criteriaFields.map((field) => queryServiceSpecificationBuilder(field, entityName)).join('\n')}
        }
        return specification
    }

${hasLocalDateTimeCriteriaFields ? `    private fun buildLocalDateTimeRangeSpecification(
        filter: RangeFilter<*>,
        field: Function<Root<${entityName}>, Expression<LocalDateTime>>
    ): Specification<${entityName}> =
        Specification { root, _, builder ->
            val expression = field.apply(root)
            val predicates = mutableListOf<jakarta.persistence.criteria.Predicate>()
            filter.getEquals()?.let { predicates.add(builder.equal(expression, localDateTimeValue(it))) }
            filter.getNotEquals()?.let { predicates.add(builder.notEqual(expression, localDateTimeValue(it))) }
            filter.getSpecified()?.let { predicates.add(if (it) builder.isNotNull(expression) else builder.isNull(expression)) }
            (filter.getIn() as List<*>?)?.takeIf { it.isNotEmpty() }?.let { predicates.add(expression.\`in\`(it.map { value -> localDateTimeValue(value) })) }
            (filter.getNotIn() as List<*>?)?.takeIf { it.isNotEmpty() }?.let { predicates.add(builder.not(expression.\`in\`(it.map { value -> localDateTimeValue(value) }))) }
            filter.getGreaterThan()?.let { predicates.add(builder.greaterThan(expression, localDateTimeValue(it))) }
            filter.getGreaterThanOrEqual()?.let { predicates.add(builder.greaterThanOrEqualTo(expression, localDateTimeValue(it))) }
            filter.getLessThan()?.let { predicates.add(builder.lessThan(expression, localDateTimeValue(it))) }
            filter.getLessThanOrEqual()?.let { predicates.add(builder.lessThanOrEqualTo(expression, localDateTimeValue(it))) }
            builder.and(*predicates.toTypedArray())
        }

    private fun localDateTimeValue(value: Any?): LocalDateTime =
        when (value) {
            is LocalDateTime -> value
            null -> throw IllegalArgumentException("LocalDateTime filter value is required.")
            else -> value.toString().let { raw ->
                if (raw.all { it.isDigit() }) {
                    java.time.Instant.ofEpochMilli(raw.toLong()).atZone(java.time.ZoneId.systemDefault()).toLocalDateTime()
                } else {
                    LocalDateTime.parse(raw)
                }
            }
        }

` : ''}${hasLocalDateCriteriaFields ? `    private fun buildLocalDateRangeSpecification(
        filter: RangeFilter<*>,
        field: Function<Root<${entityName}>, Expression<LocalDate>>
    ): Specification<${entityName}> =
        Specification { root, _, builder ->
            val expression = field.apply(root)
            val predicates = mutableListOf<jakarta.persistence.criteria.Predicate>()
            filter.getEquals()?.let { predicates.add(builder.equal(expression, localDateValue(it))) }
            filter.getNotEquals()?.let { predicates.add(builder.notEqual(expression, localDateValue(it))) }
            filter.getSpecified()?.let { predicates.add(if (it) builder.isNotNull(expression) else builder.isNull(expression)) }
            (filter.getIn() as List<*>?)?.takeIf { it.isNotEmpty() }?.let { predicates.add(expression.\`in\`(it.map { value -> localDateValue(value) })) }
            (filter.getNotIn() as List<*>?)?.takeIf { it.isNotEmpty() }?.let { predicates.add(builder.not(expression.\`in\`(it.map { value -> localDateValue(value) }))) }
            filter.getGreaterThan()?.let { predicates.add(builder.greaterThan(expression, localDateValue(it))) }
            filter.getGreaterThanOrEqual()?.let { predicates.add(builder.greaterThanOrEqualTo(expression, localDateValue(it))) }
            filter.getLessThan()?.let { predicates.add(builder.lessThan(expression, localDateValue(it))) }
            filter.getLessThanOrEqual()?.let { predicates.add(builder.lessThanOrEqualTo(expression, localDateValue(it))) }
            builder.and(*predicates.toTypedArray())
        }

    private fun localDateValue(value: Any?): LocalDate =
        when (value) {
            is LocalDate -> value
            null -> throw IllegalArgumentException("LocalDate filter value is required.")
            else -> value.toString().let { raw ->
                if (raw.all { it.isDigit() }) {
                    java.time.Instant.ofEpochMilli(raw.toLong()).atZone(java.time.ZoneId.systemDefault()).toLocalDate()
                } else {
                    LocalDate.parse(raw)
                }
            }
        }

` : ''}${hasRangeCriteriaFields ? `    private fun <X : Comparable<in X>> buildExpressionRangeSpecification(
        filter: RangeFilter<X>,
        field: Function<Root<${entityName}>, Expression<X>>
    ): Specification<${entityName}> =
        Specification { root, _, builder ->
            val expression = field.apply(root)
            val predicates = mutableListOf<jakarta.persistence.criteria.Predicate>()
            filter.getEquals()?.let { predicates.add(builder.equal(expression, it)) }
            filter.getNotEquals()?.let { predicates.add(builder.notEqual(expression, it)) }
            filter.getSpecified()?.let { predicates.add(if (it) builder.isNotNull(expression) else builder.isNull(expression)) }
            filter.getIn()?.takeIf { it.isNotEmpty() }?.let { predicates.add(expression.\`in\`(it)) }
            filter.getNotIn()?.takeIf { it.isNotEmpty() }?.let { predicates.add(builder.not(expression.\`in\`(it))) }
            filter.getGreaterThan()?.let { predicates.add(builder.greaterThan(expression, it)) }
            filter.getGreaterThanOrEqual()?.let { predicates.add(builder.greaterThanOrEqualTo(expression, it)) }
            filter.getLessThan()?.let { predicates.add(builder.lessThan(expression, it)) }
            filter.getLessThanOrEqual()?.let { predicates.add(builder.lessThanOrEqualTo(expression, it)) }
            builder.and(*predicates.toTypedArray())
        }

` : ''}    private fun ${entityName}.toProjection(): ${name}Projection =
        ${name}Projection().also {
${entityToProjectionAssignments}
        }
}
`);
        }
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
        const findAllParameters = [
            `        criteria: ${name}Criteria`,
            '        @PageableDefault(size = 20) pageable: Pageable'
        ].filter(Boolean).join(',\n');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${resourceName}.kt`), `package ${packageName}

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

@CrossOrigin
@RestController
@RequestMapping("/${conceptRoute}/${readmodelRoute}")
class ${resourceName}(private val repository: ${repositoryName}) {
    @GetMapping
    fun findAll(
${findAllParameters}
    ): Page<${name}> =
        repository.findAllByCriteria(criteria, pageable)

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
        const includeEventTime = events.some((event) =>
            this._readModelConventionalAssignments(readmodel, event, new Set()).some((assignment) => assignment.usesEventTime)
        );
        const includeEventMessage = includeMetadata || includeEventTime;
        const metadataAssignments = readModelMetadataAssignments(metadataFields, '            ');
        const eventMessageParameter = includeEventMessage
            ? `,\n        message: EventMessage`
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
                return concept
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
            const conventionalAssignments = this._readModelConventionalAssignments(
                readmodel,
                event,
                new Set([...directFieldNames, ...derivedAssignments.map((assignment) => assignment.fieldName)])
            );
            const assignments = [
                ...readmodel.fields
                .filter((field) => eventFields.has(field.name))
                .map((field) => `            entity.${field.name} = ${readModelStorageExpression(field, `event.${field.name}`)}`),
                ...derivedAssignments.map((assignment) => `            ${assignment.code}`),
                ...conventionalAssignments.map((assignment) => `            ${assignment.code}`)
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
        event: ${_eventTitle(event.title)}${eventMessageParameter}
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
        event: ${_eventTitle(event.title)}${eventMessageParameter}
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
${includeEventMessage ? 'import org.axonframework.messaging.eventhandling.EventMessage\n' : ''}import org.springframework.stereotype.Component
${includeMetadata ? `import ${this.model.rootPackage}.shared.application.metadata.ProjectionMetadata\n` : ''}
${eventImports}
${stateImports}
${includeEventTime ? 'import java.time.LocalDateTime\nimport java.time.ZoneOffset\n' : ''}

@Component
class ${name}Projector(private val repository: ${repositoryName}) {
${handlers}
${includeEventTime ? `
    private fun eventTime(message: EventMessage): LocalDateTime =
        LocalDateTime.ofInstant(message.timestamp(), ZoneOffset.UTC)
` : ''}
}
`);
    },

    _readModelDerivedAssignments(readmodel, event, directFieldNames = new Set()) {
        const assignments = [];
        const assignedFieldNames = new Set(directFieldNames);
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
                assignments.push({
                    fieldName: field.name,
                    code: `event.${eventField.name}?.let { entity.${field.name} = ${readModelStorageExpression(field, 'it')} }`
                });
            } else {
                assignments.push({
                    fieldName: field.name,
                    code: `entity.${field.name} = ${expression}`
                });
            }
            assignedFieldNames.add(field.name);
        }

        const ownerSlice = this.model.slices.find((slice) =>
            (slice.events ?? []).some((candidate) => candidate.id === event.id)
        );
        const stateChange = ownerSlice?.stateChange?.eventId === event.id ? ownerSlice.stateChange : undefined;
        const stateTransition = (this.model.transitions ?? []).find((transition) => transition.event?.id === event.id);
        const concept = ownerSlice?.concepts?.[0];
        if (!stateChange || !concept || stateTransition?.from === stateTransition?.to) {
            return assignments;
        }
        const field = readmodel.fields.find((candidate) => candidate.type === `${concept}.State`);
        if (field
            && !assignedFieldNames.has(field.name)
            && !eventFields.some((candidate) => candidate.name === field.name)
            && conceptHasState(this.model, ownerSlice.context, concept, stateChange.to)) {
            assignments.push({
                fieldName: field.name,
                code: `entity.${field.name} = ${conceptStateEnumName(concept)}.${constant(stateChange.to)}`
            });
        }

        return assignments;
    },

    _readModelConventionalAssignments(readmodel, event, assignedFieldNames = new Set()) {
        const assignments = [];
        const eventFields = event.fields ?? [];
        const ownerSlice = this.model.slices.find((slice) =>
            (slice.events ?? []).some((candidate) => candidate.id === event.id)
        );
        const stateChange = ownerSlice?.stateChange?.eventId === event.id ? ownerSlice.stateChange : undefined;
        const stateTransition = (this.model.transitions ?? []).find((transition) => transition.event?.id === event.id);

        const addAssignment = (field, code, usesEventTime = false) => {
            if (!field || assignedFieldNames.has(field.name)) {
                return;
            }
            assignments.push({fieldName: field.name, code, usesEventTime});
            assignedFieldNames.add(field.name);
        };

        for (const eventField of eventFields) {
            if (eventField.name === 'failureReason') {
                continue;
            }
            const suffix = pascal(eventField.name);
            const candidates = (readmodel.fields ?? []).filter((field) =>
                !assignedFieldNames.has(field.name)
                && field.name !== eventField.name
                && field.name.endsWith(suffix)
                && conventionallyCompatibleReadModelField(field, eventField)
            );
            const field = bestSemanticFieldMatch(event, candidates, eventField.name);
            if (field) {
                addAssignment(field, `entity.${field.name} = ${readModelStorageExpression(field, `event.${eventField.name}`)}`);
            }
        }

        if (stateChange?.to && stateTransition?.from !== stateTransition?.to) {
            const statusField = bestSemanticFieldMatch(event, (readmodel.fields ?? []).filter((field) =>
                !assignedFieldNames.has(field.name)
                && isStringStatusField(field)
            ), stateChange.to);
            if (statusField) {
                addAssignment(statusField, `entity.${statusField.name} = "${escapeKotlin(stateChange.to)}"`);
            }

            const stateAtSuffix = `${lowerCamel(stateChange.to)}At`;
            const candidates = (readmodel.fields ?? []).filter((field) =>
                !assignedFieldNames.has(field.name)
                && field.type === 'DateTime'
                && field.name.toLowerCase().endsWith(stateAtSuffix.toLowerCase())
            );
            const field = bestSemanticFieldMatch(event, candidates, stateChange.to);
            if (field) {
                addAssignment(field, `entity.${field.name} = eventTime(message)`, true);
            }

            if (!semanticWords(stateChange.to).includes('failed')) {
                const resolvedEvent = {
                    ...event,
                    title: [event.title, stateChange.to].filter(Boolean).join(' '),
                    name: [event.name, stateChange.to].filter(Boolean).join(' ')
                };
                (readmodel.fields ?? [])
                    .filter((field) =>
                        !assignedFieldNames.has(field.name)
                        && field.optional
                        && (
                            field.name.endsWith('FailedAt')
                            || field.name.endsWith('FailureReason')
                        )
                        && semanticFieldScore(resolvedEvent, field, stateChange.to) > 0
                    )
                    .forEach((field) => {
                        addAssignment(field, `entity.${field.name} = null`);
                    });
            }
        }

        if (isFailureEvent(event)) {
            const statusField = bestSemanticFieldMatch(event, (readmodel.fields ?? []).filter((field) =>
                !assignedFieldNames.has(field.name)
                && isStringStatusField(field)
            ), 'failed');
            if (statusField) {
                addAssignment(statusField, `entity.${statusField.name} = "Failed"`);
            }

            const failedAtField = bestSemanticFieldMatch(event, (readmodel.fields ?? []).filter((field) =>
                !assignedFieldNames.has(field.name)
                && field.type === 'DateTime'
                && field.name.endsWith('FailedAt')
            ), 'failedAt');
            if (failedAtField) {
                addAssignment(failedAtField, `entity.${failedAtField.name} = eventTime(message)`, true);
            }

            const failureReasonEventField = eventFields.find((field) => field.name === 'failureReason');
            const failureReasonField = failureReasonEventField ? bestSemanticFieldMatch(event, (readmodel.fields ?? []).filter((field) =>
                !assignedFieldNames.has(field.name)
                && field.type === failureReasonEventField.type
                && field.name.endsWith('FailureReason')
            ), 'failureReason') : undefined;
            if (failureReasonField) {
                addAssignment(failureReasonField, `entity.${failureReasonField.name} = event.failureReason`);
            }

            const concept = ownerSlice?.concepts?.[0];
            const stateField = concept ? (readmodel.fields ?? []).find((field) =>
                !assignedFieldNames.has(field.name)
                && field.type === `${concept}.State`
            ) : undefined;
            const failedState = concept ? bestSemanticStateMatch(event, conceptStates(this.model, ownerSlice.context, concept)
                .filter((state) => semanticWords(state).includes('failed'))) : undefined;
            if (stateField && failedState) {
                addAssignment(stateField, `entity.${stateField.name} = ${conceptStateEnumName(concept)}.${constant(failedState)}`);
            }
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

function isStringStatusField(field) {
    return field.type === 'String'
        && field.cardinality !== 'Multiple'
        && /Status$/.test(field.name ?? '');
}

module.exports = {readModelWriterMethods};
