package <%= rootPackage %>.auditcheck

import <%= rootPackage %>.operationaudit.operationauditcatalog.*
import <%= rootPackage %>.shared.domain.CommandRejectedException
import <%= rootPackage %>.shared.application.metadata.*
import org.axonframework.eventsourcing.eventstore.*
import org.axonframework.eventsourcing.eventstore.inmemory.InMemoryEventStorageEngine
import org.axonframework.messaging.eventhandling.*
import org.axonframework.messaging.eventstreaming.StreamingCondition
import org.axonframework.messaging.core.*
import org.axonframework.messaging.commandhandling.*
import org.axonframework.messaging.core.unitofwork.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.web.servlet.HandlerMapping
import java.lang.reflect.Proxy
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionException

@org.junit.jupiter.api.Timeout(20)
class OperationAuditRuntimeTest {
    private val dataSource = DriverManagerDataSource("jdbc:h2:mem:audit-${UUID.randomUUID()};DB_CLOSE_DELAY=-1", "sa", "")
    private val jdbc = JdbcTemplate(dataSource).also { it.execute("create table records(id varchar primary key, outcome varchar, category varchar, actor varchar, detail varchar)") }
    private val transactions = DataSourceTransactionManager(dataSource)
    private val observations = java.util.concurrent.CopyOnWriteArrayList<OperationAuditCatalogReadModelProjection>()
    private var failProjection = false
    private val repository = Proxy.newProxyInstance(javaClass.classLoader, arrayOf(OperationAuditCatalogReadModelRepository::class.java)) { _, method, args ->
        when(method.name) {
            "findById" -> observations.find { it.auditRecordId == args!![0] }?.toReadModel()
            "save" -> {
                if (failProjection) error("projection storage unavailable")
                val row = args!![0] as OperationAuditCatalogReadModelProjection
                jdbc.update("insert into records values(?,?,?,?,?)", row.auditRecordId.toString(), row.outcome, row.category, row.actorId, row.operation)
                observations.add(row)
                null
            }
            "toString" -> "AuditTestRepository"
            else -> error("Unexpected method ${method.name}")
        }
    } as OperationAuditCatalogReadModelRepository
    private val engine = InMemoryEventStorageEngine()
    private val store = StorageEngineBackedEventStore(engine, SimpleEventBus(), TagResolver { emptySet() })
    private val stores = org.springframework.beans.factory.support.StaticListableBeanFactory(mapOf("eventStore" to store)).getBeanProvider(EventStore::class.java)
    private val recorder = OperationAuditPublisher(stores, transactions)
    private val projector = AuditTrailProjection(repository, transactions)
    private fun storedEvents(): List<EventMessage> {
        val stream = engine.stream(StreamingCondition.startingFrom(engine.firstToken().join()))
        val result = mutableListOf<EventMessage>()
        try {
            while (stream.hasNextAvailable()) result.add(stream.next().get().message())
        } finally { stream.close() }
        return result
    }
    private fun projectStoredEvents() { storedEvents().forEach { projector.on(it.payload()!!, it) } }
    private val config = OperationAuditConfiguration(recorder)
    private val factory = SimpleUnitOfWorkFactory(object : ApplicationContext {
        override fun <C : Any> component(type: Class<C>, name: String?): C = error("No component required: $type")
    }) { it }

    private fun runCommand(result: CompletableFuture<GenericMessage>, failCommit: Boolean = false): CompletableFuture<*> {
        val message = GenericCommandMessage(MessageType("TestOperation"), "PASSWORD=must-not-be-stored", mapOf("userId" to "trusted-user", "correlationId" to "trace-1"))
        return factory.create().executeWithResult<Unit> { context ->
            if (failCommit) context.onCommit { CompletableFuture.failedFuture<Void>(IllegalStateException("sensitive commit failure")) }
            config.operationAuditCommands().interceptOnHandle(message, context, MessageHandlerInterceptorChain { _, _ -> MessageStream.fromFuture(result) })
                .reduce(Unit) { _, _ -> Unit }.thenApply { Unit }
        }
    }

    private fun awaitRecords(count: Int) {
        val deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5)
        while (observations.size < count && System.nanoTime() < deadline) { projectStoredEvents(); Thread.sleep(10) }
        assertEquals(count, observations.size, "Completion callbacks must persist the final audit")
    }

    @Test fun asynchronousSuccessIsNotRecordedBeforeCommitAndDoesNotStorePayload() {
        val result = CompletableFuture<GenericMessage>()
        val execution = runCommand(result)
        assertEquals(0, observations.size)
        result.complete(GenericMessage(MessageType("Result"), "TOKEN=secret"))
        execution.join()
        awaitRecords(1)
        assertEquals(1, observations.size)
        assertEquals("SUCCEEDED", observations.single().outcome)
        assertEquals("trusted-user", observations.single().actorId)
        assertEquals("trace-1", observations.single().correlationId)
        assertFalse(observations.single().operation!!.contains("PASSWORD"))
    }

    @Test fun rejectedAndCommitFailedOperationsAreNeverRecordedAsSucceeded() {
        assertThrows(CompletionException::class.java) {
            runCommand(CompletableFuture.failedFuture(CommandRejectedException("INVALID_STATE", "invalidState", message = "secret input"))).join()
        }
        awaitRecords(1)
        assertEquals("REJECTED", observations.single().outcome)
        assertEquals("INVALID_STATE", observations.single().errorCode)
        assertThrows(CompletionException::class.java) {
            runCommand(CompletableFuture.completedFuture(GenericMessage(MessageType("Result"), "ok")), true).join()
        }
        awaitRecords(2)
        assertEquals(listOf("REJECTED", "FAILED"), observations.map { it.outcome })
    }

    @Test fun auditInsertSurvivesBusinessRollback() {
        TransactionTemplate(transactions).executeWithoutResult { outer ->
            recorder.record(OperationAuditObservation("COMMAND", "RejectedOperation", "REJECTED", Instant.now()))
            outer.setRollbackOnly()
        }
        assertEquals(1, storedEvents().size)
        assertTrue(observations.isEmpty(), "Capture must not write the read model directly")
        projectStoredEvents()
        assertEquals(1, jdbc.queryForObject("select count(*) from records", Int::class.java))
    }

    @Test fun httpRejectIgnoresSpoofedIdentityAndSecretUrlAndBody() {
        val request = MockHttpServletRequest("POST", "/private/SECRET_TOKEN")
        request.addHeader("X-User-Id", "spoofed-user")
        request.addHeader("X-Tenant-Id", "spoofed-tenant")
        request.queryString = "password=SECRET_PASSWORD"
        val response = MockHttpServletResponse()
        OperationAuditHttpFilter(recorder).doFilter(request, response) { _, _ -> response.status = 401 }
        projectStoredEvents()
        assertEquals("REJECTED", observations.single().outcome)
        assertEquals("POST UNMAPPED", observations.single().operation)
        assertNull(observations.single().actorId)
        assertNull(observations.single().auditTenantId)
        assertEquals(401, observations.single().httpStatus)
        assertNotEquals("spoofed-user", MetadataFactory.from(request)["userId"])
        assertEquals(observations.single().correlationId, MetadataFactory.from(request)["correlationId"])
    }

    @Test fun replayIsIdempotentAndAuditEventDoesNotBecomeAnotherBusinessEventRecord() {
        recorder.record(OperationAuditObservation("COMMAND", "Change", "SUCCEEDED", Instant.now()))
        val business = GenericEventMessage(MessageType("ExampleBusinessEvent"), "SECRET_PAYLOAD", mapOf("correlationId" to "trace-business"))
        store.publish(null, listOf(business)).join()
        projectStoredEvents()
        projectStoredEvents()
        assertEquals(2, observations.size)
        assertEquals(setOf("COMMAND", "EVENT"), observations.map { it.category }.toSet())
        assertEquals(2, storedEvents().size, "Projection must not publish more audit events")
        assertEquals("RECORDED", observations.first { it.category == "EVENT" }.outcome)
        assertFalse(observations.any { it.operation!!.contains("SECRET") })
    }

    @Test fun projectionFailureRemainsReplayableAndDoesNotSwallowError() {
        recorder.record(OperationAuditObservation("COMMAND", "Change", "REJECTED", Instant.now()))
        failProjection = true
        assertThrows(IllegalStateException::class.java) { projectStoredEvents() }
        assertEquals(1, storedEvents().size)
        failProjection = false
        projectStoredEvents()
        assertEquals(1, observations.size)
    }

    @Test fun asyncHttpCompletionRecordsOnceWithFinalStatus() {
        val request = MockHttpServletRequest("GET", "/items/secret-id")
        request.isAsyncSupported = true
        request.setAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE, "/items/{id}")
        val response = MockHttpServletResponse()
        OperationAuditHttpFilter(recorder).doFilter(request, response) { _, _ -> request.startAsync(request, response) }
        assertTrue(observations.isEmpty())
        response.status = 403
        request.asyncContext.complete()
        projectStoredEvents()
        assertEquals(1, observations.size)
        assertEquals("GET /items/{id}", observations.single().operation)
        assertEquals("REJECTED", observations.single().outcome)
    }
}
