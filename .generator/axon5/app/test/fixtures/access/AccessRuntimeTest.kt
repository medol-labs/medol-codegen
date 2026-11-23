package example

import example.shared.application.access.*
import example.shared.security.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.support.DefaultListableBeanFactory
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter
import org.springframework.data.jpa.repository.support.SimpleJpaRepository
import org.springframework.data.domain.PageRequest
import org.springframework.security.access.AccessDeniedException
import java.util.UUID

class AccessRuntimeTest {
    @Test
    fun `generated scope lookup and query enforce row boundaries including count and detail`() {
        val factory = LocalContainerEntityManagerFactoryBean().apply {
            dataSource = DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1", "sa", "")
            setPackagesToScan("example")
            jpaVendorAdapter = HibernateJpaVendorAdapter()
            setJpaPropertyMap(mapOf("hibernate.hbm2ddl.auto" to "create-drop"))
            afterPropertiesSet()
        }
        val em = factory.`object`!!.createEntityManager()
        try {
            val me = UUID.randomUUID(); val other = UUID.randomUUID()
            val orgA = UUID.randomUUID(); val orgB = UUID.randomUUID(); val orgC = UUID.randomUUID()
            val own = OrderEntity(ownerOrganizationId = orgA, ownerId = me)
            val colleague = OrderEntity(ownerOrganizationId = orgA, ownerId = other)
            val denied = OrderEntity(ownerOrganizationId = orgB, ownerId = me)
            em.transaction.begin()
            listOf(MemberEntity(userId = me, organizationId = orgA), MemberEntity(userId = me, organizationId = orgA),
                MemberEntity(userId = me, organizationId = orgB, state = "Inactive"), MemberEntity(userId = other, organizationId = orgC),
                own, colleague, denied).forEach(em::persist)
            em.transaction.commit()
            val beans = DefaultListableBeanFactory()
            beans.registerSingleton("members", MemberEntityAccessScopeSource(em))
            val resolver = DefaultAuthorizationScopeResolver(CurrentUserAccessAttributes(), beans.getBeanProvider(BusinessAccessScopeSource::class.java))
            var actor = CurrentUser(me, "me", null, emptySet(), setOf("data:participants:organizationid:scope"))
            val users = object : CurrentUserProvider { override fun currentUser() = actor }
            val filter = ScopedReadModelAccessPolicyFilter(users, resolver)
            val relation = ReadModelAccessRule("organizationId", "ownerOrganizationId", "People.Members.organizationId", "userId", "identity.userId")
            val policy = ReadModelAccessPolicy("Participants", rules = listOf(relation))
            val repository = SimpleJpaRepository<OrderEntity, UUID>(OrderEntity::class.java, em)
            assertThrows(AccessDeniedException::class.java) { filter.requireUnrestricted("People", "Orders", policy) }
            actor = actor.copy(permissions = setOf("data:participants:organizationid:all"))
            filter.requireUnrestricted("People", "Orders", policy)
            actor = actor.copy(permissions = setOf("data:participants:organizationid:scope"))
            val spec = filter.specification<OrderEntity>("People", "Orders", policy)
            assertEquals(2L, repository.count(spec))
            assertEquals(2L, repository.findAll(spec, PageRequest.of(0, 1)).totalElements)
            assertEquals(setOf(own.id, colleague.id), repository.findAll(spec).map { it.id }.toSet())
            val idSpec = org.springframework.data.jpa.domain.Specification<OrderEntity> { root, _, b -> b.equal(root.get<UUID>("id"), denied.id) }
            assertTrue(repository.findOne(spec.and(idSpec)).isEmpty)

            val owner = ReadModelAccessRule("ownerId", "ownerId", "identity.userId")
            val personal = policy.copy(rules = listOf(relation, owner))
            // New dimensions are not implicitly authorized by an existing scope grant.
            assertEquals(0L, repository.count(filter.specification("People", "Orders", personal)))
            actor = actor.copy(permissions = actor.permissions + "data:participants:ownerid:scope")
            assertEquals(listOf(own.id), repository.findAll(filter.specification("People", "Orders", personal)).map { it.id })
            actor = actor.copy(permissions = setOf("data:participants:organizationid:all", "data:participants:ownerid:scope"))
            assertEquals(2L, repository.count(filter.specification("People", "Orders", personal)))
            actor = actor.copy(permissions = emptySet())
            assertEquals(0L, repository.count(filter.specification("People", "Orders", policy)))
            actor = actor.copy(id = UUID.randomUUID(), permissions = setOf("data:participants:organizationid:scope"))
            assertEquals(0L, repository.count(filter.specification("People", "Orders", policy)))
            assertThrows(AccessDeniedException::class.java) { filter.specification<OrderEntity>("People", "Orders", policy.copy(fields = listOf("Legacy.Field.id"))) }
            assertThrows(AccessDeniedException::class.java) { CurrentUserAccessAttributes().values(actor, "departmentIds") }
            val departmentAttributes = object : IdentityAccessAttributes {
                override fun values(actor: CurrentUser, attribute: String): Set<Any> {
                    check(attribute == "departmentIds")
                    return setOf(orgB)
                }
            }
            actor = actor.copy(id = me, permissions = setOf("data:department:departmentid:scope"))
            val departments = ScopedReadModelAccessPolicyFilter(users, DefaultAuthorizationScopeResolver(departmentAttributes, beans.getBeanProvider(BusinessAccessScopeSource::class.java)))
            val departmentPolicy = ReadModelAccessPolicy("Department", rules = listOf(ReadModelAccessRule("departmentId", "ownerOrganizationId", "identity.departmentIds")))
            assertEquals(listOf(denied.id), repository.findAll(departments.specification("People", "Orders", departmentPolicy)).map { it.id })

            assertThrows(AccessDeniedException::class.java) { AccessScopeValues.convert("bad-uuid", UUID::class.java) }
            val backgroundBeans = DefaultListableBeanFactory()
            var liveActor = actor.copy(permissions = setOf("orders:read", "data:participants:organizationid:scope"))
            backgroundBeans.registerSingleton("iam", object : BackgroundAccessActorResolver {
                override fun resolve(userId: UUID) = liveActor
            })
            val background = BackgroundDataAccess(users, backgroundBeans.getBeanProvider(BackgroundAccessActorResolver::class.java))
            val ownerId = background.prepare()
            val previousSecurity = org.springframework.security.core.context.SecurityContextHolder.getContext()
            // Simulate an event thread: current request provider is anonymous, fresh IAM actor is restored.
            actor = CurrentUser.anonymous()
            val count = background.run(ownerId, setOf("orders:read")) {
                repository.count(filter.specification("People", "Orders", policy))
            }
            assertEquals(2L, count)
            assertNull(DataAccessActorContext.current())
            assertSame(previousSecurity, org.springframework.security.core.context.SecurityContextHolder.getContext())
            assertThrows(IllegalStateException::class.java) {
                background.run(ownerId, setOf("orders:read")) { error("simulated export failure") }
            }
            assertNull(DataAccessActorContext.current())
            assertSame(previousSecurity, org.springframework.security.core.context.SecurityContextHolder.getContext())
            liveActor = liveActor.copy(permissions = emptySet())
            assertThrows(AccessDeniedException::class.java) { background.run(ownerId, setOf("orders:read")) { fail<Unit>("revoked user must not execute") } }
            liveActor = liveActor.copy(id = UUID.randomUUID())
            assertThrows(AccessDeniedException::class.java) { background.run(ownerId, setOf("orders:read")) { fail<Unit>("wrong actor must not execute") } }
            val unconfigured = BackgroundDataAccess(users, DefaultListableBeanFactory().getBeanProvider(BackgroundAccessActorResolver::class.java))
            assertThrows(AccessDeniedException::class.java) { unconfigured.prepare() }
            actor = CurrentUser(me, "me", null, emptySet(), emptySet())
            val exportBeans = DefaultListableBeanFactory()
            var submitted: example.shared.application.export.DataExportJobRequestMessage? = null
            exportBeans.registerSingleton("requestPort", object : example.shared.application.export.DataExportJobRequestPort {
                override fun request(message: example.shared.application.export.DataExportJobRequestMessage) { submitted = message }
            })
            val exportProperties = example.shared.application.export.DataExportProperties().apply {
                storagePath = java.nio.file.Files.createTempDirectory("access-export-files-").toString()
                asyncThreshold = 0
            }
            val service = example.shared.application.export.DataExportService(exportProperties,
                com.fasterxml.jackson.databind.ObjectMapper().registerModule(com.fasterxml.jackson.datatype.jsr310.JavaTimeModule()),
                exportBeans.getBeanProvider(example.shared.application.export.DataExportJobRequestPort::class.java),
                exportBeans.getBeanProvider(example.shared.application.export.DataExportDictionaryLabelProvider::class.java), users, background)
            val columns = listOf(example.shared.application.export.DataExportColumn("id"))
            val page = org.springframework.data.domain.PageImpl(listOf(own))
            service.export("orders", columns, emptyMap<String, String>(), org.springframework.data.domain.Sort.unsorted(), page, { page }, protectedAccess = true)
            assertEquals(me.toString(), submitted!!.requestedBy)
            val exported = service.writeCsvFile("orders.csv", columns, page, requestedBy = me.toString()) { page }
            val second = service.writeCsvFile("orders.csv", columns, page, requestedBy = me.toString()) { page }
            assertNotEquals(exported.filePath, second.filePath)
            assertTrue(java.nio.file.Files.isRegularFile(service.ownedDownload(exported.filePath)))
            actor = actor.copy(id = other)
            assertThrows(AccessDeniedException::class.java) { service.ownedDownload(exported.filePath) }
            actor = actor.copy(id = me)
            assertThrows(AccessDeniedException::class.java) { service.ownedDownload(exportProperties.storagePath + "/../../outside.csv") }
            val link = java.nio.file.Path.of(exported.filePath).parent.resolve("escape.csv")
            val outside = java.nio.file.Files.createTempFile("outside-export-", ".csv")
            java.nio.file.Files.createSymbolicLink(link, outside)
            assertThrows(AccessDeniedException::class.java) { service.ownedDownload(link.toString()) }
            val oversize = object : AuthorizationScopeResolver {
                override fun resolve(actor: CurrentUser, context: String, readModel: String, policy: String, rule: ReadModelAccessRule) = AuthorizationScope.Values((0..1000).map { UUID.randomUUID() }.toSet())
            }
            assertThrows(AccessDeniedException::class.java) { repository.count(ScopedReadModelAccessPolicyFilter(users, oversize).specification("People", "Orders", policy)) }
        } finally { em.close(); factory.destroy() }
    }
}
