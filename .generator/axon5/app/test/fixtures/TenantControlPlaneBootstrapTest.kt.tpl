package <%= rootPackage %>.tenancy

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.access.AccessDeniedException
import <%= rootPackage %>.shared.application.tenancy.SameSchemaTenantAccess
import java.util.UUID

@SpringBootTest(properties = [
    "spring.docker.compose.enabled=false", "spring.flyway.enabled=false",
    "spring.datasource.url=jdbc:h2:mem:tenant-control-plane;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
    "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
    "spring.jpa.hibernate.ddl-auto=create-drop", "axon.axonserver.enabled=false", "axon.axonserver.event-store.enabled=false",
    "medol.axon.event-storage=inmemory"
])
class TenantControlPlaneBootstrapTest @Autowired constructor(
    private val jdbc: JdbcTemplate, private val access: SameSchemaTenantAccess
) {
    @Test
    fun defaultRuntimeUsesActualGeneratedDirectoryTablesAndEligibility() {
        val tenant = UUID.randomUUID()
        val user = UUID.randomUUID()
        assertThrows(AccessDeniedException::class.java) { access.verify(tenant.toString(), user.toString()) }
        jdbc.update("INSERT INTO tenant_management_tenant_catalog(tenant_id,state) VALUES (?, 'Active')", tenant)
        jdbc.update("INSERT INTO tenant_management_tenant_membership_catalog(tenant_membership_id,tenant_id,user_account_id,state) VALUES (?, ?, ?, 'Active')", UUID.randomUUID(), tenant, user)
        assertEquals(tenant.toString(), access.verify(tenant.toString(), user.toString()).tenantId)
        jdbc.update("UPDATE tenant_management_tenant_catalog SET state='Suspended' WHERE tenant_id=?", tenant)
        assertThrows(AccessDeniedException::class.java) { access.verify(tenant.toString(), user.toString()) }
        jdbc.update("UPDATE tenant_management_tenant_catalog SET state='Active' WHERE tenant_id=?", tenant)
        jdbc.update("UPDATE tenant_management_tenant_membership_catalog SET state='Revoked' WHERE tenant_id=?", tenant)
        assertThrows(AccessDeniedException::class.java) { access.verify(tenant.toString(), user.toString()) }
    }
}
