package <%= rootPackage %>.tenancy

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import <%= rootPackage %>.shared.application.tenancy.*
import <%= rootPackage %>.records.createrecord.CreateRecordCommand
import <%= rootPackage %>.records.renamerecord.RenameRecordCommand
import <%= rootPackage %>.records.recordcatalog.RecordCatalogReadModelRepository
import java.util.UUID

@SpringBootTest(properties = [
    "spring.docker.compose.enabled=false", "spring.flyway.enabled=false",
    "spring.datasource.url=jdbc:h2:mem:tenant-command-isolation;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
    "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
    "spring.jpa.hibernate.ddl-auto=create-drop", "axon.axonserver.enabled=false", "axon.axonserver.event-store.enabled=false",
    "medol.axon.event-storage=inmemory"
])
class TenantCommandIsolationIntegrationTest @Autowired constructor(
    private val gateway: CommandGateway, private val records: RecordCatalogReadModelRepository
) {
<%- tenantFixture %>
    private fun <T> tenant(id: String, block: () -> T): T = TenantScope.withIdentity(TenantIdentity(id, "test-user"), block)

    @Test
    fun actualCommandBusScopesStateReservationsAndProjectedRows() {
        val id = UUID.randomUUID()
        for (scope in listOf("test-tenant", "test-tenant-b")) tenant(scope) {
            gateway.send(CreateRecordCommand(id, "same")).resultMessage.toCompletableFuture().join()
        }
        tenant("test-tenant") {
            assertThrows(Exception::class.java) { gateway.send(CreateRecordCommand(UUID.randomUUID(), "same")).resultMessage.toCompletableFuture().join() }
            gateway.send(RenameRecordCommand(id, "updated-a")).resultMessage.toCompletableFuture().join()
        }
        val deadline = System.nanoTime() + java.time.Duration.ofSeconds(8).toNanos()
        while (System.nanoTime() < deadline) {
            val a = tenant("test-tenant") { records.findById(id)?.recordName }
            val b = tenant("test-tenant-b") { records.findById(id)?.recordName }
            if (a == "updated-a" && b == "same") return
            Thread.sleep(20)
        }
        fail<Unit>("Expected independent tenant state and projected rows after command handling.")
    }
}
