/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const YeomanGenerator = require('yeoman-generator');
const Generator = YeomanGenerator.default ?? YeomanGenerator;
const path = require('path');
const {loadCodegenModel} = require('../../common/core/codegen-model-loader');
const {collectFieldOptionEnums, fieldOptionsFor} = require('../../common/core/field-options');
const {configureValueTypes, typeMapping, typeImports} = require('../../common/util/generator');
const {contextPackage, findValueType, resolvedBaseType, resolvedConstraints} = require('../../common/util/value-types');
const {_commandTitle, _eventTitle, _readmodelTitle, _sliceTitle} = require('../../common/util/naming');

module.exports = class extends Generator {
    constructor(args, opts) {
        super(args, opts);
        this.opts = opts ?? {};
        this.model = loadCodegenModel(this.env.cwd);
        this.modulePrefix = '';
        this.currentDeployment = null;
        this.currentDeploymentIndex = 0;
        this.eventStorageMode = String(this.opts.eventStorageMode ?? this.model.eventStorageMode ?? 'dcb').toLowerCase();
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
        if (!this.opts.allSlices && String(this.opts.generatorType ?? '').toLowerCase() === 'slices') {
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
                selectedSlices.forEach((slice) => this._writeSlice(slice));
                this._writeConceptEntityStates(selectedSlices);
            }
        }
    }

    _isMonoMode() {
        return !process.env.CODEGEN_DEPLOYMENT && (this.model.deployments ?? []).length > 1;
    }

    _writeMonoSkeleton() {
        const deployments = this.model.deployments ?? [];
        this.fs.copyTpl(this.templatePath('mono-pom.xml.tpl'), this.destinationPath('pom.xml'), {
            rootPackage: this.model.rootPackage,
            appName: kebab(this.model.domain) || 'medol-application',
            modules: deployments.map((deployment) => this._deploymentModuleName(deployment))
        });
        this.fs.copyTpl(this.templatePath('README.md.tpl'), this.destinationPath('README.md'), {
            appName: kebab(this.model.domain) || 'medol-application',
            domain: this.model.domain,
            rootPackage: this.model.rootPackage,
            appPort: 8080,
            dbPort: 5432,
            dbName: safeDatabaseName(kebab(this.model.domain) || 'medol-application'),
            modulePrefix: ''
        });
        this.fs.copy(this.templatePath('gitignore'), this.destinationPath('.gitignore'));
        this._copyMavenWrapper();
        this._writeDevSeedScript();
        this._writeAgentSkills();
        deployments.forEach((deployment) => this._withDeployment(deployment, () => this._writeSkeleton()));
    }

    _writeMonoSlices() {
        for (const deployment of this.model.deployments ?? []) {
            this._withDeployment(deployment, () => {
                const selected = this.answers.sliceNames ?? this.model.slices.map((slice) => slice.title);
                const selectedSlices = this.model.slices.filter((slice) => selected.includes(slice.title));
                selectedSlices.forEach((slice) => this._writeSlice(slice));
                this._writeConceptEntityStates(selectedSlices);
            });
        }
    }

    _withDeployment(deployment, write) {
        const previousModel = this.model;
        const previousPrefix = this.modulePrefix;
        const previousDeployment = this.currentDeployment;
        const previousDeploymentIndex = this.currentDeploymentIndex;
        const deploymentIndex = deployment.index ?? (previousModel.deployments ?? []).findIndex((candidate) => candidate.name === deployment.name);
        this.model = filterModelByDeployment(previousModel, deployment);
        this.modulePrefix = this._deploymentModuleName(deployment);
        this.currentDeployment = deployment;
        this.currentDeploymentIndex = deploymentIndex >= 0 ? deploymentIndex : 0;
        configureValueTypes(this.model.valueTypes, this.model.rootPackage, this.model.concepts);
        try {
            write();
        } finally {
            this.model = previousModel;
            this.modulePrefix = previousPrefix;
            this.currentDeployment = previousDeployment;
            this.currentDeploymentIndex = previousDeploymentIndex;
            configureValueTypes(this.model.valueTypes, this.model.rootPackage, this.model.concepts);
        }
    }

    _deploymentModuleName(deployment) {
        return kebab(deployment.name) || 'application';
    }

    _writeSkeleton() {
        const appName = kebab(this.model.domain) || 'medol-application';
        const applicationClass = `${pascal(this.model.domain)}Application`;
        const runtime = this._runtimeConfig(appName);
        this.fs.copyTpl(this.templatePath('pom.xml.tpl'), this._destPath('pom.xml'), {
            rootPackage: this.model.rootPackage,
            appName,
            appPort: runtime.appPort
        });
        this.fs.copyTpl(this.templatePath('Application.kt.tpl'), this._kotlinPath('Application.kt'), {
            rootPackage: this.model.rootPackage,
            applicationClass
        });
        this.fs.copyTpl(this.templatePath('README.md.tpl'), this._destPath('README.md'), {
            appName,
            domain: this.model.domain,
            rootPackage: this.model.rootPackage,
            modulePrefix: this.modulePrefix,
            appPort: runtime.appPort,
            dbPort: runtime.dbPort,
            dbName: runtime.dbName
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
        this._writeMetadataSupport();
        if (this.eventStorageMode === 'dcb') {
            this.fs.copyTpl(this.templatePath('AxonEventStorageConfig.kt.tpl'), this._kotlinPath('support/AxonEventStorageConfig.kt'), {
                rootPackage: this.model.rootPackage
            });
        }
        this.fs.copyTpl(this.templatePath('application.yml'), this._destPath('src/main/resources/application.yml'), runtime);
        this.fs.copyTpl(this.templatePath('docker-compose.yml'), this._destPath('docker-compose.yml'), runtime);
        this.fs.copy(this.templatePath('V1__baseline.sql'), this._destPath('src/main/resources/db/migration/V1__baseline.sql'));
        this.fs.copy(this.templatePath('gitignore'), this._destPath('.gitignore'));
        if (!this.modulePrefix) {
            this._copyMavenWrapper();
            this._writeDevSeedScript();
        }
        this._writeValueTypes();
        this._writeFieldOptionEnums();
        this._writeConceptStates();
        this._writeConceptCatalog();
        if (!this.modulePrefix) {
            this._writeAgentSkills();
        }
    }

    _writeMetadataSupport() {
        this.fs.write(this._kotlinPath('support/metadata/MetadataKeys.kt'), `package ${this.model.rootPackage}.support.metadata

object MetadataKeys {
    const val USER_ID = "userId"
    const val SESSION_ID = "sessionId"
    const val CORRELATION_ID = "correlationId"
    const val CAUSATION_ID = "causationId"
    const val TRACE_ID = "traceId"
    const val TENANT_ID = "tenantId"

    val PROPAGATED_KEYS = arrayOf(
        CORRELATION_ID,
        CAUSATION_ID,
        USER_ID,
        SESSION_ID,
        TRACE_ID,
        TENANT_ID
    )
}

object MetadataHeaders {
    const val USER_ID = "X-User-Id"
    const val SESSION_ID = "X-Session-Id"
    const val CORRELATION_ID = "X-Correlation-Id"
    const val CAUSATION_ID = "X-Causation-Id"
    const val TRACE_ID = "X-Trace-Id"
    const val TRACE_PARENT = "traceparent"
    const val TENANT_ID = "X-Tenant-Id"
}
`);
        this.fs.write(this._kotlinPath('support/metadata/MetadataFactory.kt'), `package ${this.model.rootPackage}.support.metadata

import jakarta.servlet.http.HttpServletRequest
import org.axonframework.messaging.core.Metadata
import java.util.UUID

object MetadataFactory {
    const val DEFAULT_USER_ID = "anonymous"

    fun from(request: HttpServletRequest): Metadata {
        val correlationId = header(request, MetadataHeaders.CORRELATION_ID) ?: UUID.randomUUID().toString()
        val values = linkedMapOf<String, String?>()

        put(values, MetadataKeys.USER_ID, header(request, MetadataHeaders.USER_ID) ?: request.userPrincipal?.name ?: DEFAULT_USER_ID)
        put(values, MetadataKeys.SESSION_ID, header(request, MetadataHeaders.SESSION_ID) ?: request.requestedSessionId ?: request.getSession(false)?.id ?: UUID.randomUUID().toString())
        put(values, MetadataKeys.CORRELATION_ID, correlationId)
        put(values, MetadataKeys.CAUSATION_ID, header(request, MetadataHeaders.CAUSATION_ID) ?: correlationId)
        put(values, MetadataKeys.TRACE_ID, header(request, MetadataHeaders.TRACE_ID) ?: traceIdFromTraceParent(request) ?: correlationId)
        put(values, MetadataKeys.TENANT_ID, header(request, MetadataHeaders.TENANT_ID))

        return Metadata.from(values)
    }

    fun fromValues(
        userId: String?,
        sessionId: String?,
        correlationId: String?,
        causationId: String?,
        traceId: String?,
        tenantId: String?
    ): Metadata {
        val resolvedCorrelationId = value(correlationId) ?: UUID.randomUUID().toString()
        val values = linkedMapOf<String, String?>()

        put(values, MetadataKeys.USER_ID, value(userId) ?: DEFAULT_USER_ID)
        put(values, MetadataKeys.SESSION_ID, value(sessionId) ?: UUID.randomUUID().toString())
        put(values, MetadataKeys.CORRELATION_ID, resolvedCorrelationId)
        put(values, MetadataKeys.CAUSATION_ID, value(causationId) ?: resolvedCorrelationId)
        put(values, MetadataKeys.TRACE_ID, value(traceId) ?: resolvedCorrelationId)
        put(values, MetadataKeys.TENANT_ID, value(tenantId))

        return Metadata.from(values)
    }

    fun value(value: String?): String? =
        value?.trim()?.takeIf { it.isNotEmpty() }

    private fun header(request: HttpServletRequest, name: String): String? =
        value(request.getHeader(name))

    private fun put(values: MutableMap<String, String?>, key: String, value: String?) {
        value?.let { values[key] = it }
    }

    private fun traceIdFromTraceParent(request: HttpServletRequest): String? =
        header(request, MetadataHeaders.TRACE_PARENT)
            ?.split("-")
            ?.getOrNull(1)
            ?.takeIf { it.length == 32 }
}
`);
        this.fs.write(this._kotlinPath('support/metadata/CorrelationConfig.kt'), `package ${this.model.rootPackage}.support.metadata

import org.axonframework.messaging.commandhandling.CommandMessage
import org.axonframework.messaging.core.correlation.MessageOriginProvider
import org.axonframework.messaging.core.correlation.SimpleCorrelationDataProvider
import org.axonframework.messaging.core.interception.CorrelationDataInterceptor
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration
class CorrelationConfig {
    @Bean
    fun metadataCorrelationDataProvider(): SimpleCorrelationDataProvider =
        SimpleCorrelationDataProvider(*MetadataKeys.PROPAGATED_KEYS)

    @Bean
    fun messageOriginProvider(): MessageOriginProvider =
        MessageOriginProvider(MetadataKeys.CORRELATION_ID, MetadataKeys.CAUSATION_ID)

    @Bean
    fun correlationDataInterceptor(): CorrelationDataInterceptor<CommandMessage> =
        CorrelationDataInterceptor(messageOriginProvider(), metadataCorrelationDataProvider())
}
`);
        this.fs.write(this._kotlinPath('support/metadata/MetadataCommandInterceptor.kt'), `package ${this.model.rootPackage}.support.metadata

import org.axonframework.messaging.commandhandling.CommandMessage
import org.axonframework.messaging.core.MessageDispatchInterceptor
import org.axonframework.messaging.core.MessageDispatchInterceptorChain
import org.axonframework.messaging.core.MessageStream
import org.axonframework.messaging.core.unitofwork.ProcessingContext
import org.springframework.stereotype.Component

@Component
class MetadataCommandInterceptor : MessageDispatchInterceptor<CommandMessage> {
    override fun interceptOnDispatch(
        message: CommandMessage,
        context: ProcessingContext?,
        chain: MessageDispatchInterceptorChain<CommandMessage>
    ): MessageStream<*> {
        val metadata = MetadataFactory.fromValues(
            userId = message.metadata()[MetadataKeys.USER_ID],
            sessionId = message.metadata()[MetadataKeys.SESSION_ID],
            correlationId = message.metadata()[MetadataKeys.CORRELATION_ID],
            causationId = message.metadata()[MetadataKeys.CAUSATION_ID] ?: message.identifier(),
            traceId = message.metadata()[MetadataKeys.TRACE_ID],
            tenantId = message.metadata()[MetadataKeys.TENANT_ID]
        )

        require(!metadata[MetadataKeys.SESSION_ID].isNullOrBlank()) {
            "Missing required metadata: " + MetadataKeys.SESSION_ID
        }

        return chain.proceed(message.andMetadata(metadata), context)
    }
}
`);
        this.fs.write(this._kotlinPath('support/metadata/AuditLogEntry.kt'), `package ${this.model.rootPackage}.support.metadata

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Lob
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "audit_log")
class AuditLogEntry {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null

    var userId: String? = null
    var sessionId: String? = null
    var correlationId: String? = null
    var causationId: String? = null
    var traceId: String? = null
    var tenantId: String? = null

    @Column(name = "event_type")
    var eventType: String? = null

    @Column(name = "event_timestamp")
    var timestamp: Instant? = null

    @Lob
    @Column(columnDefinition = "TEXT")
    var payload: String? = null
}
`);
        this.fs.write(this._kotlinPath('support/metadata/AuditLogRepository.kt'), `package ${this.model.rootPackage}.support.metadata

import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository

interface AuditLogRepository : JpaRepository<AuditLogEntry, Long> {
    fun findAllByCorrelationId(correlationId: String, pageable: Pageable): Page<AuditLogEntry>
    fun findAllByUserId(userId: String, pageable: Pageable): Page<AuditLogEntry>
    fun findAllBySessionId(sessionId: String, pageable: Pageable): Page<AuditLogEntry>
    fun findAllByTraceId(traceId: String, pageable: Pageable): Page<AuditLogEntry>
    fun findAllByTenantId(tenantId: String, pageable: Pageable): Page<AuditLogEntry>
}
`);
        this.fs.write(this._kotlinPath('support/metadata/AuditTrailProjection.kt'), `package ${this.model.rootPackage}.support.metadata

import com.fasterxml.jackson.databind.ObjectMapper
import org.axonframework.messaging.eventhandling.EventMessage
import org.axonframework.messaging.eventhandling.annotation.EventHandler
import org.springframework.stereotype.Component

@Component
class AuditTrailProjection(
    private val repository: AuditLogRepository,
    private val objectMapper: ObjectMapper
) {
    @EventHandler
    fun on(event: Any, message: EventMessage) {
        val metadata = message.metadata()
        val entry = AuditLogEntry().apply {
            userId = metadata[MetadataKeys.USER_ID]
            sessionId = metadata[MetadataKeys.SESSION_ID]
            correlationId = metadata[MetadataKeys.CORRELATION_ID]
            causationId = metadata[MetadataKeys.CAUSATION_ID]
            traceId = metadata[MetadataKeys.TRACE_ID]
            tenantId = metadata[MetadataKeys.TENANT_ID]
            eventType = event::class.simpleName ?: event.javaClass.simpleName
            timestamp = message.timestamp()
            payload = objectMapper.writeValueAsString(event)
        }

        repository.save(entry)
    }
}
`);
        this.fs.write(this._kotlinPath('support/metadata/AuditTrailResource.kt'), `package ${this.model.rootPackage}.support.metadata

import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.web.PageableDefault
import org.springframework.web.bind.annotation.CrossOrigin
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@CrossOrigin
@RestController
@RequestMapping("/audit-trail")
class AuditTrailResource(private val repository: AuditLogRepository) {
    @GetMapping
    fun findAll(
        @RequestParam(required = false) correlationId: String?,
        @RequestParam(required = false) userId: String?,
        @RequestParam(required = false) sessionId: String?,
        @RequestParam(required = false) traceId: String?,
        @RequestParam(required = false) tenantId: String?,
        @PageableDefault(size = 20) pageable: Pageable
    ): Page<AuditLogEntry> =
        when {
            !correlationId.isNullOrBlank() -> repository.findAllByCorrelationId(correlationId, pageable)
            !userId.isNullOrBlank() -> repository.findAllByUserId(userId, pageable)
            !sessionId.isNullOrBlank() -> repository.findAllBySessionId(sessionId, pageable)
            !traceId.isNullOrBlank() -> repository.findAllByTraceId(traceId, pageable)
            !tenantId.isNullOrBlank() -> repository.findAllByTenantId(tenantId, pageable)
            else -> repository.findAll(pageable)
        }
}
`);
    }

    _runtimeConfig(appName) {
        const index = this.currentDeployment ? this.currentDeploymentIndex : 0;
        return {
            appName,
            appPort: 8080 + index,
            dbPort: 5432 + index,
            dbName: safeDatabaseName(appName),
            composeFile: 'docker-compose.yml'
        };
    }

    _writeAgentSkills() {
        const agentTemplates = path.resolve(__dirname, '../../common/agent-templates');
        this.fs.copy(agentTemplates, this.destinationPath('.agent'));
    }

    _copyMavenWrapper() {
        const axonTemplates = path.resolve(__dirname, '../../axon/app/templates');
        this.fs.copy(path.join(axonTemplates, '.mvn'), this.destinationPath('.mvn'));
        this.fs.copy(path.join(axonTemplates, 'root/mvnw'), this.destinationPath('mvnw'));
        this.fs.copy(path.join(axonTemplates, 'root/mvnw.cmd'), this.destinationPath('mvnw.cmd'));
    }

    _writeDevSeedScript() {
        this.fs.copy(this.templatePath('seed-dev-data.mjs'), this.destinationPath('scripts/seed-dev-data.mjs'));
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
                        ? renderObjectValueType(valueType, this.model.rootPackage)
                        : renderScalarValueType(valueType, baseType)
            ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
            this.fs.write(this._kotlinPath(`${contextPackage(valueType.context)}/domain/types/${valueType.name}.kt`), `${lines}\n`);
        }
    }

    _writeFieldOptionEnums() {
        const optionSets = collectFieldOptionEnums(this.model);
        for (const optionSet of optionSets) {
            const values = optionSet.values.map((option) => `    ${option.enumConstant}`).join(',\n');
            this.fs.write(
                this._kotlinPath(`support/enums/${optionSet.enumName}.kt`),
                `package ${this.model.rootPackage}.support.enums\n\nenum class ${optionSet.enumName} {\n${values}\n}\n`
            );
        }
    }

    _writeConceptStates() {
        for (const concept of this.model.concepts.filter((candidate) => candidate.states?.length)) {
            const packageName = `${this.model.rootPackage}.${contextPackage(concept.context)}.domain.states`;
            const typeName = conceptStateEnumName(concept.name);
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
            const selection = selectionFor(slice, this.model, this.eventStorageMode);
            const selectionTarget = selectionTargetFor(this.model, slice);
            const relatedEvents = relatedEventsForSlice(this.model, slice);
            const reservations = uniqueReservationsForSlice(slice, this.model, this.eventStorageMode);
            this._writeSelection(selectionTarget.packageName, selectionTarget.pathPrefix, slice, selection);
            reservations.forEach((reservation) => this._writeReservationArtifacts(context, reservation));
            slice.commands.forEach((command) => this._writeCommand(packageName, context, slicePackage, command, selection, selectionTarget.packageName, reservations));
            relatedEvents.forEach((event) => this._writeEvent(event, slice, selection));
            if (!primaryConcept(slice)) {
                this._writeState(packageName, context, slicePackage, slice, selection, relatedEvents);
            }
            this._writeDecision(packageName, context, slicePackage, slice, selection, relatedEvents, reservations);
            this._writeCommandHandlers(packageName, context, slicePackage, slice, selection, relatedEvents, reservations);
            this._writeCommandResource(packageName, context, slicePackage, slice);
        }
        slice.readmodels.forEach((readmodel) => this._writeReadModel(packageName, context, slicePackage, slice, readmodel));
    }

    _writeSelection(packageName, pathPrefix, slice, selection) {
        const imports = kotlinFieldImports(selection.fields, this.model.rootPackage);
        const properties = selection.fields.map((field) => `    val ${field.alias}: ${field.selectionType}`).join(',\n');
        const tags = uniqueTags(selection.tags ?? []);
        const tagConstants = tags.map((tag) => `    const val ${constant(tag.name)} = "${escapeKotlin(tag.name)}"`).join('\n');
        const metadataOwner = selection.metadataOwner ?? slice.name;
        const concepts = selection.concepts ?? slice.concepts;
        const body = selection.compositeTag
            ? ` {\n    val ${selection.compositeTag.property}: String = ${selection.compositeTag.expression}\n}`
            : '';
        this.fs.write(this._kotlinPath(`${pathPrefix}/${selection.name}.kt`), `package ${packageName}

${imports}

data class ${selection.name}(
${properties}
)${body}

object ${pascal(metadataOwner)}Tags {
${tagConstants}
}

object ${pascal(metadataOwner)}Metadata {
    val concepts = ${stringList(concepts)}
}
`);
    }

    _writeCommand(packageName, context, slicePackage, command, selection, selectionPackageName = packageName, reservations = []) {
        const commandName = _commandTitle(command.title);
        const commandFields = commandFieldsWithSelection(command, selection);
        const commandReservations = command.startsLifecycle ? reservations : [];
        const imports = uniqueBy([
            kotlinFieldImports(commandFields, this.model.rootPackage),
            ...commandReservations.map((reservation) => `import ${reservation.packageName}.${reservation.selectionName}`)
        ].filter(Boolean), (value) => value).join('\n');
        const selectionImport = selectionPackageName === packageName ? '' : `import ${selectionPackageName}.${selection.name}\n`;
        const properties = commandFields.map((field) => {
            const defaultValue = field.generated ? ` = ${fallbackValue(field)}` : '';
            return `    val ${field.name}: ${mappedType(field, field.optional)}${defaultValue}`;
        }).join(',\n');
        const selectionArgs = selection.fields.map((field) => `${field.alias} = ${field.commandExpression}`).join(', ');
        const reservationSelections = commandReservations.map((reservation) =>
            `    val ${reservation.selectionProperty}: ${reservation.selectionName} = ${reservation.selectionName}(${reservation.selectionArgs.join(', ')})`
        ).join('\n');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${commandName}.kt`), `package ${packageName}

import org.axonframework.messaging.commandhandling.annotation.Command
import org.axonframework.modelling.annotation.TargetEntityId
${selectionImport}${imports}

@Command
data class ${commandName}(
${properties}
) {
    @TargetEntityId
    val selection: ${selection.name} = ${selection.name}(${selectionArgs})
${reservationSelections ? `\n${reservationSelections}` : ''}
}
`);
    }

    _writeReservationArtifacts(context, reservation) {
        const fields = [
            ...reservation.idFields,
            ...reservation.originalFields,
            ...reservation.normalizedFields
        ];
        const compositeTag = reservation.eventStorageMode === 'aggregate' && reservation.selectionFields.length > 1
            ? {
                name: safeIdentifier(String(reservation.concept ?? reservation.selectionName).charAt(0).toLowerCase() + String(reservation.concept ?? reservation.selectionName).slice(1)),
                property: 'consistencyKey',
                expression: compositeKeyExpression(reservation.selectionFields.map((field) => field.name))
            }
            : undefined;
        const eventImports = kotlinFieldImports(fields, this.model.rootPackage);
        const eventProperties = [
            ...fields.map((field) => {
                const tag = !compositeTag && reservation.normalizedFields.some((candidate) => candidate.name === field.name)
                ? `    @EventTag(key = "${escapeKotlin(field.tagName)}")\n`
                : '';
                return `${tag}    val ${field.name}: ${mappedType(field, false)}`;
            }),
            ...(compositeTag ? [`    @EventTag(key = "${escapeKotlin(compositeTag.name)}")\n    val ${compositeTag.property}EventTag: String = ${compositeTag.expression}`] : [])
        ].join(',\n');
        this.fs.write(this._kotlinPath(`${context}/events/${reservation.eventName}.kt`), `package ${this.model.rootPackage}.${context}.events

import org.axonframework.eventsourcing.annotation.EventTag
import org.axonframework.messaging.eventhandling.annotation.Event
${eventImports}

@Event
data class ${reservation.eventName}(
${eventProperties}
)
`);

        const selectionProperties = reservation.selectionFields.map((field) => `    val ${field.name}: String`).join(',\n');
        const selectionBody = compositeTag
            ? ` {\n    val ${compositeTag.property}: String = ${compositeTag.expression}\n}`
            : '';
        this.fs.write(this._kotlinPath(`${reservation.packagePath}/${reservation.selectionName}.kt`), `package ${reservation.packageName}

data class ${reservation.selectionName}(
${selectionProperties}
)${selectionBody}

object ${reservation.tagsName} {
${(compositeTag ? [{tagName: compositeTag.name}] : reservation.normalizedFields).map((field) => `    const val ${constant(field.tagName)} = "${escapeKotlin(field.tagName)}"`).join('\n')}
}
`);

        const criteria = compositeTag
            ? `Tag.of(${reservation.tagsName}.${constant(compositeTag.name)}, selection.${compositeTag.property})`
            : reservation.selectionFields
                .map((field) => `Tag.of(${reservation.tagsName}.${constant(field.tagName)}, selection.${field.name})`)
                .join(',\n                ');
        const sourcingAssignments = [
            '        reserved = true',
            ...reservation.idFields.map((field) => `        ${field.name} = event.${field.name}`)
        ].join('\n');
        this.fs.write(this._kotlinPath(`${reservation.packagePath}/${reservation.stateName}.kt`), `package ${reservation.packageName}

import org.axonframework.eventsourcing.annotation.EventCriteriaBuilder
import org.axonframework.eventsourcing.annotation.EventSourcingHandler
import org.axonframework.eventsourcing.annotation.reflection.EntityCreator
import org.axonframework.extension.spring.stereotype.EventSourced
import org.axonframework.messaging.eventstreaming.EventCriteria
import org.axonframework.messaging.eventstreaming.Tag
import ${this.model.rootPackage}.${context}.events.${reservation.eventName}
${kotlinFieldImports(reservation.idFields, this.model.rootPackage)}

@EventSourced(idType = ${reservation.selectionName}::class)
class ${reservation.stateName} @EntityCreator constructor() {

    var reserved: Boolean = false
${reservation.idFields.map((field) => `    var ${field.name}: ${stateFieldType(field)} = ${stateFieldDefault(field)}`).join('\n')}

    companion object {
        @JvmStatic
        @EventCriteriaBuilder
        fun resolveCriteria(selection: ${reservation.selectionName}): EventCriteria = EventCriteria.havingTags(
                ${criteria}
        )
    }

    @EventSourcingHandler
    fun evolve(event: ${reservation.eventName}): ${reservation.stateName} = apply {
${sourcingAssignments}
    }
}
`);
    }

    _writeEvent(event, ownerSlice, selection) {
        const eventSlice = this.model.slices.find((slice) => slice.title === event.slice || slice.name === event.slice) ?? ownerSlice;
        const context = contextPackage(eventSlice.context);
        const packageName = `${this.model.rootPackage}.${context}.events`;
        const eventName = _eventTitle(event.title);
        const eventTagFields = eventTagFieldsFor(ownerSlice, event, selection, true);
        const eventFields = eventFieldsWithTags(event.fields ?? [], eventTagFields);
        const imports = kotlinFieldImports(eventFields, this.model.rootPackage);
        const annotated = new Set();
        const properties = eventFields.map((field) => {
            const annotations = (field.eventTagKeys ?? []).map((tagName) => {
                annotated.add(tagName);
                return `    @EventTag(key = "${escapeKotlin(tagName)}")`;
            }).join('\n');
            const defaultValue = field.defaultValue ? ` = ${field.defaultValue}` : '';
            return `${annotations ? `${annotations}\n` : ''}    val ${field.name}: ${mappedType(field, field.optional)}${defaultValue}`;
        }).join(',\n');
        const expectedTags = uniqueTags(selection.tags ?? []);
        const unresolved = expectedTags.filter((tag) => !annotated.has(tag.name));
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
)
`);
    }

    _writeState(packageName, context, slicePackage, slice, selection, events, overrideStateName, childTransitions = []) {
        const stateName = overrideStateName ?? `${pascal(slice.name)}State`;
        const concept = primaryConcept(slice);
        const childTransitionByEventId = new Map(childTransitions.map((transition) => [transition.eventId, transition]));
        const transitionByEventId = new Map((this.model.transitions ?? [])
            .filter((transition) => transition.owner?.name === concept)
            .filter((transition) => transition.event?.id)
            .map((transition) => [transition.event.id, transition]));
        const hasChildMemberState = childTransitions.length > 0;
        const childTransitionKeyFields = new Set(childTransitions.map((transition) => transition.keyField).filter(Boolean));
        const fields = uniqueFields(events.flatMap((event) => event.fields))
            .filter((field) => !(hasChildMemberState && childTransitionKeyFields.has(field.name)));
        const imports = kotlinFieldImports(uniqueFields([...fields, ...(selection.fields ?? [])]), this.model.rootPackage);
        const stateEnumName = concept ? conceptStateEnumName(concept) : undefined;
        const stateFields = [
            ...(concept ? [`    var currentState: ${stateEnumName}? = null`] : []),
            ...fields.map((field) => `    private var ${field.name}: ${stateFieldType(field)} = ${stateFieldDefault(field)}`),
            ...(hasChildMemberState ? ['    private val members: MutableMap<String, String> = mutableMapOf()'] : [])
        ].join('\n');
        const sourcingHandlers = events.map((event) => {
            const transition = childTransitionByEventId.get(event.id);
            const stateTransition = transitionByEventId.get(event.id);
            const assignments = [
                ...(concept && stateTransition && !transition && conceptHasState(this.model, slice.context, concept, stateTransition.to) ? [`        currentState = ${stateEnumName}.${constant(stateTransition.to)}`] : []),
                ...event.fields
                    .filter((field) => !(transition?.keyField && field.name === transition.keyField))
                    .map((field) => `        ${field.name} = event.${field.name}`),
                ...(transition?.keyField ? [`        members[event.${transition.keyField}.toString()] = "${escapeKotlin(transition.to)}"`] : [])
            ].join('\n');
            return `    @EventSourcingHandler\n    fun evolve(event: ${_eventTitle(event.title)}): ${stateName} = apply {\n${assignments}\n    }`;
        }).join('\n\n');
        const eventImports = events.map((event) => `import ${this._eventPackage(event, slice)}.${_eventTitle(event.title)}`).join('\n');
        const stateImport = concept ? `import ${this.model.rootPackage}.${contextPackage(slice.context)}.domain.states.${stateEnumName}\n` : '';
        const singleTag = selection.fields.length === 1;
        const tagOwner = pascal(selection.metadataOwner ?? slice.name);
        const idType = singleTag ? selection.fields[0].selectionType.replace(/\?$/, '') : undefined;
        const entityAnnotation = singleTag
            ? `@EventSourced(idType = ${idType}::class, tagKey = ${tagOwner}Tags.${constant(selection.fields[0].tag.name)})`
            : `@EventSourced(idType = ${selection.name}::class)`;
        const criteria = selection.compositeTag
            ? `EventCriteria.havingTags(Tag.of(${tagOwner}Tags.${constant(selection.compositeTag.tag.name)}, selection.${selection.compositeTag.property}))`
            : selection.fields
                .map((field) => `EventCriteria.havingTags(Tag.of(${tagOwner}Tags.${constant(field.tag.name)}, selection.${field.alias}.toString()))`)
                .join(',\n                ');
        const criteriaFunction = singleTag
            ? ''
            : selection.compositeTag
            ? `    companion object {
        @JvmStatic
        @EventCriteriaBuilder
        fun resolveCriteria(selection: ${selection.name}): EventCriteria = ${criteria}
    }

`
            : `    companion object {
        @JvmStatic
        @EventCriteriaBuilder
        fun resolveCriteria(selection: ${selection.name}): EventCriteria = EventCriteria.either(
                ${criteria}
        )
    }

`;
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${stateName}.kt`), `package ${packageName}

import org.axonframework.eventsourcing.annotation.EventCriteriaBuilder
import org.axonframework.eventsourcing.annotation.EventSourcingHandler
import org.axonframework.eventsourcing.annotation.reflection.EntityCreator
import org.axonframework.extension.spring.stereotype.EventSourced
import org.axonframework.messaging.eventstreaming.EventCriteria
import org.axonframework.messaging.eventstreaming.Tag
${eventImports}
${stateImport}
${imports}

${entityAnnotation}
class ${stateName} @EntityCreator constructor() {
${criteriaFunction}
${stateFields}

${sourcingHandlers}
}
`);
    }

    _writeDecision(packageName, context, slicePackage, slice, selection, events, reservations = []) {
        const stateTarget = stateTargetFor(this.model, slice);
        const stateName = stateTarget.name;
        const decisionName = `${pascal(slice.name)}Decision`;
        const methods = slice.commands.map((command) => {
            const commandName = _commandTitle(command.title);
            const outputs = outboundEvents(command, events);
            const commandReservations = command.startsLifecycle ? reservations : [];
            const includeState = !command.startsLifecycle;
            const stateParam = includeState ? `, state: ${stateName}` : '';
            const reservationParams = commandReservations.map((reservation) => `, ${reservation.stateParam}: ${reservation.stateName}`).join('');
            const reservationGuard = commandReservations.map((reservation) => [
                `        require(!${reservation.stateParam}.reserved) {`,
                `            "${escapeKotlin(reservation.message)}"`,
                '        }'
            ].join('\n')).join('\n');
            const reservationEvents = commandReservations.map((reservation) =>
                `            ${reservation.eventName}(${reservation.eventArgs.join(', ')})`
            );
            const transition = transitionForCommand(this.model, command);
            const guard = command.startsLifecycle ? '' : `${renderStateGuard(this.model, transition)}\n`;
            const eventLines = [
                ...reservationEvents,
                ...outputs.map((event) => `            ${_eventTitle(event.title)}(${eventArguments(event, command, selection)})`)
            ];
            const returnStatement = outputs.length > 0
                ? `return listOf(\n${eventLines.join(',\n')}\n        )`
                : 'return emptyList() // TODO: return the event produced by this command.';
            return `    fun decide(command: ${commandName}${stateParam}${reservationParams}): List<Any> {\n${guard}${reservationGuard ? `${reservationGuard}\n` : ''}        ${returnStatement}\n    }`;
        }).join('\n\n');
        const commandImports = slice.commands.map((command) => `import ${packageName}.${_commandTitle(command.title)}`).join('\n');
        const eventImports = uniqueBy([
            ...events.map((event) => `import ${this._eventPackage(event, slice)}.${_eventTitle(event.title)}`),
            ...reservations.map((reservation) => `import ${this.model.rootPackage}.${context}.events.${reservation.eventName}`)
        ], (value) => value).join('\n');
        const stateImport = stateTarget.packageName === packageName ? '' : `import ${stateTarget.packageName}.${stateName}\n`;
        const reservationStateImports = reservations.map((reservation) => `import ${reservation.packageName}.${reservation.stateName}`).join('\n');
        const stateEnumImports = uniqueBy(slice.commands
            .map((command) => transitionForCommand(this.model, command))
            .filter((transition) => transitionUsesConceptState(this.model, transition))
            .map((transition) => `import ${this.model.rootPackage}.${contextPackage(transition.context ?? slice.context)}.domain.states.${conceptStateEnumName(transition.owner.name)}`), (value) => value)
            .join('\n');
        const fieldOptionImports = kotlinEnumImports(events.flatMap((event) => event.fields ?? []), this.model.rootPackage);
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${decisionName}.kt`), `package ${packageName}

import org.springframework.stereotype.Component
${commandImports}
${eventImports}
${stateImport}
${reservationStateImports}
${stateEnumImports}
${fieldOptionImports}

@Component
class ${decisionName} {
${methods}
}
`);
    }

    _writeCommandHandlers(packageName, context, slicePackage, slice, selection, events, reservations = []) {
        const stateTarget = stateTargetFor(this.model, slice);
        const stateName = stateTarget.name;
        const decisionName = `${pascal(slice.name)}Decision`;
        const injectEntity = injectEntityExpression(selection);
        const handlers = slice.commands.map((command) => {
            const commandName = _commandTitle(command.title);
            const commandReservations = command.startsLifecycle ? reservations : [];
            const includeState = !command.startsLifecycle;
            const methodParameters = [
                `command: ${commandName}`,
                includeState ? `@InjectEntity${injectEntity} state: ${stateName}` : undefined,
                ...commandReservations.map((reservation) =>
                    `@InjectEntity(idProperty = "${escapeKotlin(reservation.selectionProperty)}") ${reservation.stateParam}: ${reservation.stateName}`
                ),
                '@MetadataValue(MetadataKeys.USER_ID) userId: String?',
                '@MetadataValue(MetadataKeys.SESSION_ID) sessionId: String?',
                '@MetadataValue(MetadataKeys.CORRELATION_ID) correlationId: String?',
                '@MetadataValue(MetadataKeys.TRACE_ID) traceId: String?',
                '@MetadataValue(MetadataKeys.TENANT_ID) tenantId: String?',
                'commandMessage: CommandMessage',
                'eventAppender: EventAppender'
            ]
                .filter(Boolean)
                .map((parameter) => `        ${parameter}`)
                .join(',\n');
            const decisionArgs = ['command', ...(includeState ? ['state'] : []), ...commandReservations.map((reservation) => reservation.stateParam)].join(', ');
            return `    @CommandHandler
    fun handle(
${methodParameters}
    ) {
        eventAppender.append(
            decision.decide(${decisionArgs}),
            MetadataFactory.fromValues(
                userId = userId,
                sessionId = sessionId,
                correlationId = correlationId,
                causationId = commandMessage.identifier(),
                traceId = traceId,
                tenantId = tenantId
            )
        )
    }`;
        }).join('\n\n');
        const commandImports = slice.commands.map((command) => `import ${packageName}.${_commandTitle(command.title)}`).join('\n');
        const stateImport = stateTarget.packageName === packageName ? '' : `import ${stateTarget.packageName}.${stateName}\n`;
        const reservationStateImports = reservations.map((reservation) => `import ${reservation.packageName}.${reservation.stateName}`).join('\n');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${pascal(slice.name)}CommandHandler.kt`), `package ${packageName}

import org.axonframework.messaging.commandhandling.annotation.CommandHandler
import org.axonframework.messaging.commandhandling.CommandMessage
import org.axonframework.messaging.core.annotation.MetadataValue
import org.axonframework.messaging.eventhandling.gateway.EventAppender
import org.axonframework.modelling.annotation.InjectEntity
import org.springframework.stereotype.Component
import ${this.model.rootPackage}.support.metadata.MetadataFactory
import ${this.model.rootPackage}.support.metadata.MetadataKeys
${commandImports}
${stateImport}
${reservationStateImports}

@Component
class ${pascal(slice.name)}CommandHandler(private val decision: ${decisionName}) {
${handlers}
}
`);
    }

    _writeConceptEntityStates(slices) {
        const groups = groupByMap(slices.filter((slice) => primaryConcept(slice) && slice.commands.length > 0), (slice) => primaryConcept(slice));
        for (const [, conceptSlices] of groups.entries()) {
            const first = conceptSlices[0];
            const selection = selectionFor(first, this.model, this.eventStorageMode);
            const target = stateTargetFor(this.model, first);
            const context = contextPackage(first.context);
            const conceptPackage = _sliceTitle(primaryConcept(first));
            const packageName = target.packageName;
            const events = uniqueBy(
                conceptSlices.flatMap((slice) => relatedEventsForSlice(this.model, slice)),
                (event) => event.id ?? `${event.slice}:${event.name}`
            );
            const childTransitions = [];
            this._writeState(packageName, context, conceptPackage, first, selection, events, target.name, childTransitions);
        }
    }

    _writeCommandResource(packageName, context, slicePackage, slice) {
        const resourceName = `${pascal(slice.name)}Resource`;
        const conceptRoute = httpRoute(slice.concepts[0] ?? slice.name);
        const methods = slice.commands.map((command) => {
            const commandName = _commandTitle(command.title);
            return `    @PostMapping("/${httpRoute(command.title)}")
    fun ${safeIdentifier(command.name)}(
        @Valid @RequestBody command: ${commandName},
        request: HttpServletRequest
    ): CompletableFuture<${commandName}> =
        commandGateway.send(command, MetadataFactory.from(request)).resultMessage.thenApply { command }`;
        }).join('\n\n');
        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${resourceName}.kt`), `package ${packageName}

import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.springframework.web.bind.annotation.CrossOrigin
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import ${this.model.rootPackage}.support.metadata.MetadataFactory
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
            ...metadataFields.map((field) => `    var ${field.name}: ${field.type} = null`)
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
${allImports}

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
${includeMetadata ? `import ${this.model.rootPackage}.support.metadata.MetadataFactory\nimport ${this.model.rootPackage}.support.metadata.MetadataKeys\n` : ''}${eventImports}
${stateImports}

@Component
class ${name}Projector(private val repository: ${repositoryName}) {
${handlers}
}
`);
    }

    _readModelDerivedAssignments(readmodel, event, directFieldNames = new Set()) {
        const ownerSlice = this.model.slices.find((slice) =>
            (slice.events ?? []).some((candidate) => candidate.id === event.id)
        );
        const stateChange = ownerSlice?.stateChange?.eventId === event.id ? ownerSlice.stateChange : undefined;
        const concept = ownerSlice?.concepts?.[0];
        if (!stateChange || !concept) {
            return [];
        }
        const assignments = [];
        const eventFields = event.fields ?? [];
        const field = readmodel.fields.find((candidate) => candidate.type === `${concept}.State`);
        if (field
            && !directFieldNames.has(field.name)
            && !eventFields.some((candidate) => candidate.name === field.name)
            && conceptHasState(this.model, ownerSlice.context, concept, stateChange.to)) {
            assignments.push(`entity.${field.name} = ${conceptStateEnumName(concept)}.${constant(stateChange.to)}`);
        }

        return assignments;
    }

    _eventPackage(event, fallbackSlice) {
        const slice = this.model.slices.find((candidate) => candidate.title === event.slice || candidate.name === event.slice) ?? fallbackSlice;
        return `${this.model.rootPackage}.${contextPackage(slice.context)}.events`;
    }

    _kotlinPath(relative) {
        return this.destinationPath(this._modulePath(`src/main/kotlin/${this.model.rootPackage.split('.').join('/')}/${relative}`));
    }

    _testKotlinPath(relative) {
        return this.destinationPath(this._modulePath(`src/test/kotlin/${this.model.rootPackage.split('.').join('/')}/${relative}`));
    }

    _modulePath(relative) {
        return this.modulePrefix ? `${this.modulePrefix}/${relative}` : relative;
    }

    _destPath(relative) {
        return this.destinationPath(this._modulePath(relative));
    }
};

function selectionFor(slice, model, eventStorageMode = 'dcb') {
    if (primaryConcept(slice)) {
        return conceptSelectionFor(slice, model, eventStorageMode);
    }
    return sliceSelectionFor(slice, eventStorageMode);
}

function uniqueReservationsForSlice(slice, model, eventStorageMode = 'dcb') {
    const command = slice.commands?.[0];
    if (!command) return [];
    const commandFields = command.fields ?? [];
    const idFields = commandFields.filter((field) => field.idAttribute);
    const expressions = (slice.specifications ?? [])
        .flatMap((specification) => [...(specification.validates ?? []), ...(specification.expressions ?? [])])
        .map((expression) => parseUniqueExpression(expression))
        .filter(Boolean);
    return uniqueBy(expressions, (expression) => `${expression.concept}:${expression.fields.join(',')}`)
        .map((expression) => reservationForUniqueExpression(slice, model, command, commandFields, idFields, expression, eventStorageMode))
        .filter(Boolean);
}

function parseUniqueExpression(expression) {
    const value = String(expression ?? '').trim();
    const match = value.match(/^unique\s+(.+)$/i);
    if (!match) return undefined;
    const body = match[1].trim();
    const terms = body.startsWith('(') && body.endsWith(')')
        ? body.slice(1, -1).split(',').map((term) => term.trim())
        : [body];
    const fields = terms.map((term) => {
        const fieldMatch = term.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
        return fieldMatch ? {concept: fieldMatch[1], field: fieldMatch[2]} : undefined;
    });
    if (fields.some((field) => !field)) return undefined;
    const concept = fields[0].concept;
    if (fields.some((field) => field.concept !== concept)) return undefined;
    return {concept, fields: fields.map((field) => field.field)};
}

function reservationForUniqueExpression(slice, model, command, commandFields, idFields, expression, eventStorageMode = 'dcb') {
    const concept = primaryConcept(slice) ?? expression.concept;
    if (expression.concept !== concept) return undefined;
    const sourceFields = expression.fields
        .map((fieldName) => commandFields.find((field) => field.name === fieldName))
        .filter(Boolean);
    if (sourceFields.length !== expression.fields.length) return undefined;

    const fieldLabels = sourceFields.map((field) => uniqueFieldLabel(concept, field.name));
    const suffix = fieldLabels.join('');
    const base = `${pascal(concept)}${suffix}`;
    const context = contextPackage(slice.context);
    const packagePath = `${context}/${_sliceTitle(concept)}`;
    const selectionFields = sourceFields.map((field, index) => ({
        ...field,
        name: sourceFields.length === 1 ? 'normalizedName' : `normalized${fieldLabels[index]}`,
        tagName: field.name,
        selectionExpression: normalizedFieldExpression(field),
        decisionExpression: normalizedFieldExpression(field, 'command')
    }));
    const normalizedFields = selectionFields.map((field) => ({
        name: field.name,
        type: 'String',
        cardinality: 'Single',
        optional: false,
        tagName: field.tagName
    }));
    const originalFields = sourceFields.map((field) => ({
        ...field,
        tagName: field.name
    }));
    const selectionName = `${base}Selection`;
    const stateName = `${base}ReservationState`;
    const eventName = `${base}ReservedEvent`;
    const selectionProperty = `${safeIdentifier(base.charAt(0).toLowerCase() + base.slice(1))}Selection`;
    const stateParam = `${safeIdentifier(base.charAt(0).toLowerCase() + base.slice(1))}Reservation`;
    const selectionArgs = selectionFields.map((field) => `${field.name} = ${field.selectionExpression}`);
    const eventArgs = [
        ...idFields.map((field) => `${field.name} = command.${field.name}`),
        ...originalFields.map((field) => `${field.name} = command.${field.name}`),
        ...selectionFields.map((field) => `${field.name} = ${field.decisionExpression}`)
    ];
    return {
        concept,
        packagePath,
        packageName: `${model.rootPackage}.${context}.${_sliceTitle(concept)}`,
        selectionName,
        stateName,
        eventName,
        tagsName: `${base}ReservationTags`,
        selectionProperty,
        stateParam,
        selectionFields,
        originalFields,
        normalizedFields,
        idFields,
        selectionArgs,
        eventArgs,
        eventStorageMode,
        message: `${fieldLabels.join(' ')} already exists.`
    };
}

function uniqueFieldLabel(concept, fieldName) {
    const conceptPrefix = String(concept ?? '').charAt(0).toLowerCase() + String(concept ?? '').slice(1);
    if (fieldName.toLowerCase().startsWith(conceptPrefix.toLowerCase()) && fieldName.length > conceptPrefix.length) {
        return pascal(fieldName.slice(conceptPrefix.length));
    }
    return pascal(fieldName);
}

function normalizedFieldExpression(field, receiver) {
    const value = receiver ? `${receiver}.${field.name}` : field.name;
    const type = String(field.type).toLowerCase();
    return type === 'string'
        ? `${value}.trim().lowercase()`
        : `${value}.toString().trim().lowercase()`;
}

function conceptSelectionFor(slice, model, eventStorageMode = 'dcb') {
    const concept = primaryConcept(slice);
    const conceptSlices = (model?.slices ?? [])
        .filter((candidate) => candidate.context === slice.context && primaryConcept(candidate) === concept && candidate.commands.length > 0);
    const sourceSlice = conceptSlices.find((candidate) => candidate.startsLifecycle && explicitConsistencyTags(candidate).length > commandIdFields(candidate).length)
        ?? conceptSlices.find((candidate) => explicitConsistencyTags(candidate).length > commandIdFields(candidate).length)
        ?? conceptSlices.find((candidate) => candidate.startsLifecycle && commandIdFields(candidate).length > 0)
        ?? conceptSlices.find((candidate) => commandIdFields(candidate).length > 0)
        ?? conceptSlices.find((candidate) => candidate.startsLifecycle && (candidate.tags ?? []).length > 0)
        ?? conceptSlices.find((candidate) => (candidate.tags ?? []).length > 0)
        ?? slice;
    const explicitTags = explicitConsistencyTags(sourceSlice);
    if (explicitTags.length > commandIdFields(sourceSlice).length) {
        return selectionFromTags(sourceSlice, explicitTags, `${pascal(concept)}Selection`, concept, [concept], eventStorageMode);
    }
    const idFields = commandIdFields(sourceSlice);
    if (idFields.length > 0) {
        const tags = idFields.map((field) => ({name: field.name, expression: field.name}));
        return selectionFromTags(sourceSlice, tags, `${pascal(concept)}Selection`, concept, [concept], eventStorageMode);
    }
    return selectionFromTags(sourceSlice, sourceSlice.tags.length > 0 ? sourceSlice.tags : fallbackTags(sourceSlice, sourceSlice.commands[0]?.fields ?? []), `${pascal(concept)}Selection`, concept, [concept], eventStorageMode);
}

function sliceSelectionFor(slice, eventStorageMode = 'dcb') {
    const firstCommand = slice.commands[0];
    const commandFields = firstCommand?.fields ?? [];
    const idFields = commandFields.filter((field) => field.idAttribute);
    const explicitTags = explicitConsistencyTags(slice);
    const tags = explicitTags.length > idFields.length
        ? explicitTags
        : idFields.length > 0
        ? idFields.map((field) => ({name: field.name, expression: field.name}))
        : (slice.tags.length > 0 ? slice.tags : fallbackTags(slice, commandFields));
    return selectionFromTags(slice, tags, `${pascal(slice.name)}Selection`, slice.name, slice.concepts, eventStorageMode);
}

function explicitConsistencyTags(slice) {
    return slice.tags ?? [];
}

function selectionFromTags(slice, tags, name, metadataOwner, concepts, eventStorageMode = 'dcb') {
    const commandFields = slice.commands[0]?.fields ?? [];
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
    if (eventStorageMode === 'aggregate' && fields.length > 1) {
        const tag = {name: safeIdentifier(String(metadataOwner ?? name).charAt(0).toLowerCase() + String(metadataOwner ?? name).slice(1))};
        return {
            name,
            tags: [tag],
            fields,
            metadataOwner,
            concepts,
            eventStorageMode,
            compositeTag: {
                tag,
                property: 'consistencyKey',
                sources: fields.map((field) => field.source),
                expression: compositeKeyExpression(fields.map((field) => field.alias)),
                eventExpression: compositeKeyExpression(fields.map((field) => field.eventExpression))
            }
        };
    }
    return {name, tags, fields, metadataOwner, concepts, eventStorageMode};
}

function commandFieldsWithSelection(command, selection) {
    return fieldsWithSelection(command.fields ?? [], selection.fields ?? []);
}

function fieldsWithSelection(fields, selectionFields) {
    const result = [...fields];
    const existing = new Set(result.map((field) => field.name));
    (selectionFields ?? []).forEach((field) => {
        if (existing.has(field.alias)) return;
        result.push({
            name: field.alias,
            type: field.type,
            cardinality: 'Single',
            optional: false,
            idAttribute: false,
            generated: false,
            technicalAttribute: false,
            query: false
        });
        existing.add(field.alias);
    });
    return result;
}

function eventFieldsWithTags(fields, tagFields) {
    const result = fields.map((field) => ({
        ...field,
        eventTagKeys: (tagFields ?? [])
            .filter((tagField) => !tagField.derived && tagField.source === field.name)
            .map((tagField) => tagField.tag.name)
    }));
    const existing = new Set(result.map((field) => field.name));
    const eventShape = {fields: result};
    (tagFields ?? [])
        .filter((tagField) => tagField.derived)
        .filter((tagField) => (tagField.requiredSources ?? [tagField.source]).every((source) => fields.some((field) => field.name === source)))
        .forEach((tagField) => {
            const name = derivedEventTagProperty(tagField, eventShape);
            if (existing.has(name)) return;
            result.push({
                name,
                type: 'String',
                cardinality: 'Single',
                optional: false,
                idAttribute: false,
                generated: false,
                technicalAttribute: false,
                query: false,
                eventTagKeys: [tagField.tag.name],
                defaultValue: tagField.eventExpression
            });
            existing.add(name);
            eventShape.fields = result;
        });
    return result;
}

function eventTagFieldsFor(slice, event, selection, includeMissing = false) {
    if (selection.compositeTag) {
        const sources = selection.compositeTag.sources ?? [];
        if (!includeMissing && !sources.every((source) => (event.fields ?? []).some((eventField) => eventField.name === source))) {
            return [];
        }
        return [{
            name: selection.compositeTag.property,
            alias: selection.compositeTag.property,
            source: sources[0],
            requiredSources: sources,
            type: 'String',
            cardinality: 'Single',
            optional: false,
            derived: true,
            tag: selection.compositeTag.tag,
            eventExpression: selection.compositeTag.eventExpression
        }];
    }
    const explicitTagSelection = selection.eventStorageMode === 'dcb' && (slice.tags ?? []).length > 0
        ? selectionFromTags(slice, slice.tags, `${pascal(slice.name)}ExplicitTags`, slice.name, slice.concepts, 'dcb')
        : {fields: []};
    const byTagName = new Map();
    [...(selection.fields ?? []), ...(explicitTagSelection.fields ?? [])]
        .filter((field) => includeMissing || (event.fields ?? []).some((eventField) => eventField.name === field.source))
        .forEach((field) => {
            if (!byTagName.has(field.tag.name)) byTagName.set(field.tag.name, field);
        });
    return Array.from(byTagName.values());
}

function injectEntityExpression(selection) {
    if ((selection.fields ?? []).length === 1) {
        return `(idProperty = "${escapeKotlin(selection.fields[0].alias)}")`;
    }
    return '(idProperty = "selection")';
}

function uniqueTags(tags) {
    const byName = new Map();
    tags.filter(Boolean).forEach((tag) => {
        if (!byName.has(tag.name)) byName.set(tag.name, tag);
    });
    return Array.from(byName.values());
}

function commandIdFields(slice) {
    return slice.commands[0]?.fields?.filter((field) => field.idAttribute) ?? [];
}

function fallbackTags(slice, fields) {
    const idFields = fields.filter((field) => field.idAttribute);
    if (idFields.length > 0) {
        return idFields.map((field) => ({name: field.name, expression: field.name}));
    }
    const idField = fields[0];
    const concept = primaryConcept(slice) ?? slice.name;
    return [{name: concept, expression: idField?.name}];
}

function selectionTargetFor(model, slice) {
    const context = contextPackage(slice.context);
    const concept = primaryConcept(slice);
    if (concept) {
        const conceptPackage = _sliceTitle(concept);
        return {
            packageName: `${model.rootPackage}.${context}.${conceptPackage}`,
            pathPrefix: `${context}/${conceptPackage}`
        };
    }
    const slicePackage = _sliceTitle(slice.title);
    return {
        packageName: `${model.rootPackage}.${context}.${slicePackage}`,
        pathPrefix: `${context}/${slicePackage}`
    };
}

function stateTargetFor(model, slice) {
    const context = contextPackage(slice.context);
    const concept = primaryConcept(slice);
    if (concept) {
        const conceptPackage = _sliceTitle(concept);
        return {
            name: `${pascal(concept)}State`,
            packageName: `${model.rootPackage}.${context}.${conceptPackage}`,
            pathPrefix: `${context}/${conceptPackage}`
        };
    }
    const slicePackage = _sliceTitle(slice.title);
    return {
        name: `${pascal(slice.name)}State`,
        packageName: `${model.rootPackage}.${context}.${slicePackage}`,
        pathPrefix: `${context}/${slicePackage}`
    };
}

function primaryConcept(slice) {
    return slice.concepts?.[0];
}

function childStateTransitions(slices) {
    return slices
        .filter((slice) => slice.stateChange?.eventId)
        .flatMap((slice) => {
            const events = relatedEventsForSlice({slices}, slice)
                .filter((event) => event.id === slice.stateChange.eventId);
            return events.map((event) => ({
                eventId: event.id,
                keyField: childTransitionKeyField(event),
                to: slice.stateChange.to
            })).filter((transition) => transition.keyField);
        });
}

function childTransitionKeyField(event) {
    const fields = event.fields ?? [];
    const idFields = fields.filter((field) => field.idAttribute || /Id$/.test(field.name));
    return (idFields.length > 1 ? idFields[idFields.length - 1] : idFields[0])?.name;
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
        const type = String(field.type).toLowerCase();
        const primitive = ['string', 'boolean', 'int', 'integer', 'long', 'float', 'double', 'number', 'decimal', 'bigdecimal', 'uuid', 'date', 'datetime'].includes(type);
        const value = primitive ? field.name : `${field.name}.value`;
        const textValue = type === 'string' ? value : `${value}.toString()`;
        return `${textValue}.trim().lowercase()`;
    }
    return `${sourceField.name}.toString() /* TODO Medol tag expression: ${escapeKotlin(normalized)} */`;
}

function compositeKeyExpression(expressions) {
    return `listOf(${expressions.map((expression) => `${expression}.toString()`).join(', ')}).joinToString("|")`;
}

function renderDerivedEventTags(fields, event) {
    const derived = fields.filter((field) => field.derived && event.fields.some((eventField) => eventField.name === field.source));
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

function transitionForCommand(model, command) {
    return (model.transitions ?? []).find((transition) =>
        transition.command?.id === command.id || transition.command?.name === command.name
    );
}

function conceptStateEnumName(conceptName) {
    return `${pascal(conceptName)}StateEnum`;
}

function conceptHasState(model, context, conceptName, stateName) {
    const concept = (model.concepts ?? []).find((candidate) =>
        candidate.name === conceptName && (!context || candidate.context === context)
    );
    return (concept?.states ?? []).some((state) => state === stateName);
}

function transitionUsesConceptState(model, transition) {
    return Boolean(
        transition?.from
        && transition.owner?.type === 'concept'
        && conceptHasState(model, transition.context, transition.owner.name, transition.from)
    );
}

function renderStateGuard(model, transition) {
    if (!transition?.from || transition.owner?.type !== 'concept') {
        return '        // TODO: validate domain rules against state before appending events.';
    }
    if (!transitionUsesConceptState(model, transition)) {
        return '        // TODO: validate child/member state before appending events.';
    }
    const stateType = conceptStateEnumName(transition.owner.name);
    return [
        `        require(state.currentState == ${stateType}.${constant(transition.from)}) {`,
        `            "${escapeKotlin(transition.command?.name ?? 'Command')} requires ${escapeKotlin(transition.owner.name)} to be ${escapeKotlin(transition.from)}."`,
        '        }'
    ].join('\n');
}

function eventArguments(event, command, selection) {
    const eventFields = event.fields ?? [];
    const commandFields = commandFieldsWithSelection(command, selection ?? {fields: []});
    return eventFields.map((field) => {
        if (commandFields.some((candidate) => candidate.name === field.name)) return `${field.name} = command.${field.name}`;
        const source = field.source?.from?.find((name) => commandFields.some((candidate) => candidate.name === name));
        if (source) return `${field.name} = command.${source}`;
        return `${field.name} = ${fallbackValue(field)} /* TODO: ${field.source?.rule ?? 'derive value'} */`;
    }).join(', ');
}

function fallbackValue(field) {
    if (field.optional) return 'null';
    if (field.cardinality === 'Multiple') return 'emptyList()';
    if (field.valueType?.kind === 'enum' && (field.valueType.values ?? []).length > 0) {
        return `${field.valueType.name}.${constant(field.valueType.values[0])}`;
    }
    const optionSet = fieldOptionsFor(field);
    if (optionSet) return `${optionSet.enumName}.${optionSet.values[0].enumConstant}`;
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

function readModelStorageImports(fields, rootPackage) {
    return kotlinFieldImports((fields ?? []).map(readModelStorageField), rootPackage);
}

function readModelStorageField(field) {
    if (!isScalarValueTypeField(field)) return field;
    const valueType = valueTypeForField(field);
    return {
        ...field,
        type: resolvedBaseType(valueType),
        valueType: undefined
    };
}

function readModelStorageType(field, optional = field.optional) {
    return mappedType(readModelStorageField(field), optional);
}

function readModelStorageFieldType(field) {
    return field.cardinality === 'Multiple'
        ? readModelStorageType(field, false)
        : readModelStorageType(field, true).replace(/\?\?$/, '?');
}

function readModelStorageFieldDefault(field) {
    return field.cardinality === 'Multiple' ? 'emptyList()' : 'null';
}

function readModelStorageExpression(field, expression) {
    if (!isScalarValueTypeField(field)) return expression;
    if (field.cardinality === 'Multiple') {
        return field.optional
            ? `${expression}?.map { it.value }`
            : `${expression}.map { it.value }`;
    }
    return field.optional ? `${expression}?.value` : `${expression}.value`;
}

function isScalarValueTypeField(field) {
    return valueTypeForField(field)?.kind === 'scalar';
}

function valueTypeForField(field) {
    return field?.valueType ?? findValueType(field?.type);
}

const METADATA_FIELD_DEFINITIONS = [
    {name: 'userId', key: 'USER_ID', type: 'String?'},
    {name: 'sessionId', key: 'SESSION_ID', type: 'String?'},
    {name: 'correlationId', key: 'CORRELATION_ID', type: 'String?'},
    {name: 'causationId', key: 'CAUSATION_ID', type: 'String?'},
    {name: 'traceId', key: 'TRACE_ID', type: 'String?'},
    {name: 'tenantId', key: 'TENANT_ID', type: 'String?'}
];

function readModelMetadataFields(readmodel) {
    const existingNames = new Set((readmodel.fields ?? []).map((field) => field.name));
    return METADATA_FIELD_DEFINITIONS.filter((field) => !existingNames.has(field.name));
}

function readModelMetadataParameters(metadataFields, indent = '        ') {
    return metadataFields
        .map((field) => `${indent}@MetadataValue(MetadataKeys.${field.key}) ${field.name}: String?`)
        .join(',\n');
}

function readModelMetadataAssignments(metadataFields, indent = '            ') {
    return metadataFields
        .map((field) => `${indent}entity.${field.name} = MetadataFactory.value(${field.name})`)
        .join('\n');
}

function mappedType(field, optional = field.optional) {
    const optionSet = fieldOptionsFor(field);
    const cardinality = field.cardinality === 'Multiple' ? 'List' : field.cardinality;
    if (optionSet) {
        const fieldType = optional ? `${optionSet.enumName}?` : optionSet.enumName;
        return cardinality?.toLowerCase() === 'list'
            ? field.mutable ? `MutableList<${fieldType}>` : `List<${fieldType}>`
            : fieldType;
    }
    return typeMapping(field.type, cardinality, optional, field.mutable);
}

function kotlinFieldImports(fields, rootPackage, additionalImports) {
    return [
        typeImports(fields, additionalImports),
        kotlinEnumImports(fields, rootPackage)
    ].filter(Boolean).join('\n');
}

function kotlinEnumImports(fields, rootPackage) {
    return uniqueBy((fields ?? [])
        .map(fieldOptionsFor)
        .filter(Boolean)
        .map((optionSet) => `import ${rootPackage}.support.enums.${optionSet.enumName}`), (value) => value)
        .join('\n');
}

function isJpaEnumField(field) {
    return field.type?.endsWith('.State') || valueTypeForField(field)?.kind === 'enum' || Boolean(fieldOptionsFor(field));
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

function kebab(value) {
    return String(value ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

function safeDatabaseName(value) {
    const name = String(value ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
    return name || 'medol';
}

function safeIdentifier(value) {
    const result = String(value ?? '').replace(/[^A-Za-z0-9_]/g, '');
    return result && /^[A-Za-z_]/.test(result) ? result : `tag${pascal(result)}`;
}

function httpRoute(value) {
    return String(value ?? '').replace(/[\s_-]+/g, '').toLowerCase();
}

function constant(value) {
    return String(value ?? '')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/([0-9])([A-Z][a-z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
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

function renderObjectValueType(valueType, rootPackage) {
    const imports = kotlinFieldImports(valueType.fields ?? [], rootPackage);
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

function filterModelByDeployment(model, deployment) {
    const contextNames = new Set((deployment.contexts ?? []).map((context) => context.name));
    const inContext = (item) => !item?.context || contextNames.has(item.context);
    const slices = (model.slices ?? []).filter((slice) => contextNames.has(slice.context ?? slice.chapter));
    return {
        ...model,
        domain: deployment.name,
        deployment: deployment.name,
        deployments: [deployment],
        contexts: (model.contexts ?? []).filter((context) => contextNames.has(context.name)),
        valueTypes: (model.valueTypes ?? []).filter(inContext),
        aggregates: (model.aggregates ?? []).filter(inContext),
        concepts: (model.concepts ?? []).filter(inContext),
        transitions: (model.transitions ?? []).filter(inContext),
        slices
    };
}
