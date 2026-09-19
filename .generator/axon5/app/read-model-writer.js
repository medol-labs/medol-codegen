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
    safeDatabaseIdentifier,
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
const {readModelProcessingGroup} = require('./axon-processing');
const {contextPackage} = require('../../common/util/value-types');
const {_commandTitle, _eventTitle, _readmodelTitle, _sliceTitle} = require('../../common/util/naming');

function permissionCode(name) {
    return kebab(name)
        .replace(/-/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

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

function singularFieldCandidates(value) {
    const name = String(value ?? '');
    const candidates = [];
    if (name.endsWith('ies')) {
        candidates.push(`${name.slice(0, -3)}y`);
    }
    if (name.endsWith('s')) {
        candidates.push(name.slice(0, -1));
    }
    return uniqueBy(candidates.filter(Boolean), (candidate) => candidate);
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
    if (field.cardinality === 'Multiple') {
        return false;
    }
    if (String(readModelStorageField(field).type ?? '').toLowerCase() === 'text') return true;
    if (String(field.type ?? '').toLowerCase() === 'text') return true;
    if (readModelStorageField(field).type !== 'String') return false;
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
    _jpaEntityColumnAnnotation: jpaEntityColumnAnnotation,

    _writeReadModel(packageName, context, slicePackage, slice, readmodel) {
        const name = _readmodelTitle(readmodel.title);
        const tableName = safeDatabaseIdentifier(readmodel.tableName ?? readmodel.title);
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
import jakarta.persistence.Table
${metadataFields.length > 0 ? `import ${this.model.rootPackage}.shared.application.metadata.MetadataProjection\n` : ''}${compositeId ? `import ${packageName}.${keyName}\n` : ''}${allEntityImports}

${idClassAnnotation}@Entity
@Table(name = "${tableName}")
class ${name}Entity${metadataFields.length > 0 ? ' : MetadataProjection' : ''} {
${entityFields}
}
`);
        if (id) {
            this._writeReadModelJpaRepository(packageName, context, slicePackage, slice, readmodel, name, idFields, hasJsonJpaFields);
            this._writeReadModelResource(packageName, context, slicePackage, slice, readmodel, name, idFields);
            this._writeReadModelProjector(packageName, context, slicePackage, slice, readmodel, name, idFields);
            if (readmodel.sync) {
                this._writeSyncReadModelSupport();
                this._writeSyncReadModelRegistration(packageName, context, slicePackage, readmodel, name, idFields);
            }
        }
    },

    _writeSyncReadModelSupport() {
        if (this._syncReadModelSupportWritten) {
            return;
        }
        this._syncReadModelSupportWritten = true;
        const basePath = 'shared/application/sync';
        const basePackage = `${this.model.rootPackage}.shared.application.sync`;
        this.fs.write(this._sharedKernelKotlinPath(`${basePath}/SyncReadModelProperties.kt`), `package ${basePackage}

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties("medol.sync")
data class SyncReadModelProperties(
    var enabled: Boolean = true,
    var mode: String = "outbox-delta",
    var sourceBaseUrl: String = "",
    var sourceBaseUrls: Map<String, String> = emptyMap(),
    var pageSize: Int = 200,
    var fixedDelayMs: Long = 30000,
    var parameters: Map<String, String> = emptyMap()
) {
    fun sourceBaseUrlFor(target: SyncReadModelTarget): String =
        sourceBaseUrls.firstMatching(target.sourceContext)
            ?: sourceBaseUrls.firstMatching(target.source)
            ?: sourceBaseUrl

    private fun Map<String, String>.firstMatching(name: String): String? =
        entries.firstOrNull { (key, value) ->
            relaxedKey(key) == relaxedKey(name) && value.isNotBlank()
        }?.value

    private fun relaxedKey(value: String): String =
        value.filter { it.isLetterOrDigit() }.lowercase()
}
`);
        this.fs.write(this._sharedKernelKotlinPath(`${basePath}/SyncReadModelTarget.kt`), `package ${basePackage}

import java.time.LocalDateTime

data class SyncReadModelTarget(
    val name: String,
    val source: String,
    val sourceContext: String,
    val sourceReadModel: String,
    val sourcePath: String,
    val deltaPath: String = "$sourcePath/deltas",
    val fieldMappings: Map<String, String>,
    val queryParameters: (SyncReadModelContext) -> Map<String, String> = { emptyMap() },
    val upsert: (Map<String, Any?>, LocalDateTime) -> Unit
)

data class SyncReadModelContext(
    val properties: SyncReadModelProperties,
    val checkpoint: SyncReadModelCheckpoint?
) {
    fun requiredParameter(name: String, target: String): String =
        properties.parameters[name]
            ?: properties.parameters.entries.firstOrNull { (key, _) -> relaxedKey(key) == relaxedKey(name) }?.value
            ?: throw IllegalArgumentException("Sync target $target requires medol.sync.parameters.$name")

    private fun relaxedKey(value: String): String =
        value.filter { it.isLetterOrDigit() }.lowercase()
}

data class SyncReadModelResult(
    val target: String,
    val itemCount: Int,
    val nextCursor: String? = null,
    val nextSequence: Long? = null
)
`);
        this.fs.write(this._sharedKernelKotlinPath(`${basePath}/SyncReadModelAdapter.kt`), `package ${basePackage}

interface SyncReadModelAdapter {
    fun supports(mode: String): Boolean
    fun syncOnce(target: SyncReadModelTarget, checkpoint: SyncReadModelCheckpoint?): SyncReadModelResult
}
`);
        this.fs.write(this._sharedKernelKotlinPath(`${basePath}/SyncReadModelCheckpoint.kt`), `package ${basePackage}

import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import java.time.LocalDateTime

@Entity
@Table(name = "medol_sync_read_model_checkpoint")
class SyncReadModelCheckpoint {
    @Id
    var target: String = ""
    var source: String = ""
    var lastSuccessfulSyncedAt: LocalDateTime? = null
    var lastAttemptedAt: LocalDateTime? = null
    var lastStatus: String = "NEVER_SYNCED"
    var lastError: String? = null
    var syncedItemCount: Int = 0
    var lastCursor: String? = null
    var lastSequence: Long = 0
    var bootstrapCompleted: Boolean = false
}

interface SyncReadModelCheckpointRepository : JpaRepository<SyncReadModelCheckpoint, String>
`);
        this.fs.write(this._sharedKernelKotlinPath(`${basePath}/SyncReadModelOutbox.kt`), `package ${basePackage}

import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Index
import jakarta.persistence.LockModeType
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.axonframework.messaging.eventhandling.EventMessage
import org.slf4j.LoggerFactory
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import java.time.Duration
import java.time.LocalDateTime
import java.time.ZoneOffset

@Entity
@Table(
    name = "medol_sync_read_model_outbox",
    uniqueConstraints = [
        UniqueConstraint(
            name = "uk_sync_read_model_outbox_event",
            columnNames = ["source_context", "source_read_model", "read_model_key", "event_id", "operation"]
        )
    ],
    indexes = [
        Index(
            name = "idx_sync_read_model_outbox_channel_sequence",
            columnList = "channel, sequence"
        ),
        Index(
            name = "idx_sync_read_model_outbox_source_sequence",
            columnList = "source_context, source_read_model, sequence"
        ),
        Index(
            name = "idx_sync_read_model_outbox_queue_available",
            columnList = "channel, status, available_at, sequence"
        )
    ]
)
class SyncOutboxMessage {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var sequence: Long? = null

    var channel: String = ""

    @Column(name = "source_context")
    var sourceContext: String = ""

    @Column(name = "source_read_model")
    var sourceReadModel: String = ""

    @Column(name = "read_model_key")
    var messageKey: String = ""
    var operation: String = "UPSERT"

    @Column(name = "event_id")
    var eventId: String = ""

    @Column(name = "event_type")
    var eventType: String = ""

    @Column(name = "occurred_at")
    var occurredAt: LocalDateTime? = null

    @Column(name = "created_at")
    var createdAt: LocalDateTime = LocalDateTime.now()

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(columnDefinition = "text")
    var payloadJson: String = "{}"

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(columnDefinition = "text")
    var headersJson: String = "{}"

    var status: String? = SyncOutboxStatus.AVAILABLE

    @Column(name = "available_at")
    var availableAt: LocalDateTime? = LocalDateTime.now()

    @Column(name = "claimed_by")
    var claimedBy: String? = null

    @Column(name = "claimed_until")
    var claimedUntil: LocalDateTime? = null

    @Column(name = "retry_count")
    var retryCount: Int? = 0

    @Column(name = "processed_at")
    var processedAt: LocalDateTime? = null

    @Column(name = "last_error", columnDefinition = "text")
    var lastError: String? = null
}

object SyncOutboxStatus {
    const val AVAILABLE = "AVAILABLE"
    const val PROCESSING = "PROCESSING"
    const val PROCESSED = "PROCESSED"
    const val FAILED = "FAILED"
}

interface SyncOutboxRepository : JpaRepository<SyncOutboxMessage, Long> {
    fun findByChannelAndSequenceGreaterThanOrderBySequenceAsc(
        channel: String,
        sequence: Long,
        pageable: Pageable
    ): List<SyncOutboxMessage>

    fun findBySourceContextAndSourceReadModelAndSequenceGreaterThanOrderBySequenceAsc(
        sourceContext: String,
        sourceReadModel: String,
        sequence: Long,
        pageable: Pageable
    ): List<SyncOutboxMessage>

    fun existsByChannelAndMessageKeyAndEventIdAndOperation(
        channel: String,
        messageKey: String,
        eventId: String,
        operation: String
    ): Boolean

    fun existsBySourceContextAndSourceReadModelAndMessageKeyAndEventIdAndOperation(
        sourceContext: String,
        sourceReadModel: String,
        messageKey: String,
        eventId: String,
        operation: String
    ): Boolean

    fun findFirstByChannelOrderBySequenceDesc(channel: String): SyncOutboxMessage?

    fun findFirstBySourceContextAndSourceReadModelOrderBySequenceDesc(
        sourceContext: String,
        sourceReadModel: String
    ): SyncOutboxMessage?

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
        """
        select message from SyncOutboxMessage message
        where message.channel = :channel
          and (message.status is null or message.status = :status)
          and (message.availableAt is null or message.availableAt <= :availableAt)
        order by message.sequence asc
        """
    )
    fun findAvailableForClaim(
        @Param("channel") channel: String,
        @Param("status") status: String,
        @Param("availableAt") availableAt: LocalDateTime,
        pageable: Pageable
    ): List<SyncOutboxMessage>

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
        """
        select message from SyncOutboxMessage message
        where message.channel = :channel
          and message.status = :status
          and message.claimedUntil <= :claimedUntil
        order by message.sequence asc
        """
    )
    fun findExpiredClaimsForClaim(
        @Param("channel") channel: String,
        @Param("status") status: String,
        @Param("claimedUntil") claimedUntil: LocalDateTime,
        pageable: Pageable
    ): List<SyncOutboxMessage>

    fun deleteByStatusAndProcessedAtBefore(status: String, processedAt: LocalDateTime): Long
}

@Component
class SyncOutboxAppender(
    private val repository: SyncOutboxRepository,
    private val objectMapper: ObjectMapper
) {
    private val log = LoggerFactory.getLogger(javaClass)

    fun appendReadModel(
        sourceContext: String,
        sourceReadModel: String,
        readModelKey: String,
        operation: String,
        payload: Any,
        message: EventMessage
    ) {
        val eventId = message.identifier()
        if (repository.existsBySourceContextAndSourceReadModelAndMessageKeyAndEventIdAndOperation(
                sourceContext,
                sourceReadModel,
                readModelKey,
                eventId,
                operation
            )
        ) {
            log.debug(
                "SYNC OUTBOX skip duplicate source={}.{} key={} operation={} eventId={}",
                sourceContext,
                sourceReadModel,
                readModelKey,
                operation,
                eventId
            )
            return
        }
        append(
            channel = syncReadModelChannel(sourceContext, sourceReadModel),
            sourceContext = sourceContext,
            sourceReadModel = sourceReadModel,
            messageKey = readModelKey,
            operation = operation,
            payload = payload,
            message = message,
            eventId = eventId
        )
    }

    fun append(
        channel: String,
        sourceContext: String,
        sourceReadModel: String,
        messageKey: String,
        operation: String,
        payload: Any,
        message: EventMessage,
        eventId: String = message.identifier(),
        headers: Map<String, Any?> = emptyMap()
    ) {
        if (repository.existsByChannelAndMessageKeyAndEventIdAndOperation(
                channel,
                messageKey,
                eventId,
                operation
            )
        ) {
            log.debug(
                "SYNC OUTBOX skip duplicate channel={} key={} operation={} eventId={}",
                channel,
                messageKey,
                operation,
                eventId
            )
            return
        }
        val saved = repository.save(SyncOutboxMessage().also {
            it.channel = channel
            it.sourceContext = sourceContext
            it.sourceReadModel = sourceReadModel
            it.messageKey = messageKey
            it.operation = operation
            it.eventId = eventId
            it.eventType = message.type().toString()
            it.occurredAt = LocalDateTime.ofInstant(message.timestamp(), ZoneOffset.UTC)
            it.payloadJson = objectMapper.writeValueAsString(payload)
            it.headersJson = objectMapper.writeValueAsString(headers)
        })
        log.info(
            "SYNC OUTBOX stored sequence={} channel={} source={}.{} key={} operation={} eventId={} eventType={}",
            saved.sequence,
            saved.channel,
            saved.sourceContext,
            saved.sourceReadModel,
            saved.messageKey,
            saved.operation,
            saved.eventId,
            saved.eventType
        )
    }
}

@Component
class SyncOutboxQueue(
    private val repository: SyncOutboxRepository
) {
    @Transactional
    fun claimAvailable(
        channel: String,
        consumerId: String,
        batchSize: Int,
        claimTimeout: Duration = Duration.ofMinutes(5)
    ): List<SyncOutboxMessage> {
        val now = LocalDateTime.now()
        val limit = PageRequest.of(0, batchSize.coerceIn(1, 1000))
        val available = repository.findAvailableForClaim(
            channel,
            SyncOutboxStatus.AVAILABLE,
            now,
            limit
        )
        val expired = repository.findExpiredClaimsForClaim(
            channel,
            SyncOutboxStatus.PROCESSING,
            now,
            limit
        )
        val claimed = (available + expired)
            .distinctBy { it.sequence }
            .take(batchSize.coerceIn(1, 1000))
            .onEach {
                it.status = SyncOutboxStatus.PROCESSING
                it.claimedBy = consumerId
                it.claimedUntil = now.plus(claimTimeout)
                it.lastError = null
            }
        return repository.saveAll(claimed).toList()
    }

    @Transactional
    fun markProcessed(sequence: Long) {
        repository.findById(sequence).ifPresent {
            it.status = SyncOutboxStatus.PROCESSED
            it.processedAt = LocalDateTime.now()
            it.claimedBy = null
            it.claimedUntil = null
            repository.save(it)
        }
    }

    @Transactional
    fun markFailed(sequence: Long, error: String?, maxRetries: Int = 10, retryDelay: Duration = Duration.ofSeconds(30)) {
        repository.findById(sequence).ifPresent {
            val nextRetryCount = (it.retryCount ?: 0) + 1
            it.retryCount = nextRetryCount
            it.lastError = error?.take(4000)
            it.claimedBy = null
            it.claimedUntil = null
            if (nextRetryCount >= maxRetries) {
                it.status = SyncOutboxStatus.FAILED
            } else {
                it.status = SyncOutboxStatus.AVAILABLE
                it.availableAt = LocalDateTime.now().plus(retryDelay)
            }
            repository.save(it)
        }
    }

    @Transactional
    fun purgeProcessedBefore(cutoff: LocalDateTime): Long =
        repository.deleteByStatusAndProcessedAtBefore(SyncOutboxStatus.PROCESSED, cutoff)
}

fun syncReadModelChannel(sourceContext: String, sourceReadModel: String): String =
    "readmodel.$sourceContext.$sourceReadModel"
`);
        this.fs.write(this._sharedKernelKotlinPath(`${basePath}/SyncReadModelRegistry.kt`), `package ${basePackage}

import org.springframework.stereotype.Component

@Component
class SyncReadModelRegistry(targets: List<SyncReadModelTarget>) {
    val targets: List<SyncReadModelTarget> = targets.sortedBy { it.name }
}
`);
        this.fs.write(this._sharedKernelKotlinPath(`${basePath}/SyncValueConverters.kt`), `package ${basePackage}

import java.math.BigDecimal
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.util.UUID

object SyncValueConverters {
    fun required(value: String?, target: String, field: String): String =
        value ?: throw IllegalArgumentException("Sync target $target requires field $field")

    fun required(value: Int?, target: String, field: String): Int =
        value ?: throw IllegalArgumentException("Sync target $target requires field $field")

    fun required(value: Long?, target: String, field: String): Long =
        value ?: throw IllegalArgumentException("Sync target $target requires field $field")

    fun required(value: Boolean?, target: String, field: String): Boolean =
        value ?: throw IllegalArgumentException("Sync target $target requires field $field")

    fun required(value: BigDecimal?, target: String, field: String): BigDecimal =
        value ?: throw IllegalArgumentException("Sync target $target requires field $field")

    fun required(value: UUID?, target: String, field: String): UUID =
        value ?: throw IllegalArgumentException("Sync target $target requires field $field")

    fun required(value: LocalDate?, target: String, field: String): LocalDate =
        value ?: throw IllegalArgumentException("Sync target $target requires field $field")

    fun required(value: LocalDateTime?, target: String, field: String): LocalDateTime =
        value ?: throw IllegalArgumentException("Sync target $target requires field $field")

    fun string(value: Any?): String? = value?.toString()

    fun int(value: Any?): Int? = when (value) {
        is Int -> value
        is Number -> value.toInt()
        is String -> value.takeIf { it.isNotBlank() }?.toInt()
        else -> null
    }

    fun long(value: Any?): Long? = when (value) {
        is Long -> value
        is Number -> value.toLong()
        is String -> value.takeIf { it.isNotBlank() }?.toLong()
        else -> null
    }

    fun decimal(value: Any?): BigDecimal? = when (value) {
        is BigDecimal -> value
        is Number -> BigDecimal.valueOf(value.toDouble())
        is String -> value.takeIf { it.isNotBlank() }?.let(::BigDecimal)
        else -> null
    }

    fun boolean(value: Any?): Boolean? = when (value) {
        is Boolean -> value
        is String -> value.takeIf { it.isNotBlank() }?.toBooleanStrictOrNull()
        else -> null
    }

    fun uuid(value: Any?): UUID? = when (value) {
        is UUID -> value
        is String -> value.takeIf { it.isNotBlank() }?.let(UUID::fromString)
        else -> null
    }

    fun localDate(value: Any?): LocalDate? = when (value) {
        is LocalDate -> value
        is String -> value.takeIf { it.isNotBlank() }?.let(LocalDate::parse)
        else -> null
    }

    fun localDateTime(value: Any?): LocalDateTime? = when (value) {
        is LocalDateTime -> value
        is OffsetDateTime -> value.toLocalDateTime()
        is String -> value.takeIf { it.isNotBlank() }?.let {
            runCatching { LocalDateTime.parse(it) }.getOrElse { _ -> OffsetDateTime.parse(it).toLocalDateTime() }
        }
        else -> null
    }

    fun stringList(value: Any?): List<String> = when (value) {
        is Iterable<*> -> value.mapNotNull { it?.toString() }
        is Array<*> -> value.mapNotNull { it?.toString() }
        is String -> if (value.isBlank()) emptyList() else value.split(",").map { it.trim() }.filter { it.isNotBlank() }
        else -> emptyList()
    }
}
`);
        this.fs.write(this._sharedKernelKotlinPath(`${basePath}/HttpPullSyncReadModelAdapter.kt`), `package ${basePackage}

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient
import org.springframework.web.util.UriComponentsBuilder

@Component
class HttpPullSyncReadModelAdapter(
    private val properties: SyncReadModelProperties,
    restClientBuilder: RestClient.Builder,
    private val objectMapper: ObjectMapper
) : SyncReadModelAdapter {
    private val restClient: RestClient = restClientBuilder.build()
    private val mapType = object : TypeReference<Map<String, Any?>>() {}

    override fun supports(mode: String): Boolean =
        mode.equals("pull-http", ignoreCase = true)

    override fun syncOnce(target: SyncReadModelTarget, checkpoint: SyncReadModelCheckpoint?): SyncReadModelResult {
        val sourceBaseUrl = properties.sourceBaseUrlFor(target)
        if (sourceBaseUrl.isBlank()) {
            throw IllegalStateException("Sync target \${target.name} requires medol.sync.source-base-url")
        }

        var cursor: String? = null
        var count = 0
        val syncedAt = java.time.LocalDateTime.now()

        do {
            val uriBuilder = UriComponentsBuilder
                .fromHttpUrl(sourceBaseUrl)
                .path(target.sourcePath)
                .queryParam("size", properties.pageSize)
            val context = SyncReadModelContext(properties, checkpoint)
            target.queryParameters(context).forEach { (name, value) -> uriBuilder.queryParam(name, value) }
            checkpoint?.lastSuccessfulSyncedAt?.let { uriBuilder.queryParam("updatedAfter", it) }
            cursor?.let { uriBuilder.queryParam("cursor", it) }

            val response = restClient.get()
                .uri(uriBuilder.toUriString())
                .retrieve()
                .body(JsonNode::class.java)

            val items = response.itemsNode()
            items.forEach { item ->
                target.upsert(objectMapper.convertValue(item, mapType), syncedAt)
                count += 1
            }
            cursor = response?.get("nextCursor")?.takeIf { !it.isNull }?.asText()
        } while (!cursor.isNullOrBlank())

        return SyncReadModelResult(target.name, count, cursor)
    }

    private fun JsonNode?.itemsNode(): Iterable<JsonNode> {
        if (this == null || this.isNull) return emptyList()
        val items = this.get("items") ?: this.get("content") ?: this
        return if (items.isArray) items.toList() else emptyList()
    }
}
`);
        this.fs.write(this._sharedKernelKotlinPath(`${basePath}/OutboxDeltaSyncReadModelAdapter.kt`), `package ${basePackage}

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient
import org.springframework.web.util.UriComponentsBuilder
import java.time.LocalDateTime

@Component
class OutboxDeltaSyncReadModelAdapter(
    private val properties: SyncReadModelProperties,
    restClientBuilder: RestClient.Builder,
    private val objectMapper: ObjectMapper
) : SyncReadModelAdapter {
    private val log = LoggerFactory.getLogger(javaClass)
    private val restClient: RestClient = restClientBuilder.build()
    private val mapType = object : TypeReference<Map<String, Any?>>() {}

    override fun supports(mode: String): Boolean =
        mode.equals("outbox-delta", ignoreCase = true)

    override fun syncOnce(target: SyncReadModelTarget, checkpoint: SyncReadModelCheckpoint?): SyncReadModelResult {
        val sourceBaseUrl = properties.sourceBaseUrlFor(target)
        if (sourceBaseUrl.isBlank()) {
            throw IllegalStateException("Sync target \${target.name} requires medol.sync.source-base-url")
        }

        var count = 0
        val context = SyncReadModelContext(properties, checkpoint)
        val queryParameters = target.queryParameters(context)
        var bootstrapHighWatermark: Long? = null
        if (checkpoint?.bootstrapCompleted != true) {
            var cursor: String? = null
            do {
                val snapshotUriBuilder = UriComponentsBuilder
                    .fromHttpUrl(sourceBaseUrl)
                    .path(target.sourcePath)
                    .queryParam("size", properties.pageSize)
                cursor?.takeIf { it.isNotBlank() }?.let { snapshotUriBuilder.queryParam("cursor", it) }
                queryParameters.forEach { (name, value) -> snapshotUriBuilder.queryParam(name, value) }

                log.debug(
                    "SYNC READMODEL snapshot pull target={} path={} cursor={} parameters={}",
                    target.name,
                    target.sourcePath,
                    cursor,
                    queryParameters
                )

                val snapshotResponse = restClient.get()
                    .uri(snapshotUriBuilder.toUriString())
                    .retrieve()
                    .body(JsonNode::class.java)

                val snapshotSyncedAt = LocalDateTime.now()
                val snapshotItems = snapshotResponse.itemsNode().toList()
                snapshotItems.forEach { item ->
                    target.upsert(objectMapper.convertValue(item, mapType), snapshotSyncedAt)
                    count += 1
                }
                bootstrapHighWatermark = snapshotResponse?.get("highWatermarkSequence")?.takeIf { !it.isNull }?.asLong()
                    ?: bootstrapHighWatermark
                cursor = snapshotResponse?.get("nextCursor")?.takeIf { !it.isNull }?.asText()
                if (snapshotItems.isNotEmpty()) {
                    log.info(
                        "SYNC READMODEL snapshot stored target={} itemCount={} highWatermarkSequence={} nextCursor={}",
                        target.name,
                        snapshotItems.size,
                        bootstrapHighWatermark,
                        cursor
                    )
                } else {
                    log.debug(
                        "SYNC READMODEL snapshot empty target={} highWatermarkSequence={} nextCursor={}",
                        target.name,
                        bootstrapHighWatermark,
                        cursor
                    )
                }
            } while (!cursor.isNullOrBlank())
        }

        val afterSequence = bootstrapHighWatermark ?: checkpoint?.lastSequence ?: 0
        val uriBuilder = UriComponentsBuilder
            .fromHttpUrl(sourceBaseUrl)
            .path(target.deltaPath)
            .queryParam("afterSequence", afterSequence)
            .queryParam("size", properties.pageSize)

        queryParameters.forEach { (name, value) -> uriBuilder.queryParam(name, value) }

        log.debug(
            "SYNC READMODEL delta pull target={} path={} afterSequence={} parameters={}",
            target.name,
            target.deltaPath,
            afterSequence,
            queryParameters
        )

        val response = restClient.get()
            .uri(uriBuilder.toUriString())
            .retrieve()
            .body(JsonNode::class.java)

        val syncedAt = LocalDateTime.now()
        val deltaItems = response.itemsNode().toList()
        var storedDeltaCount = 0
        deltaItems.forEach { item ->
            val operation = item.get("operation")?.asText() ?: "UPSERT"
            if (operation.equals("UPSERT", ignoreCase = true)) {
                val payload = item.get("payload") ?: item
                target.upsert(objectMapper.convertValue(payload, mapType), syncedAt)
                count += 1
                storedDeltaCount += 1
            }
        }

        val nextSequence = response?.get("nextSequence")?.takeIf { !it.isNull }?.asLong()
            ?: checkpoint?.lastSequence
        if (deltaItems.isNotEmpty()) {
            log.info(
                "SYNC READMODEL delta stored target={} pulledItemCount={} storedItemCount={} afterSequence={} nextSequence={}",
                target.name,
                deltaItems.size,
                storedDeltaCount,
                afterSequence,
                nextSequence
            )
        } else {
            log.debug(
                "SYNC READMODEL delta empty target={} afterSequence={} nextSequence={}",
                target.name,
                afterSequence,
                nextSequence
            )
        }
        return SyncReadModelResult(target.name, count, nextSequence = nextSequence)
    }

    private fun JsonNode?.itemsNode(): Iterable<JsonNode> {
        if (this == null || this.isNull) return emptyList()
        val items = this.get("items") ?: this.get("content") ?: this
        return if (items.isArray) items.toList() else emptyList()
    }
}
`);
        this.fs.write(this._sharedKernelKotlinPath(`${basePath}/SyncReadModelScheduler.kt`), `package ${basePackage}

import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.LocalDateTime

@Component
class SyncReadModelScheduler(
    private val properties: SyncReadModelProperties,
    private val registry: SyncReadModelRegistry,
    private val adapters: List<SyncReadModelAdapter>,
    private val checkpoints: SyncReadModelCheckpointRepository,
    transactionManager: PlatformTransactionManager
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val transactions = TransactionTemplate(transactionManager)

    @Scheduled(fixedDelayString = "\\\${medol.sync.fixed-delay-ms:30000}")
    fun syncAll() {
        if (!properties.enabled || registry.targets.isEmpty()) return
        val adapter = adapters.firstOrNull { it.supports(properties.mode) }
        if (adapter == null) {
            log.warn("No sync read model adapter supports mode={}", properties.mode)
            return
        }

        registry.targets.forEach { target ->
            transactions.executeWithoutResult {
                syncTarget(adapter, target)
            }
        }
    }

    private fun syncTarget(adapter: SyncReadModelAdapter, target: SyncReadModelTarget) {
        val checkpoint = checkpoints.findById(target.name).orElseGet {
            SyncReadModelCheckpoint().also {
                it.target = target.name
                it.source = target.source
            }
        }
        checkpoint.lastAttemptedAt = LocalDateTime.now()
        log.debug(
            "SYNC READMODEL target start target={} source={} mode={} bootstrapCompleted={} lastSequence={}",
            target.name,
            target.source,
            properties.mode,
            checkpoint.bootstrapCompleted,
            checkpoint.lastSequence
        )
        try {
            val result = adapter.syncOnce(target, checkpoint)
            checkpoint.lastSuccessfulSyncedAt = LocalDateTime.now()
            checkpoint.lastStatus = "SYNCED"
            checkpoint.lastError = null
            checkpoint.syncedItemCount = result.itemCount
            checkpoint.lastCursor = result.nextCursor ?: checkpoint.lastCursor
            checkpoint.lastSequence = result.nextSequence ?: checkpoint.lastSequence
            checkpoint.bootstrapCompleted = true
        } catch (ex: Exception) {
            checkpoint.lastStatus = "FAILED"
            checkpoint.lastError = ex.message
            log.warn("Sync read model target={} failed", target.name, ex)
        }
        checkpoints.save(checkpoint)
        log.debug(
            "SYNC READMODEL checkpoint stored target={} status={} itemCount={} lastSequence={} bootstrapCompleted={}",
            target.name,
            checkpoint.lastStatus,
            checkpoint.syncedItemCount,
            checkpoint.lastSequence,
            checkpoint.bootstrapCompleted
        )
    }
}
`);
    },

    _writeSyncReadModelRegistration(packageName, context, slicePackage, readmodel, name, idFields) {
        const id = idFields[0];
        if (!id || idFields.length !== 1 || !readmodel.syncSource) {
            return;
        }
        const sourceParts = String(readmodel.syncSource).split('.').filter(Boolean);
        const sourceContext = sourceParts.length > 1 ? sourceParts.slice(0, -1).join('.') : '';
        const sourceReadModel = sourceParts.at(-1) ?? readmodel.syncSource;
        const beanName = `${lowerFirst(name)}SyncTarget`;
        const targetName = readmodel.name ?? readmodel.title;
        const sourceReadModelDefinition = this._findSyncSourceReadModel(readmodel.syncSource);
        const idSource = syncSourceFieldName(id, sourceReadModelDefinition);
        if (!idSource) {
            return;
        }
        const idExpression = syncValueExpression(id, `row["${idSource}"]`, 'targetName');
        const assignments = (readmodel.fields ?? [])
            .filter((field) => field.name !== id.name)
            .map((field) => syncProjectionAssignment(field, sourceReadModelDefinition))
            .filter(Boolean)
            .join('\n');
        const fieldMappings = (readmodel.fields ?? [])
            .map((field) => [field.name, syncSourceFieldName(field, sourceReadModelDefinition)])
            .filter(([, source]) => source)
            .map(([target, source]) => `            "${target}" to "${source}"`)
            .join(',\n');
        const queryParameters = syncQueryParameters(readmodel);
        const sourcePath = `/sync/read-models/${kebab(sourceContext)}/${kebab(sourceReadModel)}`;

        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${name}SyncRegistration.kt`), `package ${packageName}

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import ${this.model.rootPackage}.shared.application.sync.SyncReadModelTarget
import ${this.model.rootPackage}.shared.application.sync.SyncValueConverters

@Configuration
class ${name}SyncRegistration {
    @Bean
    fun ${beanName}(repository: ${name}Repository): SyncReadModelTarget {
        val targetName = "${targetName}"
        return SyncReadModelTarget(
            name = targetName,
            source = "${readmodel.syncSource}",
            sourceContext = "${sourceContext}",
            sourceReadModel = "${sourceReadModel}",
            sourcePath = "${sourcePath}",
            fieldMappings = mapOf(
${fieldMappings}
            ),
            queryParameters = { context ->
                mapOf(
${queryParameters}
                )
            },
            upsert = { row, syncedAt ->
                val id = ${idExpression}
                val projection = repository.findProjectionById(id) ?: ${name}Projection()
                projection.${id.name} = id
${assignments}
                repository.save(projection)
            }
        )
    }
}
`);
    },

    _findSyncSourceReadModel(syncSource) {
        const parts = String(syncSource ?? '').split('.').filter(Boolean);
        const sourceReadModel = parts.at(-1);
        const sourceContext = parts.length > 1 ? parts.slice(0, -1).join('.') : undefined;
        if (!sourceReadModel) {
            return undefined;
        }
        const model = this.fullModel ?? this.model;
        for (const slice of model?.slices ?? []) {
            const match = (slice.readmodels ?? []).find((candidate) =>
                (candidate.name === sourceReadModel || candidate.title === sourceReadModel)
                && (!sourceContext || slice.context === sourceContext || slice.boundedContext === sourceContext)
            );
            if (match) {
                return match;
            }
        }
        for (const slice of model?.slices ?? []) {
            const match = (slice.readmodels ?? []).find((candidate) =>
                candidate.name === sourceReadModel || candidate.title === sourceReadModel
            );
            if (match) {
                return match;
            }
        }
        return undefined;
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
        const readModelPermission = permissionCode(readmodel.name ?? readmodel.title);
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
import org.springframework.security.access.prepost.PreAuthorize
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
    @PreAuthorize("hasAuthority('*:*') or hasAuthority('${readModelPermission}:list') or hasAuthority('${readModelPermission}:read')")
    @GetMapping
    fun findAll(
${findAllParameters}
    ): Page<${name}> =
        repository.findAllByCriteria(criteria, pageable)

${idFields.length === 1 ? `
    @PreAuthorize("hasAuthority('*:*') or hasAuthority('${readModelPermission}:read')")
    @GetMapping("/{id}")
    fun findOne(@PathVariable id: ${idType}): ResponseEntity<${name}> =
        repository.findById(id)?.let { ResponseEntity.ok(it) } ?: ResponseEntity.notFound().build()
` : ''}
}
`);
        if (this._isSyncReadModelSource(slice, readmodel)) {
            this._writeSyncReadModelSourceResource(packageName, context, slicePackage, slice, readmodel, name);
        }
    },

    _isSyncReadModelSource(slice, readmodel) {
        const currentContext = slice.context ?? slice.boundedContext ?? '';
        const currentReadModelNames = [
            readmodel.name,
            readmodel.title
        ].filter(Boolean);
        const sourceNames = currentReadModelNames.map((readModelName) => `${currentContext}.${readModelName}`);
        const fullModel = this.fullModel ?? this.model;
        return (fullModel.slices ?? []).some((candidateSlice) =>
            (candidateSlice.readmodels ?? []).some((candidateReadModel) =>
                candidateReadModel.sync && (
                    sourceNames.includes(candidateReadModel.syncSource)
                    || currentReadModelNames.includes(String(candidateReadModel.syncSource ?? '').split('.').filter(Boolean).at(-1))
                )
            )
        );
    },

    _writeSyncReadModelSourceResource(packageName, context, slicePackage, slice, readmodel, name) {
        const repositoryName = `${name}Repository`;
        const resourceName = `${name}SyncReadModelResource`;
        const sourceAlias = this._syncSourceAliasForReadModel(slice, readmodel);
        const sourceContext = sourceAlias?.context ?? slice.context ?? slice.boundedContext ?? context;
        const sourceReadModel = sourceAlias?.readModel ?? readmodel.name ?? readmodel.title;
        const sourcePath = `/sync/read-models/${kebab(sourceContext)}/${kebab(readmodel.name ?? readmodel.title)}`;
        const readModelPermission = permissionCode(readmodel.name ?? readmodel.title);

        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${resourceName}.kt`), `package ${packageName}

import org.springframework.data.domain.PageRequest
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.CrossOrigin
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import ${this.model.rootPackage}.shared.application.sync.SyncOutboxRepository

@CrossOrigin
@RestController
@RequestMapping("${sourcePath}")
class ${resourceName}(
    private val repository: ${repositoryName},
    private val outboxRepository: SyncOutboxRepository,
    private val objectMapper: ObjectMapper
) {
    private val mapType = object : TypeReference<Map<String, Any?>>() {}

    @PreAuthorize("hasAuthority('*:*') or hasAuthority('${readModelPermission}:list') or hasAuthority('${readModelPermission}:read')")
    @GetMapping
    fun findAllForSync(
        @RequestParam(defaultValue = "200") size: Int,
        @RequestParam(required = false) cursor: String?,
        @RequestParam parameters: Map<String, String>
    ): Map<String, Any?> {
        val reserved = setOf("afterSequence", "size", "cursor")
        val filters = parameters.filterKeys { it !in reserved }
        val pageNumber = cursor?.toIntOrNull()?.coerceAtLeast(0) ?: 0
        val page = repository.findAllByCriteria(null, PageRequest.of(pageNumber, size.coerceIn(1, 1000)))
        val highWatermark = outboxRepository
            .findFirstBySourceContextAndSourceReadModelOrderBySequenceDesc("${sourceContext}", "${sourceReadModel}")
            ?.sequence ?: 0
        val items = page.content.mapNotNull { item ->
            val payload = objectMapper.convertValue(item, mapType)
            if (filters.any { (name, value) -> payload[name]?.toString() != value }) {
                null
            } else {
                payload
            }
        }
        return mapOf(
            "items" to items,
            "nextCursor" to if (page.hasNext()) (pageNumber + 1).toString() else null,
            "highWatermarkSequence" to highWatermark
        )
    }

    @PreAuthorize("hasAuthority('*:*') or hasAuthority('${readModelPermission}:list') or hasAuthority('${readModelPermission}:read')")
    @GetMapping("/deltas")
    fun findDeltasForSync(
        @RequestParam(defaultValue = "0") afterSequence: Long,
        @RequestParam(defaultValue = "200") size: Int,
        @RequestParam parameters: Map<String, String>
    ): Map<String, Any?> {
        val reserved = setOf("afterSequence", "size", "cursor")
        val filters = parameters.filterKeys { it !in reserved }
        val rows = outboxRepository
            .findBySourceContextAndSourceReadModelAndSequenceGreaterThanOrderBySequenceAsc(
                "${sourceContext}",
                "${sourceReadModel}",
                afterSequence,
                PageRequest.of(0, size.coerceIn(1, 1000))
            )
        val items = rows.mapNotNull { row ->
            val payload = objectMapper.readValue(row.payloadJson, mapType)
            if (filters.any { (name, value) -> payload[name]?.toString() != value }) {
                null
            } else {
                mapOf(
                    "sequence" to row.sequence,
                    "operation" to row.operation,
                    "channel" to row.channel,
                    "sourceContext" to row.sourceContext,
                    "sourceReadModel" to row.sourceReadModel,
                    "readModelKey" to row.messageKey,
                    "eventId" to row.eventId,
                    "eventType" to row.eventType,
                    "occurredAt" to row.occurredAt,
                    "payload" to payload
                )
            }
        }
        return mapOf(
            "items" to items,
            "nextSequence" to (rows.lastOrNull()?.sequence ?: afterSequence)
        )
    }
}
`);
    },

    _syncSourceAliasForReadModel(slice, readmodel) {
        const currentContext = slice.context ?? slice.boundedContext ?? '';
        const currentReadModelNames = [
            readmodel.name,
            readmodel.title
        ].filter(Boolean);
        const fullModel = this.fullModel ?? this.model;
        const exact = (fullModel.slices ?? [])
            .flatMap((candidateSlice) => candidateSlice.readmodels ?? [])
            .find((candidateReadModel) =>
                candidateReadModel.sync
                && currentReadModelNames
                    .map((readModelName) => `${currentContext}.${readModelName}`)
                    .includes(candidateReadModel.syncSource)
            );
        const fallback = exact ?? (fullModel.slices ?? [])
            .flatMap((candidateSlice) => candidateSlice.readmodels ?? [])
            .find((candidateReadModel) =>
                candidateReadModel.sync
                && currentReadModelNames.includes(String(candidateReadModel.syncSource ?? '').split('.').filter(Boolean).at(-1))
            );
        const parts = String(fallback?.syncSource ?? '').split('.').filter(Boolean);
        if (parts.length === 0) {
            return undefined;
        }
        return {
            context: parts.length > 1 ? parts.slice(0, -1).join('.') : currentContext,
            readModel: parts.at(-1)
        };
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
        const syncSource = this._isSyncReadModelSource(slice, readmodel);
        const sourceAlias = this._syncSourceAliasForReadModel(slice, readmodel);
        const sourceContext = sourceAlias?.context ?? slice.context ?? slice.boundedContext ?? context;
        const sourceReadModel = sourceAlias?.readModel ?? readmodel.name ?? readmodel.title;
        const includeEventTime = events.some((event) =>
            this._readModelConventionalAssignments(readmodel, event, new Set()).some((assignment) => assignment.usesEventTime)
        );
        const metadataAssignments = readModelMetadataAssignments(metadataFields, '            ');
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
        const updaterHandlers = events.map((event) => {
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
            const appendOutbox = (keyExpression, indent = '        ') => syncSource
                ? `
${indent}outbox.appendReadModel(
${indent}    sourceContext = "${sourceContext}",
${indent}    sourceReadModel = "${sourceReadModel}",
${indent}    readModelKey = ${keyExpression}.toString(),
${indent}    operation = "UPSERT",
${indent}    payload = entity.toReadModel(),
${indent}    message = message
${indent})`
                : '';

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
                return `    @Transactional
    open override fun update(
        event: ${_eventTitle(event.title)},
        message: EventMessage
    ) {
${keyGuard}
        val entity = repository.findProjectionById(${keyExpression}) ?: ${name}Projection().apply {
${initializeIds}
        }
${saveAssignments || '        // No read-model fields are present on this event.'}
        repository.save(entity)
${appendOutbox(keyExpression)}
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
                const readModelKey = idFields
                    .map((field) => `entity.${field.name}`)
                    .join(' + ":" + ');
                return `    @Transactional
    open override fun update(
        event: ${_eventTitle(event.title)},
        message: EventMessage
    ) {
${lookupGuard}
        repository.findProjectionsBy${pascal(lookupField.name)}(${lookupExpression}).forEach { entity ->
${saveAssignments || '            // No read-model fields are present on this event.'}
            repository.save(entity)
${appendOutbox(readModelKey, '            ')}
        }
    }`;
            }

            return `    open override fun update(
        event: ${_eventTitle(event.title)},
        message: EventMessage
    ) {
        // Skipped: ${_eventTitle(event.title)} does not provide enough key fields to locate ${name}Projection.
    }`;
        }).join('\n\n');
        const interfaceMethods = events.map((event) => `    fun update(
        event: ${_eventTitle(event.title)},
        message: EventMessage
    )`).join('\n\n');
        const eventHandlers = events.map((event) => `    @EventHandler
    fun on(
        event: ${_eventTitle(event.title)},
        message: EventMessage
    ) {
        updater.update(event, message)
    }`).join('\n\n');

        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${name}Projector.kt`), `package ${packageName}

import org.axonframework.messaging.eventhandling.annotation.EventHandler
import org.axonframework.messaging.eventhandling.EventMessage
import org.axonframework.messaging.core.annotation.Namespace
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
${includeMetadata ? `import ${this.model.rootPackage}.shared.application.metadata.ProjectionMetadata\n` : ''}
${syncSource ? `import ${this.model.rootPackage}.shared.application.sync.SyncOutboxAppender\n` : ''}
${eventImports}
${stateImports}
${includeEventTime ? 'import java.time.LocalDateTime\nimport java.time.ZoneOffset\n' : ''}

interface ${name}ProjectionUpdater {
${interfaceMethods}
}

open class Default${name}ProjectionUpdater(
    private val repository: ${repositoryName}${syncSource ? ',\n    private val outbox: SyncOutboxAppender' : ''}
) : ${name}ProjectionUpdater {
${updaterHandlers}
${includeEventTime ? `
    private fun eventTime(message: EventMessage): LocalDateTime =
        LocalDateTime.ofInstant(message.timestamp(), ZoneOffset.UTC)
` : ''}
}

@Configuration(proxyBeanMethods = false)
class ${name}ProjectionUpdaterConfiguration {
    @Bean
    @ConditionalOnMissingBean(${name}ProjectionUpdater::class)
    fun default${name}ProjectionUpdater(
        repository: ${repositoryName}${syncSource ? ',\n        outbox: SyncOutboxAppender' : ''}
    ): ${name}ProjectionUpdater =
        Default${name}ProjectionUpdater(repository${syncSource ? ', outbox' : ''})
}

@Namespace("${readModelProcessingGroup(readmodel)}")
@Component
class ${name}Projector(
    private val updater: ${name}ProjectionUpdater
) {
${eventHandlers}
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

        for (const field of readmodel.fields ?? []) {
            if (field.cardinality !== 'Multiple' || assignedFieldNames.has(field.name)) {
                continue;
            }
            const eventField = singularFieldCandidates(field.name)
                .map((name) => eventFields.find((candidate) => candidate.name === name))
                .find((candidate) => candidate && conventionallyCompatibleReadModelField(field, candidate));
            if (!eventField) {
                continue;
            }
            if (eventField.optional) {
                addAssignment(
                    field,
                    `event.${eventField.name}?.let { entity.${field.name} = (entity.${field.name} + ${readModelStorageExpression({...field, cardinality: undefined}, 'it')}).distinct() }`
                );
            } else {
                addAssignment(
                    field,
                    `entity.${field.name} = (entity.${field.name} + ${readModelStorageExpression({...field, cardinality: undefined}, `event.${eventField.name}`)}).distinct()`
                );
            }
        }

        if (stateChange?.to && stateTransition?.from !== stateTransition?.to) {
            for (const field of readmodel.fields ?? []) {
                if (assignedFieldNames.has(field.name) || field.type !== 'Boolean' || field.cardinality === 'Multiple') {
                    continue;
                }
                const stateName = lowerCamel(stateChange.to);
                if (field.name.toLowerCase() === stateName.toLowerCase()) {
                    addAssignment(field, `entity.${field.name} = true`);
                    continue;
                }
                if (field.name.toLowerCase() !== 'active') {
                    continue;
                }
                const stateWords = semanticWords(stateChange.to);
                if (stateWords.some((word) => ['active', 'registered', 'enabled', 'created'].includes(word))) {
                    addAssignment(field, `entity.${field.name} = true`);
                } else if (stateWords.some((word) => ['deactivated', 'inactive', 'disabled', 'archived', 'suspended', 'retired', 'deleted'].includes(word))) {
                    addAssignment(field, `entity.${field.name} = false`);
                }
            }
        }

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

function lowerFirst(value) {
    const text = pascal(value);
    return text ? `${text.slice(0, 1).toLowerCase()}${text.slice(1)}` : 'syncTarget';
}

function syncSourceFieldName(field, sourceReadModel) {
    const source = field.source?.from?.[0];
    if (source) {
        return String(source).split('.').filter(Boolean).at(-1);
    }
    if (field.name === 'syncedAt' && field.type === 'DateTime') {
        return undefined;
    }
    const sourceFields = sourceReadModel?.fields ?? [];
    return sourceFields.some((candidate) => candidate.name === field.name) ? field.name : undefined;
}

function syncProjectionAssignment(field, sourceReadModel) {
    if (!field.source && field.name === 'syncedAt' && field.type === 'DateTime') {
        return `                projection.${field.name} = syncedAt`;
    }
    const source = syncSourceFieldName(field, sourceReadModel);
    if (!source) {
        return undefined;
    }
    return `                projection.${field.name} = ${syncValueExpression(field, `row["${source}"]`, 'targetName')}`;
}

function syncQueryParameters(readmodel) {
    return (readmodel.syncFilters ?? [])
        .map((filter) => {
            const target = String(filter.target ?? '').split('.').filter(Boolean).at(-1);
            const source = String(filter.source ?? '');
            const sourceParts = source.split('.').filter(Boolean);
            if (!target || sourceParts[0] !== 'sync' || !sourceParts[1]) {
                return undefined;
            }
            const parameter = sourceParts.slice(1).join('.');
            return `                    "${target}" to context.requiredParameter("${parameter}", targetName)`;
        })
        .filter(Boolean)
        .join(',\n');
}

function syncValueExpression(field, valueExpression, targetExpression) {
    const converted = syncOptionalValueExpression(field, valueExpression);
    if (field.optional || field.cardinality === 'Multiple') {
        return converted;
    }
    return `SyncValueConverters.required(${converted}, ${targetExpression}, "${field.name}")`;
}

function syncOptionalValueExpression(field, valueExpression) {
    if (field.cardinality === 'Multiple') {
        if (field.type === 'String') {
            return `SyncValueConverters.stringList(${valueExpression})`;
        }
        return `emptyList()`;
    }

    switch (field.type) {
        case 'UUID':
            return `SyncValueConverters.uuid(${valueExpression})`;
        case 'Int':
            return `SyncValueConverters.int(${valueExpression})`;
        case 'Long':
            return `SyncValueConverters.long(${valueExpression})`;
        case 'Decimal':
        case 'BigDecimal':
            return `SyncValueConverters.decimal(${valueExpression})`;
        case 'Boolean':
            return `SyncValueConverters.boolean(${valueExpression})`;
        case 'Date':
            return `SyncValueConverters.localDate(${valueExpression})`;
        case 'DateTime':
            return `SyncValueConverters.localDateTime(${valueExpression})`;
        default:
            return `SyncValueConverters.string(${valueExpression})`;
    }
}

module.exports = {readModelWriterMethods};
