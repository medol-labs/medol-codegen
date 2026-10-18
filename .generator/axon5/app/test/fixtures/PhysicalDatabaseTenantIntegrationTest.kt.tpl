package <%= rootPackage %>.tenancy

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import <%= rootPackage %>.shared.application.tenancy.*
import <%= rootPackage %>.records.createrecord.CreateRecordCommand
import <%= rootPackage %>.records.renamerecord.RenameRecordCommand
import <%= rootPackage %>.records.recordcatalog.*
import java.util.UUID

@SpringBootTest(properties = [
    "spring.config.additional-location=classpath:tenant-test-physical.yml",
    "spring.docker.compose.enabled=false", "spring.flyway.enabled=false",
    "spring.sql.init.mode=always", "spring.sql.init.schema-locations=classpath:tenant-test-physical-control.sql",
    "spring.datasource.url=\${TENANT_TEST_DB_URL:jdbc:h2:mem:physical_control;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE}",
    "spring.datasource.driver-class-name=\${TENANT_TEST_DB_DRIVER:org.h2.Driver}",
    "spring.datasource.username=\${TENANT_TEST_DB_USER:sa}", "spring.datasource.password=\${TENANT_TEST_DB_PASSWORD:}",
    "PHYSICAL_TEST_USER=\${TENANT_TEST_DB_USER:sa}", "PHYSICAL_TEST_PASSWORD=\${TENANT_TEST_DB_PASSWORD:}",
    "spring.datasource.hikari.maximum-pool-size=1", "axon.axonserver.enabled=false", "axon.axonserver.event-store.enabled=false",
    "medol.axon.event-storage=\${TENANT_TEST_PHYSICAL_EVENT_STORAGE:inmemory}",
    "medol.axon.umadb.target=\${TENANT_TEST_UMA_CONTROL_TARGET:127.0.0.1:50051}", "medol.axon.umadb.plaintext=true"
])
@org.springframework.test.context.ContextConfiguration(initializers = [TenantOperationsControlInitializer::class])
@org.springframework.context.annotation.Import(PhysicalDatabaseTenantIntegrationTest.ProbeConfiguration::class)
class PhysicalDatabaseTenantIntegrationTest @Autowired constructor(
    private val properties: TenantStorageProperties, private val resolver: TenantStorageResolver,
    private val provisioner: TenantStorageProvisioner, private val contract: TenantCapabilityContract, private val connections: TenantMigrationConnections,
    private val defaults: org.springframework.boot.autoconfigure.jdbc.DataSourceProperties,
    private val business: TenantBusinessConnections, private val execution: TenantExecution,
    private val manager: PlatformTransactionManager, private val factory: jakarta.persistence.EntityManagerFactory, private val records: RecordCatalogReadModelRepository,
    private val jdbc: JdbcTemplate, private val gateway: CommandGateway, private val probe: ControlProbe,
    private val audit: <%= rootPackage %>.shared.application.metadata.AuditLogRepository
) {
<%- tenantFixture %>
    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods = false)
    class ProbeConfiguration {
        @org.springframework.context.annotation.Bean
        fun controlProbe(factory: jakarta.persistence.EntityManagerFactory) = ControlProbe(org.springframework.orm.jpa.SharedEntityManagerCreator.createSharedEntityManager(factory))
    }
    @TenantControlRepository
    open class ControlProbe(private val manager: jakarta.persistence.EntityManager) {
        open fun count(): Int = (manager.createNativeQuery("SELECT COUNT(*) FROM physical_control.control_probe").singleResult as Number).toInt()
        open fun logicalTenant(): String = TenantScope.requireTenant()
    }
    private fun sql(tenant: String): JdbcTemplate = JdbcTemplate(connections.target(resolver.resolve(tenant).dataSource))
    private fun <T> tenant(id: String, block: () -> T): T = TenantScope.withIdentity(TenantIdentity(id, "test-user"), block)

    @Test
    fun sameBusinessIdIsWrittenAndProjectedInIndependentDatabases() {
        val id = UUID.randomUUID()
        for (scope in listOf("test-tenant", "test-tenant-b")) tenant(scope) {
            gateway.send(CreateRecordCommand(id, scope + "-" + id)).resultMessage.toCompletableFuture().join()
        }
        val deadline = System.nanoTime() + java.time.Duration.ofSeconds(30).toNanos()
        while (System.nanoTime() < deadline) {
            if (tenant("test-tenant") { records.findById(id) } != null && tenant("test-tenant-b") { records.findById(id) } != null) {
                for (scope in listOf("test-tenant", "test-tenant-b")) {
                    assertEquals(scope + "-" + id, sql(scope).queryForObject("SELECT record_name FROM business.records_record_catalog WHERE record_id=?", String::class.java, id))
                }
                assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='business' AND table_name='records_record_catalog'", Int::class.java))
                return
            }
            Thread.sleep(25)
        }
        fail<Unit>("Physical tenant projections did not catch up.")
    }

    @Test
    fun subsequentCommandsRebuildStateOnlyFromTheirBoundEventStore() {
        val id = UUID.randomUUID()
        for (scope in listOf("test-tenant", "test-tenant-b")) tenant(scope) {
            gateway.send(CreateRecordCommand(id, scope + "-" + id)).resultMessage.toCompletableFuture().join()
        }
        tenant("test-tenant") {
            gateway.send(RenameRecordCommand(id, "renamed-" + id)).resultMessage.toCompletableFuture().join()
        }
        val deadline = System.nanoTime() + java.time.Duration.ofSeconds(30).toNanos()
        while (System.nanoTime() < deadline) {
            if (tenant("test-tenant") { records.findById(id)?.recordName } == "renamed-" + id &&
                tenant("test-tenant-b") { records.findById(id)?.recordName } == "test-tenant-b-" + id) return
            Thread.sleep(25)
        }
        fail<Unit>("Expected independent state reconstruction and subsequent projection.")
    }

    @Test
    fun migrationsUseTargetDatabaseAndCannotRebindAProvisionedTenant() {
        for (scope in listOf("test-tenant", "test-tenant-b")) {
            assertEquals(TenantStorageState.READY, provisioner.migrate(scope).state)
            assertEquals(0, sql(scope).queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_name='token_entry'", Int::class.java))
        }
        assertEquals("a", sql("test-tenant").queryForObject("SELECT resource_id FROM medol_storage.database_identity WHERE singleton=1", String::class.java))
        assertThrows(IllegalStateException::class.java) { connections.assertDatabaseIdentity(connections.target("a"), "alias") }
        assertEquals("a", sql("test-tenant").queryForObject("SELECT resource_id FROM medol_storage.database_identity WHERE singleton=1", String::class.java))
        val changed = object : TenantStorageResolver {
            override fun resolve(tenantId: String) = resolver.resolve("test-tenant-b")
        }
        assertThrows(IllegalStateException::class.java) {
            FlywayTenantStorageProvisioner(properties, contract, changed, connections).migrate("test-tenant")
        }
    }

    @Test
    fun controlRepositoriesSuspendTenantTransactionsAndDoNotQueryTheTenantDatabase() {
        val accessContract = contract.copy(accessQuery = "SELECT 1 FROM \"__medol_control__\".access_probe WHERE tenant_id=:tenant AND user_id=:user", accessParameters = emptyMap(), uuidTenantId = false, uuidUserId = false)
        val access = TenantPersistenceConfiguration().sameSchemaTenantAccess(org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate(jdbc.dataSource!!), accessContract, properties, connections)
        TransactionTemplate(manager).executeWithoutResult {
            org.springframework.orm.jpa.EntityManagerFactoryUtils.getTransactionalEntityManager(factory)!!.createNativeQuery("SELECT 1").singleResult
            execution.run(TenantIdentity("test-tenant", "test-user")) {
                records.findById(UUID.randomUUID())
                assertEquals(1, probe.count())
                assertEquals("test-tenant", probe.logicalTenant())
                assertEquals("test-tenant", access.verify("test-tenant", "test-user").tenantId)
                assertDoesNotThrow { audit.count() }
                assertEquals("test-tenant", TenantScope.requireTenant())
                records.findById(UUID.randomUUID())
            }
        }
    }

    @Test
    fun targetTransactionRollsBackAndMissingBindingNeverFallsBackToControlDatabase() {
        val id = UUID.randomUUID()
        assertThrows(IllegalStateException::class.java) {
            execution.run(TenantIdentity("test-tenant", "test-user")) {
                TransactionTemplate(manager).executeWithoutResult {
                    records.save(RecordCatalogReadModelProjection().apply { recordId = id; recordName = "rollback" })
                    error("rollback test")
                }
            }
        }
        assertNull(tenant("test-tenant") { records.findById(id) })
        assertThrows(Exception::class.java) { tenant("unknown") { records.findById(id) } }
    }

    @Test
    fun projectionReceiptsIncludePhysicalEventSourceIdentity() {
        val identity = TenantIdentity("test-tenant", "test-user")
        val event = UUID.randomUUID().toString()
        var applied = 0
        repeat(2) { execution.project(identity, "receipt-test", event, "source-a") { applied++ } }
        execution.project(identity, "receipt-test", event, "source-b") { applied++ }
        assertEquals(2, applied)
    }

    @Test
    fun externallyMigratedPhysicalStorageStillRegistersAndRejectsBindingChanges() {
        val external = properties.copy(migration = TenantMigrationProperties(enabled = false))
        TenantMigrationConnections(external, defaults).use { externalConnections ->
            val existing = FlywayTenantStorageProvisioner(external, contract, resolver, externalConnections)
            existing.register("test-tenant")
            existing.requireReady("test-tenant", "business")
            val changed = object : TenantStorageResolver {
                override fun resolve(tenantId: String) = resolver.resolve(tenantId).copy(version = "changed")
            }
            val conflicting = FlywayTenantStorageProvisioner(external, contract, changed, externalConnections)
            assertThrows(IllegalStateException::class.java) { conflicting.register("test-tenant") }
            assertThrows(org.springframework.security.access.AccessDeniedException::class.java) { conflicting.requireReady("test-tenant", "business") }
        }
    }

    @Test
    fun sharedRelationalSchemaCanRegisterMultiplePhysicalEventBindingsWithoutSchemaOwnershipConflicts() {
        val hybrid = properties.copy(mode = TenantStorageMode.SHARED_SCHEMA, migration = TenantMigrationProperties(), schemas = emptyMap(),
            eventStores = mapOf("hybrid" to TenantEventStoreProperties(target = "unused-test-endpoint:50051")),
            bindings = mapOf("event-only-a" to TenantStorageLocation(properties.controlSchema, eventStore = "hybrid"),
                "event-only-b" to TenantStorageLocation(properties.controlSchema, eventStore = "hybrid")))
        val directory = ConfiguredTenantStorageResolver(hybrid)
        TenantMigrationConnections(hybrid, defaults).use { externalConnections ->
            val runtime = FlywayTenantStorageProvisioner(hybrid, contract, directory, externalConnections)
            for (tenant in hybrid.bindings.keys) { runtime.register(tenant); runtime.requireReady(tenant, hybrid.controlSchema) }
        }
        assertThrows(org.springframework.security.access.AccessDeniedException::class.java) { directory.resolve("unknown") }
    }

    @Test
    fun eventResourceIdentityIncludingTheControlSourceCannotChangeSilently() {
        org.junit.jupiter.api.Assumptions.assumeTrue(properties.eventStores.isNotEmpty())
        for (resource in listOf("default") + properties.eventStores.keys) {
            val before = jdbc.queryForObject("SELECT fingerprint FROM physical_control.medol_tenant_event_resource WHERE resource_id=?", String::class.java, resource)!!
            provisioner.registerEventSource(resource, before)
            assertThrows(IllegalStateException::class.java) { provisioner.registerEventSource(resource, "0".repeat(64)) }
            assertEquals(before, jdbc.queryForObject("SELECT fingerprint FROM physical_control.medol_tenant_event_resource WHERE resource_id=?", String::class.java, resource))
        }
    }

    @Test
    fun physicalEventProcessorsHaveSeparateDurableProgress() {
        org.junit.jupiter.api.Assumptions.assumeTrue(properties.eventStores.isNotEmpty())
        val names = jdbc.queryForList("SELECT DISTINCT processor_name FROM physical_control.token_entry", String::class.java)
        for ((id, settings) in properties.eventStores) {
            val identity = TenantEventStores.digest(id + "\u0000" + settings.generation + "\u0000" + settings.target)
            assertTrue(names.any { it.contains("readmodel-record-catalog") && it.endsWith(identity) })
        }
        assertTrue(names.contains("readmodel-record-catalog"))
    }
}
