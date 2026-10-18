package <%= rootPackage %>.tenancy

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest
import org.springframework.data.domain.PageRequest
import org.springframework.security.access.AccessDeniedException
import jakarta.persistence.EntityManager
import java.util.UUID
import <%= rootPackage %>.records.recordcatalog.*
import <%= rootPackage %>.records.infrastructure.secondary.persistence.recordcatalogreadmodel.*
import <%= rootPackage %>.records.record.*
import <%= rootPackage %>.records.events.RecordCreatedEvent
import <%= rootPackage %>.shared.application.access.PermitAllReadModelAccessPolicyFilter
import <%= rootPackage %>.shared.application.tenancy.*
import org.axonframework.messaging.core.MessageType
import org.axonframework.messaging.core.QualifiedName
import org.axonframework.messaging.eventhandling.GenericEventMessage
import org.axonframework.messaging.eventstreaming.Tag

@DataJpaTest(properties = [
    "spring.flyway.enabled=false", "spring.docker.compose.enabled=false", "spring.jpa.hibernate.ddl-auto=create-drop"
])
@org.springframework.context.annotation.Import(TenantStorageIsolationTest.NamingConfiguration::class)
class TenantStorageIsolationTest @Autowired constructor(
    private val storage: SpringDataRecordCatalogReadModelRepository,
    private val entityManager: EntityManager
) {
    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods = false)
    class NamingConfiguration {
        @org.springframework.context.annotation.Bean
        fun tenantNamingStrategy() = org.springframework.boot.autoconfigure.orm.jpa.HibernatePropertiesCustomizer {
            it["hibernate.physical_naming_strategy"] = TenantSchemaNamingStrategy(TenantStorageProperties())
        }
    }
    private val repository = JpaRecordCatalogReadModelRepository(storage, PermitAllReadModelAccessPolicyFilter(), RecordCatalogReadModelQueryService(), TenantPersistenceBoundary(TenantStorageProperties(), entityManager.entityManagerFactory))
    private val page = PageRequest.of(0, 20)

    private fun <T> tenant(id: String, block: () -> T): T = TenantScope.withIdentity(TenantIdentity(id, "test-user"), block)

    @Test
    fun sameBusinessIdHasIndependentRowsAndQueries() {
        val id = UUID.randomUUID()
        for (scope in listOf("a", "b")) tenant(scope) {
            repository.save(RecordCatalogReadModelProjection().apply { recordId = id; recordName = scope })
            entityManager.flush()
            entityManager.clear()
        }
        assertEquals(2, storage.count())
        for (scope in listOf("a", "b")) tenant(scope) {
            assertEquals(scope, repository.findById(id)?.recordName)
            assertEquals(scope, repository.findByIdWithAccessPolicy(id)?.recordName)
            assertEquals(scope, repository.findProjectionById(id)?.recordName)
            val rows = repository.findAllByCriteria(null, page)
            assertEquals(1, rows.totalElements)
            assertEquals(scope, rows.content.single().recordName)
            assertEquals(1, repository.findAllByFilter(null, page).totalElements)
        }
    }

    @Test
    fun missingContextCannotReadOrWrite() {
        assertThrows(AccessDeniedException::class.java) { repository.findAllByCriteria(null, page) }
        assertThrows(AccessDeniedException::class.java) { repository.findById(UUID.randomUUID()) }
        assertThrows(AccessDeniedException::class.java) { repository.save(RecordCatalogReadModelProjection()) }
    }

    @Test
    fun cannotSaveProjectionFromAnotherTenant() {
        val projection = RecordCatalogReadModelProjection().apply { recordId = UUID.randomUUID(); recordName = "a" }
        tenant("a") { repository.save(projection) }
        tenant("b") {
            assertNull(repository.findProjectionById(requireNotNull(projection.recordId)))
            assertThrows(AccessDeniedException::class.java) { repository.save(projection) }
        }
    }

    @Test
    fun replayUsesEventTenantNotAmbientRequestTenant() {
        val id = UUID.randomUUID()
        val projector = RecordCatalogReadModelProjector(DefaultRecordCatalogReadModelProjectionUpdater(repository))
        for (scope in listOf("a", "b")) {
            val event = RecordCreatedEvent(id, scope, medolTenantScope = scope)
            tenant("unrelated-request") {
                projector.on(event, GenericEventMessage(MessageType(RecordCreatedEvent::class.java), event, mapOf("tenantId" to scope)))
                assertEquals("unrelated-request", TenantScope.requireTenant())
            }
        }
        tenant("a") { assertEquals("a", repository.findById(id)?.recordName) }
        tenant("b") { assertEquals("b", repository.findById(id)?.recordName) }
    }

    @Test
    fun stateAndUniqueReservationCriteriaIncludeTenantInEveryBranch() {
        val id = UUID.randomUUID()
        val criteria = RecordState.resolveCriteria(RecordSelection(id, "a"))
        val type = QualifiedName("test-event")
        assertTrue(criteria.matches(type, setOf(Tag.of("recordId", id.toString()), Tag.of(TenantScope.TAG, "a"))))
        assertFalse(criteria.matches(type, setOf(Tag.of("recordId", id.toString()), Tag.of(TenantScope.TAG, "b"))))
        assertFalse(criteria.matches(type, setOf(Tag.of("recordId", id.toString()))))
        val unique = RecordNameReservationState.resolveCriteria(RecordNameSelection("same", "a"))
        assertTrue(unique.matches(type, setOf(Tag.of("recordName", "same"), Tag.of(TenantScope.TAG, "a"))))
        assertFalse(unique.matches(type, setOf(Tag.of("recordName", "same"), Tag.of(TenantScope.TAG, "b"))))
        assertNotEquals(RecordSelection(id, "a"), RecordSelection(id, "b"))
    }
}
