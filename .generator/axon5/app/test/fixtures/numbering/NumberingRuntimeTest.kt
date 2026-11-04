package tech.medo.numbering.infrastructure

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import tech.medo.shared.application.numbering.*
import tech.medo.shared.domain.CommandRejectedException
import java.time.*
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.Callable

@org.springframework.test.context.TestExecutionListeners(listeners = [org.springframework.test.context.support.DependencyInjectionTestExecutionListener::class], mergeMode = org.springframework.test.context.TestExecutionListeners.MergeMode.REPLACE_DEFAULTS)
@SpringBootTest(properties = [
    "spring.docker.compose.enabled=false", "spring.flyway.enabled=false",
    "spring.datasource.url=jdbc:h2:mem:numbering;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;LOCK_TIMEOUT=15000",
    "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
    "spring.jpa.hibernate.ddl-auto=create-drop", "axon.axonserver.enabled=false", "axon.axonserver.event-store.enabled=false",
    "axon.update-check.disabled=true", "medol.axon.event-storage=inmemory",
    "medol.axon.flow-logging.enabled=false", "medol.security.admin-bootstrap.enabled=false",
    "medol.numbering.outbox-delay-ms=3600000"
])
class NumberingRuntimeTest @Autowired constructor(private val service: NumberingService,
    private val transactions: PlatformTransactionManager,
    private val publisher: NumberingOutboxPublisher,
    private val ruleUpdater: tech.medo.numbering.numberingrulecatalog.NumberingRuleCatalogReadModelProjectionUpdater,
    private val rules: tech.medo.numbering.numberingrulecatalog.NumberingRuleCatalogReadModelRepository,
    private val allocations: tech.medo.numbering.numberallocationcatalog.NumberAllocationCatalogReadModelRepository,
    private val orders: tech.medo.orders.ordercatalog.OrderCatalogReadModelRepository,
    private val gateway: org.axonframework.messaging.commandhandling.gateway.CommandGateway,
    private val mapper: com.fasterxml.jackson.databind.ObjectMapper,
    private val jdbc: org.springframework.jdbc.core.JdbcTemplate) {
    private fun config(scope: String = "GLOBAL", width: Int = 5, start: Long = 1): NumberingConfiguration {
        val key = UUID.randomUUID().toString()
        return NumberingConfiguration(key, key, "N", "", "", "UTC", "NEVER", scope, width, start)
    }
    private fun active(c: NumberingConfiguration): UUID {
        val id = UUID.randomUUID(); service.define(id, c); service.change(id, 1, "activate"); return id
    }
    private fun req(c: NumberingConfiguration, key: String = UUID.randomUUID().toString(), count: Int = 1, tenant: String? = null) =
        NumberAllocationRequest(c.ruleCode, key, "order-$key", count, tenant)

    @Test fun lifecycleAndRetryAcrossVersionAndMidnight() {
        val c = config().copy(dateFormat="yyyyMMdd", resetPeriod="DAY")
        val id = UUID.randomUUID(); service.define(id,c)
        assertThrows(CommandRejectedException::class.java) { service.allocate(req(c)) }
        service.change(id,1,"activate")
        service.clock = Clock.fixed(Instant.parse("2026-11-04T23:59:59Z"), ZoneOffset.UTC)
        val request = req(c,count=2); val first=service.allocate(request)
        assertEquals(listOf("N2026110400001", "N2026110400002"), first.codes)
        service.clock = Clock.fixed(Instant.parse("2026-11-05T00:00:01Z"), ZoneOffset.UTC)
        assertEquals(first, service.allocate(request))
        assertEquals("N2026110500001", service.allocate(req(c)).codes.single())
        service.change(id,2,"suspend")
        assertEquals(first, service.allocate(request))
        assertThrows(CommandRejectedException::class.java) { service.allocate(req(c)) }
        assertThrows(CommandRejectedException::class.java) { service.allocate(request.copy(count=1)) }
        assertThrows(CommandRejectedException::class.java) { service.allocate(request.copy(ownerKey="other")) }
        assertThrows(CommandRejectedException::class.java) { service.change(id,2,"resume") }
        assertThrows(CommandRejectedException::class.java) { service.change(id,3,"revise",c.copy(numberNamespace="other")) }
        service.change(id,3,"revise",c.copy(prefix="V")); service.change(id,4,"activate")
        assertEquals(first,service.allocate(request))
        assertEquals("V2026110500002",service.allocate(req(c)).codes.single())
        service.clock=Clock.systemUTC()
    }
    @Test fun parallelBatchAndSingleAllocationsAndSameKeyRetries() {
        val c=config(); active(c)
        val pool=Executors.newFixedThreadPool(8)
        try {
            val requests=(1..30).map { req(c,count=if(it%2==0) 3 else 1) }
            val results=pool.invokeAll(requests.map { r -> Callable { service.allocate(r) } }).map { it.get() }
            val codes=results.flatMap{it.codes}
            assertEquals(60,codes.size); assertEquals(60,codes.toSet().size)
            assertEquals((1..60).toSet(),codes.map{it.drop(1).toInt()}.toSet())
            val same=req(c)
            val retries=pool.invokeAll((1..10).map { Callable { service.allocate(same) } }).map{it.get()}
            assertEquals(1,retries.toSet().size)
            assertEquals("N00062",service.allocate(req(c)).codes.single())
        } finally { pool.shutdownNow() }
    }
    @Test fun overflowRollsBackWholeBatchAndOuterRollbackDoesNotReuse() {
        val c=config(width=2,start=98); active(c)
        assertThrows(CommandRejectedException::class.java) { service.allocate(req(c,count=3)) }
        assertEquals(listOf("N98","N99"),service.allocate(req(c,count=2)).codes)
        assertThrows(CommandRejectedException::class.java) { service.allocate(req(c)) }
        val other=config(); active(other); val request=req(other)
        TransactionTemplate(transactions).execute { status -> service.allocate(request); status.setRollbackOnly() }
        assertEquals("N00001",service.allocate(request).codes.single())
        assertEquals("N00002",service.allocate(req(other)).codes.single())
    }
    @Test fun scopeNamespaceAndCollisionProtection() {
        val c=config(scope="TENANT"); active(c)
        assertThrows(CommandRejectedException::class.java) { service.allocate(req(c)) }
        assertEquals("N00001",service.allocate(req(c,tenant="A")).codes.single())
        assertEquals("N00001",service.allocate(req(c,tenant="B")).codes.single())
        val g=config(); active(g)
        assertEquals("N00001",service.allocate(req(g,tenant="A")).codes.single())
        assertEquals("N00002",service.allocate(req(g,tenant="B")).codes.single())
        val shared=g.copy(ruleCode=UUID.randomUUID().toString());active(shared)
        assertEquals("N00003",service.allocate(req(shared)).codes.single())
        val collision=g.copy(ruleCode=UUID.randomUUID().toString(), resetPeriod="YEAR",dateFormat="yyyy",prefix="",sequenceWidth=1)
        val collisionId=active(collision)
        service.clock=Clock.fixed(Instant.parse("2026-11-04T00:00:00Z"),ZoneOffset.UTC)
        assertEquals("20261",service.allocate(req(collision)).codes.single())
        service.change(collisionId,2,"suspend")
        service.change(collisionId,3,"revise",collision.copy(resetPeriod="NEVER",dateFormat="",prefix="2026"))
        service.change(collisionId,4,"activate")
        // Shared NEVER counter already reached 3, so the changed format uses 4 rather than reusing 1.
        assertEquals("20264",service.allocate(req(collision)).codes.single())
        service.clock=Clock.systemUTC()
    }
    @Test fun commandBindingAndDurableEventsReachRealProjections() {
        val c=config().copy(ruleCode="order"); active(c)
        val id=UUID.randomUUID()
        gateway.send(tech.medo.orders.createorder.CreateOrderCommand(id,"FORGED")).resultMessage.join()
        publisher.publishPending()
        val deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(15)
        while(System.nanoTime()<deadline) {
            val order=orders.findById(id)
            if(order!=null) {
                assertEquals("N00001",order.orderCode)
                val receipt=jdbc.queryForList("select id from medol_numbering_receipt", UUID::class.java)
                if(receipt.any { allocations.findById(it)?.ruleCode=="order" }) return
            }
            Thread.sleep(50)
        }
        fail<Unit>("Numbering event or numbered business event did not reach its actual Axon projector")
    }
    @Test fun remoteClientPreservesKeysAndRequiresInternalCredential() {
        val builder=org.springframework.web.client.RestClient.builder()
        val server=org.springframework.test.web.client.MockRestServiceServer.bindTo(builder).build()
        val environment=org.springframework.mock.env.MockEnvironment().withProperty("medol.numbering.base-url","http://numbering.test")
        val factory=org.springframework.beans.factory.support.DefaultListableBeanFactory()
        val security=tech.medo.shared.security.MedolSecurityProperties(internalToken="test-secret")
        val client=NumberingClient(factory.getBeanProvider(LocalNumberingAllocator::class.java),environment,builder,security)
        val request=req(config(),key="stable",count=2,tenant="tenant-A")
        val expected=NumberAllocationResult(UUID.randomUUID(),listOf("N01","N02"),2)
        server.expect(org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo("http://numbering.test/internal/numbering/allocate"))
            .andExpect(org.springframework.test.web.client.match.MockRestRequestMatchers.header("X-MEDOL-INTERNAL-TOKEN","test-secret"))
            .andExpect(org.springframework.test.web.client.match.MockRestRequestMatchers.content().json(mapper.writeValueAsString(request)))
            .andRespond(org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess(mapper.writeValueAsString(expected),org.springframework.http.MediaType.APPLICATION_JSON))
        assertEquals(expected,client.allocate(request));server.verify()
        val endpoint=NumberingEndpoints(service,security)
        assertThrows(org.springframework.security.access.AccessDeniedException::class.java) { endpoint.allocate(request,org.springframework.mock.web.MockHttpServletRequest()) }
        security.internalToken=""
        assertThrows(IllegalArgumentException::class.java) { client.allocate(request) }
    }
    @Test fun remoteBusinessRejectionRemainsACommandRejection() {
        val builder=org.springframework.web.client.RestClient.builder()
        val server=org.springframework.test.web.client.MockRestServiceServer.bindTo(builder).build()
        val client=NumberingClient(org.springframework.beans.factory.support.DefaultListableBeanFactory().getBeanProvider(LocalNumberingAllocator::class.java),
            org.springframework.mock.env.MockEnvironment().withProperty("medol.numbering.base-url","http://numbering.test"), builder,
            tech.medo.shared.security.MedolSecurityProperties(internalToken="secret"))
        server.expect(org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo("http://numbering.test/internal/numbering/allocate"))
            .andRespond(org.springframework.test.web.client.response.MockRestResponseCreators.withStatus(org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY)
                .contentType(org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON)
                .body("""{"status":422,"detail":"Numbering rule is not Active","code":"NUMBERING_RULE_UNAVAILABLE"}"""))
        val error=assertThrows(CommandRejectedException::class.java) { client.allocate(req(config())) }
        assertEquals("NUMBERING_RULE_UNAVAILABLE", error.code); server.verify()
    }
    @Test fun oldAndConcurrentRuleEventsCannotRewindTheCatalog() {
        val c=config(); val id=active(c)
        val defined=tech.medo.numbering.events.NumberingRuleDefinedEvent(id,c.ruleCode,c.numberNamespace,c.prefix,c.suffix,c.dateFormat,c.timeZone,c.resetPeriod,c.allocationScope,c.sequenceWidth,c.startAt,1,"Draft")
        val activated=tech.medo.numbering.events.NumberingRuleActivatedEvent(id,c.ruleCode,c.numberNamespace,c.prefix,c.suffix,c.dateFormat,c.timeZone,c.resetPeriod,c.allocationScope,c.sequenceWidth,c.startAt,2,"Active")
        val suspended=tech.medo.numbering.events.NumberingRuleSuspendedEvent(id,c.ruleCode,c.numberNamespace,c.prefix,c.suffix,c.dateFormat,c.timeZone,c.resetPeriod,c.allocationScope,c.sequenceWidth,c.startAt,3,"Suspended")
        fun message(event:Any)=org.axonframework.messaging.eventhandling.GenericEventMessage(org.axonframework.messaging.core.MessageType(event.javaClass),event)
        // Start without a projection row: first-event races must also serialize.
        val pool=Executors.newFixedThreadPool(4)
        try {
            pool.invokeAll((1..20).map { index -> Callable {
                if(index%2==0) ruleUpdater.update(activated,message(activated)) else ruleUpdater.update(suspended,message(suspended))
            } }).forEach { it.get() }
        } finally { pool.shutdownNow() }
        ruleUpdater.update(defined,message(defined))
        assertEquals(3L,rules.findById(id)?.ruleVersion)
        assertEquals("Suspended",rules.findById(id)?.state)
    }
    @Test fun previewAcceptsOmittedOptionalFormatParts() {
        val c=config()
        val node=mapper.valueToTree<com.fasterxml.jackson.databind.node.ObjectNode>(c)
        node.remove(listOf("prefix","suffix","dateFormat"))
        val restored=mapper.treeToValue(node,NumberingConfiguration::class.java)
        assertEquals("00001",service.preview(restored))
    }
    @Test fun concurrentRuleCreationAndSharedNamespaceInitialization() {
        val pool=Executors.newFixedThreadPool(8)
        try {
            val c=config(); val id=UUID.randomUUID()
            val snapshots=pool.invokeAll((1..8).map { Callable { service.define(id,c) } }).map{it.get()}
            assertEquals(1,snapshots.toSet().size)
            val duplicate=config()
            val outcomes=pool.invokeAll((1..8).map { Callable {
                try { service.define(UUID.randomUUID(),duplicate); "created" }
                catch(error:CommandRejectedException) { error.code }
            } }).map{it.get()}
            assertEquals(1,outcomes.count{it=="created"})
            assertEquals(7,outcomes.count{it=="NUMBERING_RULE_EXISTS"})
            val shared=config()
            val configurations=(1..8).map { shared.copy(ruleCode=UUID.randomUUID().toString()).also{active(it)} }
            val results=pool.invokeAll(configurations.map { c -> Callable { service.allocate(req(c,count=2)) } }).map{it.get()}
            assertEquals((1..16).toSet(),results.flatMap{it.codes}.map{it.drop(1).toInt()}.toSet())
        } finally { pool.shutdownNow() }
    }
    @Test fun previewNoWritesAndReceiptAndEventPersistAtomically() {
        val c=config(); active(c)
        val before=jdbc.queryForObject("select count(*) from medol_numbering_receipt", Long::class.java)
        assertEquals("N00001",service.preview(c))
        assertEquals(before,jdbc.queryForObject("select count(*) from medol_numbering_receipt", Long::class.java))
        val result=service.allocate(req(c))
        assertEquals(1,jdbc.queryForObject("select count(*) from medol_numbering_receipt where id=?",Int::class.java,result.allocationId))
        assertTrue(jdbc.queryForList("select payload_json from medol_numbering_outbox where event_kind='NumberAllocatedEvent'",String::class.java).any{it.contains(result.allocationId.toString())})
        val id=UUID.randomUUID()
        val command=mapper.readValue("""{"orderId":"$id","orderCode":"FORGED"}""",tech.medo.orders.createorder.CreateOrderCommand::class.java)
        assertEquals("",command.orderCode)
    }
}
