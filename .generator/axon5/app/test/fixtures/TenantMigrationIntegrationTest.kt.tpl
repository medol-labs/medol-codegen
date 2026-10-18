package <%= rootPackage %>.tenancy

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.access.AccessDeniedException
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import <%= rootPackage %>.shared.application.tenancy.*
import <%= rootPackage %>.records.createrecord.CreateRecordCommand
import <%= rootPackage %>.records.recordcatalog.RecordCatalogReadModelRepository
import java.util.UUID

@SpringBootTest(properties = [
    "spring.config.additional-location=classpath:tenant-test-storage.yml",
    "spring.docker.compose.enabled=false", "spring.flyway.enabled=false",
    "spring.sql.init.mode=always", "spring.sql.init.schema-locations=classpath:tenant-test-control.sql",
    "spring.datasource.url=\${TENANT_TEST_DB_URL:jdbc:h2:mem:tenant-managed-migration;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE}",
    "spring.datasource.driver-class-name=\${TENANT_TEST_DB_DRIVER:org.h2.Driver}",
    "spring.datasource.username=\${TENANT_TEST_DB_USER:sa}", "spring.datasource.password=\${TENANT_TEST_DB_PASSWORD:}",
    "spring.datasource.hikari.maximum-pool-size=1",
    "axon.axonserver.enabled=false", "axon.axonserver.event-store.enabled=false",
    "medol.axon.event-storage=inmemory"
])
@org.springframework.test.context.ContextConfiguration(initializers = [TenantOperationsControlInitializer::class])
class TenantMigrationIntegrationTest @Autowired constructor(
    private val provisioner: TenantStorageProvisioner,
    private val properties: TenantStorageProperties,
    private val contract: TenantCapabilityContract,
    private val connections: TenantMigrationConnections,
    private val jdbc: JdbcTemplate,
    private val records: RecordCatalogReadModelRepository,
    private val gateway: CommandGateway
) {
<%- tenantFixture %>
    private fun <T> tenant(id: String, block: () -> T): T = TenantScope.withIdentity(TenantIdentity(id, "test-user"), block)
    private fun runtime(tenantId: String, schema: String, definition: TenantCapabilityContract = contract): TenantStorageProvisioner =
        FlywayTenantStorageProvisioner(properties, definition, object : TenantStorageResolver {
            override fun resolve(id: String): TenantStorageLocation {
                check(id == tenantId)
                return TenantStorageLocation(schema)
            }
        }, connections)

    @Test
    fun startupCreatesSchemasAppliesGeneratedAndCustomMigrationsAndRoutesCommands() {
        assertEquals("managed_custom", properties.schemas["Company.A-1"])
        for (id in listOf("test-tenant", "test-tenant-b", "Company.A-1")) {
            assertEquals(TenantStorageState.READY, provisioner.status(id).state)
            assertEquals("2", provisioner.status(id).version)
        }
        val id = UUID.randomUUID()
        for (scope in listOf("test-tenant", "test-tenant-b")) tenant(scope) {
            gateway.send(CreateRecordCommand(id, "managed-" + id)).resultMessage.toCompletableFuture().join()
        }
        val deadline = System.nanoTime() + java.time.Duration.ofSeconds(8).toNanos()
        while (System.nanoTime() < deadline) {
            if (tenant("test-tenant") { records.findById(id) } != null && tenant("test-tenant-b") { records.findById(id) } != null) {
                assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM managed_a.records_record_catalog WHERE record_id=?", Int::class.java, id))
                assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM managed_b.records_record_catalog WHERE record_id=?", Int::class.java, id))
                return
            }
            Thread.sleep(20)
        }
        fail<Unit>("Expected projected rows in automatically migrated schemas.")
    }

    @Test
    fun rerunningMigrationDoesNotRecreateOrDuplicateRows() {
        val before = jdbc.queryForObject("SELECT COUNT(*) FROM managed_a." + contract.migrationHistoryTable, Int::class.java)
        provisioner.migrate("test-tenant")
        provisioner.migrate("test-tenant")
        assertEquals(before, jdbc.queryForObject("SELECT COUNT(*) FROM managed_a." + contract.migrationHistoryTable, Int::class.java))
        assertEquals(TenantStorageState.READY, provisioner.status("test-tenant").state)
    }

    @Test
    fun incompatibleModelFailsClosedAndCanRetryAfterContractIsCorrected() {
        val tenant = "recovery-tenant"
        val good = contract.copy(deploymentId = "recovery", migrationHistoryTable = "recovery_tenant_history")
        val bad = good.copy(tenantSchemaHash = "unmigrated-model", tenantSchema = good.tenantSchema.map { table ->
            if (table.name == "records_record_catalog") table.copy(columns = table.columns + TenantColumnDefinition("missing_field", "varchar(255)")) else table
        })
        val failed = runtime(tenant, "managed_recovery", bad)
        assertThrows(IllegalStateException::class.java) { failed.migrate(tenant) }
        assertEquals(TenantStorageState.FAILED, failed.status(tenant).state)
        assertEquals("MIGRATION_FAILED", failed.status(tenant).errorCode)
        assertThrows(AccessDeniedException::class.java) { failed.requireReady(tenant, "managed_recovery") }
        val corrected = runtime(tenant, "managed_recovery", good)
        assertEquals(TenantStorageState.READY, corrected.migrate(tenant).state)
        corrected.requireReady(tenant, "managed_recovery")
        assertThrows(AccessDeniedException::class.java) { failed.requireReady(tenant, "managed_recovery") }
    }

    @Test
    fun schemaOwnershipCannotBeReassignedToAnotherTenant() {
        assertThrows(IllegalStateException::class.java) { runtime("intruder", "managed_a").migrate("intruder") }
        assertEquals(TenantStorageState.READY, provisioner.status("test-tenant").state)
    }

    @Test
    fun readinessIsNotCachedAcrossMigrationStateOrDeploymentVersionChanges() {
        tenant("test-tenant") { records.findById(UUID.randomUUID()) }
        val table = properties.controlSchema + ".medol_tenant_storage_progress"
        val original = provisioner.status("test-tenant")
        try {
            jdbc.update("UPDATE $table SET state='MIGRATING' WHERE tenant_id=? AND deployment_id=?", "test-tenant", contract.deploymentId)
            assertThrows(Exception::class.java) { tenant("test-tenant") { records.findById(UUID.randomUUID()) } }
            jdbc.update("UPDATE $table SET state='READY', bundle_hash=? WHERE tenant_id=? AND deployment_id=?", "0".repeat(64), "test-tenant", contract.deploymentId)
            assertThrows(AccessDeniedException::class.java) { provisioner.requireReady("test-tenant", "managed_a") }
        } finally {
            jdbc.update("UPDATE $table SET state='READY', bundle_hash=? WHERE tenant_id=? AND deployment_id=?", original.bundleHash, "test-tenant", contract.deploymentId)
        }
    }

    @Test
    fun eachDeploymentMaintainsItsOwnHistoryInSharedTenantSchema() {
        val second = contract.copy(deploymentId = "second-module", migrationLocation = "db/tenant-migration/second-module", migrationHistoryTable = "second_module_history", tenantSchemaHash = "second-module-schema",
            tenantSchema = listOf(
                TenantTableDefinition("secondary_projection", listOf(TenantColumnDefinition("id", "uuid")), listOf("id")),
                contract.tenantSchema.single { it.name == "medol_tenant_projection_receipt" }
            ))
        assertEquals(TenantStorageState.READY, runtime("test-tenant", "managed_a", second).migrate("test-tenant").state)
        assertEquals(TenantStorageState.READY, provisioner.status("test-tenant").state)
        assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM " + properties.controlSchema + ".medol_tenant_storage_progress WHERE tenant_id='test-tenant' AND deployment_id IN (?, ?)", Int::class.java, contract.deploymentId, "second-module"))
    }

    @Test
    fun allGeneratedStorageTypesAreValidatedUsingDriverMetadata() {
        val table = TenantTableDefinition("storage_types", listOf(
            TenantColumnDefinition("id", "uuid"), TenantColumnDefinition("name", "varchar(255)"),
            TenantColumnDefinition("notes", "text"), TenantColumnDefinition("count_value", "integer"),
            TenantColumnDefinition("total", "bigint"), TenantColumnDefinition("ratio", "double precision"),
            TenantColumnDefinition("weight", "real"), TenantColumnDefinition("amount", "numeric(38,2)"),
            TenantColumnDefinition("active", "boolean"), TenantColumnDefinition("on_date", "date"),
            TenantColumnDefinition("at_time", "timestamp(6)")
        ), listOf("id"))
        val definition = contract.copy(deploymentId = "storage-types", migrationLocation = "db/tenant-migration/types", migrationHistoryTable = "storage_types_history", tenantSchemaHash = "types-v1", tenantSchema = listOf(table))
        val valid = runtime("types-tenant", "managed_types", definition)
        assertEquals(TenantStorageState.READY, valid.migrate("types-tenant").state)
        val wrong = definition.copy(tenantSchemaHash = "wrong-types", tenantSchema = listOf(table.copy(columns = table.columns.map {
            if (it.name == "count_value") it.copy(type = "bigint") else it
        })))
        assertThrows(IllegalStateException::class.java) { runtime("types-tenant", "managed_types", wrong).migrate("types-tenant") }
        assertEquals(TenantStorageState.READY, valid.migrate("types-tenant").state)
    }

    @Test
    fun concurrentMigrationAttemptsSerializeAndRemainIdempotent() {
        val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val attempts = (1..2).map {
                java.util.concurrent.CompletableFuture.supplyAsync({ runtime("test-tenant", "managed_a").migrate("test-tenant") }, pool)
            }
            attempts.forEach { assertEquals(TenantStorageState.READY, it.join().state) }
        } finally { pool.shutdownNow() }
    }

    @Test
    fun olderDeploymentCannotIgnoreAlreadyAppliedFutureMigrations() {
        val older = runtime("test-tenant", "managed_a", contract.copy(migrationLocation = "db/tenant-migration/older"))
        try {
            assertThrows(IllegalStateException::class.java) { older.migrate("test-tenant") }
            assertEquals(TenantStorageState.FAILED, older.status("test-tenant").state)
        } finally { provisioner.migrate("test-tenant") }
    }

    @Test
    fun failedSqlIsRecordedAndNeverAutomaticallyRepairedOrCleaned() {
        val broken = runtime("broken-tenant", "managed_broken", contract.copy(deploymentId = "broken", migrationLocation = "db/tenant-migration/broken", migrationHistoryTable = "broken_tenant_history"))
        repeat(2) { assertThrows(IllegalStateException::class.java) { broken.migrate("broken-tenant") } }
        assertEquals(TenantStorageState.FAILED, broken.status("broken-tenant").state)
        assertThrows(AccessDeniedException::class.java) { broken.requireReady("broken-tenant", "managed_broken") }
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='managed_broken'", Int::class.java))
    }

    @Test
    fun nestedMigrationChangesInvalidateReadinessAndCannotBypassFlywayValidation() {
        val tenant = "nested-tenant"
        val schema = "managed_nested"
        val definition = contract.copy(deploymentId = "nested", migrationHistoryTable = "nested_tenant_history", migrationLocation = "db/tenant-migration/nested-original")
        val original = runtime(tenant, schema, definition)
        assertEquals("2", original.migrate(tenant).version)
        val changed = runtime(tenant, schema, definition.copy(migrationLocation = "db/tenant-migration/nested-changed"))
        assertThrows(AccessDeniedException::class.java) { changed.requireReady(tenant, schema) }
        assertThrows(IllegalStateException::class.java) { changed.migrate(tenant) }
        assertEquals(TenantStorageState.READY, original.migrate(tenant).state)
    }

    @Test
    fun scriptExecutionConfigurationChangesInvalidateReadiness() {
        val tenant = "script-config-tenant"
        val schema = "managed_script_config"
        val definition = contract.copy(deploymentId = "script-config", migrationHistoryTable = "script_config_history", migrationLocation = "db/tenant-migration/config-original")
        val original = runtime(tenant, schema, definition)
        assertEquals(TenantStorageState.READY, original.migrate(tenant).state)
        val changed = runtime(tenant, schema, definition.copy(migrationLocation = "db/tenant-migration/config-changed"))
        assertThrows(AccessDeniedException::class.java) { changed.requireReady(tenant, schema) }
        original.requireReady(tenant, schema)
    }

    @Test
    fun modifiedAppliedMigrationIsRejectedWithoutAutomaticRepairOrClean() {
        val tampered = runtime("test-tenant", "managed_a", contract.copy(migrationLocation = "db/tenant-migration/tampered"))
        try {
            assertThrows(IllegalStateException::class.java) { tampered.migrate("test-tenant") }
            assertEquals(TenantStorageState.FAILED, tampered.status("test-tenant").state)
        } finally { provisioner.migrate("test-tenant") }
    }
}
