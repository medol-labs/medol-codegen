package <%= rootPackage %>.auditcheck

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import <%= rootPackage %>.operationaudit.operationauditcatalog.*
import <%= rootPackage %>.shared.application.metadata.*
import java.time.Instant
import java.util.UUID

@org.springframework.test.context.TestExecutionListeners(listeners = [org.springframework.test.context.support.DependencyInjectionTestExecutionListener::class], mergeMode = org.springframework.test.context.TestExecutionListeners.MergeMode.REPLACE_DEFAULTS)
@SpringBootTest(properties = [
    "spring.docker.compose.enabled=false", "spring.flyway.enabled=false",
    "spring.datasource.url=jdbc:h2:mem:audit-spring;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
    "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
    "spring.jpa.hibernate.ddl-auto=create-drop", "axon.axonserver.enabled=false", "axon.axonserver.event-store.enabled=false",
    "axon.update-check.disabled=true", "medol.axon.event-storage=inmemory",
    "medol.axon.flow-logging.enabled=false", "medol.security.admin-bootstrap.enabled=false"
])
class OperationAuditSpringTest @Autowired constructor(private val publisher: OperationAuditPublisher,
    private val repository: OperationAuditCatalogReadModelRepository,
    private val store: org.axonframework.eventsourcing.eventstore.EventStore,
    private val mapper: com.fasterxml.jackson.databind.ObjectMapper) {
    @Test fun publishedAuditReachesStreamingProjection() {
        val trace = UUID.randomUUID().toString()
        val observation = OperationAuditObservation("COMMAND", "SpringWiringProbe", "REJECTED", Instant.now(), correlationId = trace)
        val envelope = OperationExecutionRecorded(UUID.randomUUID(), "application", observation)
        assertEquals(envelope, mapper.readValue(mapper.writeValueAsBytes(envelope), OperationExecutionRecorded::class.java))
        publisher.record(observation)
        val event = <%= rootPackage %>.records.events.RecordChangedEvent(UUID.randomUUID())
        store.publish(null, listOf(org.axonframework.messaging.eventhandling.GenericEventMessage(
            org.axonframework.messaging.core.MessageType(event.javaClass), event, mapOf("correlationId" to trace)
        ))).join()
        val deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(15)
        while (System.nanoTime() < deadline) {
            val result = run { repository.findAllByFilter(null, null, null, null, null, null, null, null, trace, null, null, null, org.springframework.data.domain.Pageable.unpaged()) }
            if (result.content.map { it.category }.toSet() == setOf("COMMAND", "EVENT")) {
                assertEquals(2, result.totalElements)
                return
            }
            Thread.sleep(50)
        }
        fail<Unit>("Published audit was not consumed by the actual Spring/Axon processor")
    }
}
