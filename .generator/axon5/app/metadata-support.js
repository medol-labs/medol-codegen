/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {AUDIT_TRAIL_PROCESSING_GROUP} = require('./axon-processing');

function writeMetadataSupport(generator) {
        generator.fs.write(generator._sharedKernelKotlinPath('shared/application/metadata/MetadataKeys.kt'), `package ${generator.model.rootPackage}.shared.application.metadata

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
        generator.fs.write(generator._sharedKernelKotlinPath('shared/application/metadata/MetadataFactory.kt'), `package ${generator.model.rootPackage}.shared.application.metadata

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
        generator.fs.write(generator._sharedKernelKotlinPath('shared/application/metadata/ProjectionMetadata.kt'), `package ${generator.model.rootPackage}.shared.application.metadata

import org.axonframework.messaging.eventhandling.EventMessage

interface MetadataProjection {
    var userId: String?
    var sessionId: String?
    var correlationId: String?
    var causationId: String?
    var traceId: String?
    var tenantId: String?
}

data class MetadataSnapshot(
    val userId: String?,
    val sessionId: String?,
    val correlationId: String?,
    val causationId: String?,
    val traceId: String?,
    val tenantId: String?
)

object ProjectionMetadata {
    fun from(message: EventMessage): MetadataSnapshot {
        val metadata = message.metadata()

        return MetadataSnapshot(
            userId = MetadataFactory.value(metadata[MetadataKeys.USER_ID]),
            sessionId = MetadataFactory.value(metadata[MetadataKeys.SESSION_ID]),
            correlationId = MetadataFactory.value(metadata[MetadataKeys.CORRELATION_ID]),
            causationId = MetadataFactory.value(metadata[MetadataKeys.CAUSATION_ID]),
            traceId = MetadataFactory.value(metadata[MetadataKeys.TRACE_ID]),
            tenantId = MetadataFactory.value(metadata[MetadataKeys.TENANT_ID])
        )
    }

    fun assign(target: MetadataProjection, message: EventMessage) {
        assign(target, from(message))
    }

    fun assign(target: MetadataProjection, metadata: MetadataSnapshot) {
        target.userId = metadata.userId
        target.sessionId = metadata.sessionId
        target.correlationId = metadata.correlationId
        target.causationId = metadata.causationId
        target.traceId = metadata.traceId
        target.tenantId = metadata.tenantId
    }

    fun assign(
        target: MetadataProjection,
        userId: String?,
        sessionId: String?,
        correlationId: String?,
        causationId: String?,
        traceId: String?,
        tenantId: String?
    ) {
        target.userId = MetadataFactory.value(userId)
        target.sessionId = MetadataFactory.value(sessionId)
        target.correlationId = MetadataFactory.value(correlationId)
        target.causationId = MetadataFactory.value(causationId)
        target.traceId = MetadataFactory.value(traceId)
        target.tenantId = MetadataFactory.value(tenantId)
    }
}
`);
        generator.fs.write(generator._sharedKernelKotlinPath('shared/application/metadata/CorrelationConfig.kt'), `package ${generator.model.rootPackage}.shared.application.metadata

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
        generator.fs.write(generator._sharedKernelKotlinPath('shared/application/metadata/MetadataCommandInterceptor.kt'), `package ${generator.model.rootPackage}.shared.application.metadata

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
        generator.fs.write(generator._sharedKernelKotlinPath('shared/application/metadata/AuditLogEntry.kt'), `package ${generator.model.rootPackage}.shared.application.metadata

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
        generator.fs.write(generator._sharedKernelKotlinPath('shared/application/metadata/AuditLogRepository.kt'), `package ${generator.model.rootPackage}.shared.application.metadata

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
        generator.fs.write(generator._sharedKernelKotlinPath('shared/application/metadata/AuditTrailProjection.kt'), `package ${generator.model.rootPackage}.shared.application.metadata

import com.fasterxml.jackson.databind.ObjectMapper
import org.axonframework.messaging.eventhandling.EventMessage
import org.axonframework.messaging.eventhandling.annotation.EventHandler
import org.axonframework.messaging.core.annotation.Namespace
import org.springframework.stereotype.Component

@Namespace("${AUDIT_TRAIL_PROCESSING_GROUP}")
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
        generator.fs.write(generator._sharedKernelKotlinPath('shared/application/metadata/AuditTrailResource.kt'), `package ${generator.model.rootPackage}.shared.application.metadata

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

module.exports = {
    writeMetadataSupport
};
