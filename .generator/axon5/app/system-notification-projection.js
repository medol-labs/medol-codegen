const {_eventTitle} = require('../../common/util/naming');
const {contextPackage} = require('../../common/util/value-types');
const {readModelStorageImports} = require('./model-helpers');
const {readModelProcessingGroup} = require('./axon-processing');
const {tenantScoped} = require('./tenant-support');

const catalog = {
    lookupFields: ['recipientUserId'],
    renderEvent({contract, event, eventType, metadataAssignments, appendOutbox}) {
        if (event.id !== contract.batchEventId) return;
        return `    @Transactional
    open override fun update(event: ${eventType}, message: EventMessage) {
        repository.findProjectionsByRecipientUserId(event.recipientUserId).forEach { entity ->
            if (entity.state == SystemNotificationStateEnum.Unread) {
                entity.state = SystemNotificationStateEnum.Read
                entity.readAt = event.readAt
${metadataAssignments}
                repository.save(entity)
${appendOutbox('entity.notificationId', '                ')}
            }
        }
    }`;
    }
};

function writeSummary(packageName, context, slicePackage, readmodel, name, mergeKotlinImports) {
        const scoped = tenantScoped(this.model, (this.model.contexts ?? []).find((item) => contextPackage(item.name) === context)?.name ?? context);
        const eventRefsByName = new Map(this.model.slices.filter(s => contextPackage(s.context) === context)
            .flatMap((candidateSlice) => (candidateSlice.events ?? []).map((event) => [event.name, {slice: candidateSlice, event}])));
        const published = eventRefsByName.get('SystemNotificationPublished');
        const read = eventRefsByName.get('SystemNotificationRead');
        const allRead = eventRefsByName.get('AllSystemNotificationsRead');
        if (!published || !read || !allRead) {
            return;
        }

        const repositoryName = `${name}Repository`;
        const eventImports = [published, read, allRead]
            .map((ref) => `import ${this.model.rootPackage}.${contextPackage(ref.slice.context)}.events.${_eventTitle(ref.event.title)}`)
            .join('\n');
        const fieldImports = readModelStorageImports(readmodel.fields, this.model.rootPackage);
        const imports = mergeKotlinImports(eventImports, fieldImports);

        this.fs.write(this._kotlinPath(`${context}/${slicePackage}/${name}Projector.kt`), `package ${packageName}

${imports}
import org.axonframework.messaging.eventhandling.annotation.EventHandler
import org.axonframework.messaging.eventhandling.EventMessage
import org.axonframework.messaging.core.annotation.Namespace
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional

interface ${name}ProjectionUpdater {
    fun update(
        event: ${_eventTitle(published.event.title)},
        message: EventMessage
    )

    fun update(
        event: ${_eventTitle(read.event.title)},
        message: EventMessage
    )

    fun update(
        event: ${_eventTitle(allRead.event.title)},
        message: EventMessage
    )
}

open class Default${name}ProjectionUpdater(
    private val repository: ${repositoryName}
) : ${name}ProjectionUpdater {
    @Transactional
    open override fun update(
        event: ${_eventTitle(published.event.title)},
        message: EventMessage
    ) {
        val entity = repository.findProjectionById(event.recipientUserId) ?: ${name}Projection().apply {
            recipientUserId = event.recipientUserId
        }
        entity.unreadCount = (entity.unreadCount ?: 0L) + 1L
        entity.latestNotificationId = event.notificationId
        entity.latestSeverity = event.severity
        entity.latestPublishedAt = event.publishedAt
        entity.messageKey = event.messageKey
        entity.fallbackTitle = event.fallbackTitle
        entity.fallbackBody = event.fallbackBody
        entity.toastPolicy = event.toastPolicy
        entity.hasUnreadError = (entity.hasUnreadError == true) || event.severity == NotificationSeverity.ERROR
        repository.save(entity)
    }

    @Transactional
    open override fun update(
        event: ${_eventTitle(read.event.title)},
        message: EventMessage
    ) {
        val entity = repository.findProjectionById(event.recipientUserId) ?: return
        entity.unreadCount = maxOf(0L, (entity.unreadCount ?: 0L) - 1L)
        if (entity.unreadCount == 0L) {
            entity.hasUnreadError = false
        }
        repository.save(entity)
    }

    @Transactional
    open override fun update(
        event: ${_eventTitle(allRead.event.title)},
        message: EventMessage
    ) {
        val entity = repository.findProjectionById(event.recipientUserId) ?: return
        entity.unreadCount = 0L
        entity.hasUnreadError = false
        repository.save(entity)
    }
}

@Configuration(proxyBeanMethods = false)
class ${name}ProjectionUpdaterConfiguration {
    @Bean
    @ConditionalOnMissingBean(${name}ProjectionUpdater::class)
    fun default${name}ProjectionUpdater(
        repository: ${repositoryName}
    ): ${name}ProjectionUpdater =
        Default${name}ProjectionUpdater(repository)
}

@Namespace("${readModelProcessingGroup(readmodel)}")
@Component
class ${name}Projector(
    private val updater: ${name}ProjectionUpdater${scoped ? `,\n    private val tenantExecution: ${this.model.rootPackage}.shared.application.tenancy.TenantExecution = ${this.model.rootPackage}.shared.application.tenancy.TenantExecution()` : ''}
) {
    @EventHandler
    fun on(
        event: ${_eventTitle(published.event.title)},
        message: EventMessage
    ) {
${scoped ? `        tenantExecution.verifyEventTenant(event.medolTenantScope, message)
        tenantExecution.project(
            ${this.model.rootPackage}.shared.application.tenancy.TenantIdentity(event.medolTenantScope, message.metadata()["userId"] ?: "event-projector"), "${packageName}.${name}Projector", message.identifier(), message.metadata()["medol.eventSource"]
        ) { updater.update(event, message) }` : '        updater.update(event, message)'}
    }

    @EventHandler
    fun on(
        event: ${_eventTitle(read.event.title)},
        message: EventMessage
    ) {
${scoped ? `        tenantExecution.verifyEventTenant(event.medolTenantScope, message)
        tenantExecution.project(
            ${this.model.rootPackage}.shared.application.tenancy.TenantIdentity(event.medolTenantScope, message.metadata()["userId"] ?: "event-projector"), "${packageName}.${name}Projector", message.identifier(), message.metadata()["medol.eventSource"]
        ) { updater.update(event, message) }` : '        updater.update(event, message)'}
    }

    @EventHandler
    fun on(
        event: ${_eventTitle(allRead.event.title)},
        message: EventMessage
    ) {
${scoped ? `        tenantExecution.verifyEventTenant(event.medolTenantScope, message)
        tenantExecution.project(
            ${this.model.rootPackage}.shared.application.tenancy.TenantIdentity(event.medolTenantScope, message.metadata()["userId"] ?: "event-projector"), "${packageName}.${name}Projector", message.identifier(), message.metadata()["medol.eventSource"]
        ) { updater.update(event, message) }` : '        updater.update(event, message)'}
    }
}
`);
    }

module.exports = {catalog, summary: {writeProjector: writeSummary}};
