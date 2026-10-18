package <%= rootPackage %>.tenancy

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import <%= rootPackage %>.shared.application.tenancy.*

@SpringBootTest(properties = [
    "spring.config.additional-location=classpath:tenant-test-storage.yml",
    "spring.docker.compose.enabled=false", "spring.flyway.enabled=false",
    "spring.sql.init.mode=always", "spring.sql.init.schema-locations=classpath:tenant-test-control.sql",
    "spring.datasource.url=\${TENANT_TEST_DB_URL:jdbc:h2:mem:tenant-managed-support;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE}",
    "spring.datasource.driver-class-name=\${TENANT_TEST_DB_DRIVER:org.h2.Driver}",
    "spring.datasource.username=\${TENANT_TEST_DB_USER:sa}", "spring.datasource.password=\${TENANT_TEST_DB_PASSWORD:}",
    "axon.axonserver.enabled=false", "axon.axonserver.event-store.enabled=false",
    "medol.axon.event-storage=inmemory"
])
@org.springframework.test.context.ContextConfiguration(initializers = [TenantOperationsControlInitializer::class])
class TenantSupportMigrationIntegrationTest @Autowired constructor(
    private val provisioner: TenantStorageProvisioner, private val contract: TenantCapabilityContract, private val jdbc: JdbcTemplate
) {
<%- tenantFixture %>
    @Test
    fun supportDeploymentMigratesItsActualGeneratedCatalogsWithoutTenantizingControlPlane() {
        assertEquals(TenantStorageState.READY, provisioner.status("test-tenant").state)
        assertTrue(contract.tenantTables.contains("data_exchange_data_export_job_catalog"))
        for (table in contract.tenantTables) {
            assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=? AND table_name=?", Int::class.java, "managed_a", table))
        }
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='managed_a' AND table_name LIKE 'identity_access_management_%'", Int::class.java))
        assertEquals(TenantStorageState.READY, provisioner.migrate("test-tenant").state)
    }
}
