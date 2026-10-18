package <%= rootPackage %>.shared.application.tenancy

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.web.method.HandlerMethod
import org.axonframework.messaging.commandhandling.CommandMessage
import org.axonframework.messaging.commandhandling.GenericCommandMessage
import org.axonframework.messaging.core.MessageType
import org.axonframework.messaging.core.MessageStream
import org.axonframework.messaging.core.MessageDispatchInterceptorChain
import org.axonframework.messaging.core.unitofwork.ProcessingContext
import <%= rootPackage %>.shared.security.MedolSecurityProperties
import <%= rootPackage %>.shared.security.CurrentUser
import <%= rootPackage %>.shared.security.CurrentUserProvider
import java.util.UUID

class SameSchemaTenantRuntimeTest {
    private lateinit var jdbc: JdbcTemplate
    private lateinit var access: SameSchemaTenantAccess
    private val user = UUID.fromString("00000000-0000-0000-0000-000000000011")
    private val security = MedolSecurityProperties(internalToken = "test-only-tenant-relay-key-at-least-32-characters")
    private val contract = TenantCapabilityContract(
        TenantProviderContract("Test", "Tenants", emptyMap()),
        TenantProviderContract("Test", "Members", emptyMap()), emptySet(),
        accessQuery = "SELECT 1 FROM tenants d JOIN members m ON d.id=m.tenant WHERE d.id=:tenant AND m.account=:user AND d.status=:usable AND m.status=:usable FETCH FIRST 1 ROW ONLY",
        backgroundQuery = "SELECT DISTINCT d.id FROM tenants d JOIN members m ON d.id=m.tenant WHERE m.account=:user AND d.status=:usable AND m.status=:usable",
        directoryIdColumn = "d.id", accessParameters = mapOf("usable" to "Ready"),
        uuidTenantId = false, uuidUserId = false
    )

    @BeforeEach
    fun setup() {
        val dataSource = DriverManagerDataSource("jdbc:h2:mem:tenant-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1", "sa", "")
        jdbc = JdbcTemplate(dataSource)
        jdbc.execute("CREATE TABLE tenants(id VARCHAR(100) PRIMARY KEY, status VARCHAR(20))")
        jdbc.execute("CREATE TABLE members(tenant VARCHAR(100), account VARCHAR(100), status VARCHAR(20))")
        for (tenant in listOf("a", "b")) {
            jdbc.update("INSERT INTO tenants VALUES (?, 'Ready')", tenant)
            jdbc.update("INSERT INTO members VALUES (?, ?, 'Ready')", tenant, user.toString())
        }
        access = SameSchemaTenantAccess(NamedParameterJdbcTemplate(dataSource), contract)
        access.initialize(contract)
    }

    @AfterEach
    fun cleanup() { SecurityContextHolder.clearContext() }

    @Test
    fun validatesMembershipAndBothEligibilityConditions() {
        assertEquals(TenantIdentity("a", user.toString()), access.verify("a", user.toString()))
        assertThrows(AccessDeniedException::class.java) { access.verify("a", "other-user") }
        jdbc.update("UPDATE tenants SET status='Stopped' WHERE id='a'")
        assertThrows(AccessDeniedException::class.java) { access.verify("a", user.toString()) }
        jdbc.update("UPDATE members SET status='Revoked' WHERE tenant='b'")
        assertThrows(AccessDeniedException::class.java) { access.verify("b", user.toString()) }
    }

    @Test
    fun storageBindingsAreValidatedAndReservedControlIdentifierCannotSelectControlStorage() {
        assertThrows(IllegalArgumentException::class.java) {
            TenantStorageProperties(TenantStorageMode.SEPARATE_SCHEMA, schemas = mapOf("a" to "public")).validate()
        }
        assertThrows(IllegalArgumentException::class.java) {
            TenantStorageProperties(TenantStorageMode.SEPARATE_SCHEMA, schemas = mapOf("a" to "tenant_a", "b" to "tenant_a")).validate()
        }
        assertThrows(IllegalArgumentException::class.java) {
            TenantStorageProperties(TenantStorageMode.SEPARATE_SCHEMA, schemas = mapOf("a" to "unsafe;schema")).validate()
        }
        val properties = TenantStorageProperties(TenantStorageMode.SEPARATE_SCHEMA, schemas = mapOf("__medol_control__" to "tenant_a"))
        val resolver = ConfiguredTenantStorageResolver(properties)
        assertEquals("tenant_a", resolver.resolve("__medol_control__").schema)
        assertThrows(AccessDeniedException::class.java) { resolver.resolve("unknown") }
        TenantScope.withIdentity(TenantIdentity("__medol_control__", "user")) {
            assertEquals("tenant:__medol_control__", TenantIdentifierResolver().resolveCurrentTenantIdentifier())
        }
    }

    @Test
    fun controlSchemaNamesAreQuotedEvenWhenTheyAreDatabaseKeywords() {
        val strategy = TenantSchemaNamingStrategy(TenantStorageProperties(controlSchema = "user"))
        val environment = org.mockito.Mockito.mock(org.hibernate.engine.jdbc.env.spi.JdbcEnvironment::class.java)
        val schema = requireNotNull(strategy.toPhysicalSchemaName(org.hibernate.boot.model.naming.Identifier.toIdentifier("__medol_control__"), environment))
        assertTrue(schema.isQuoted)
        assertEquals("user", schema.text)
        val source = DriverManagerDataSource("jdbc:h2:mem:quoted-control-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE", "sa", "")
        val sql = JdbcTemplate(source)
        val quoted = schema.render(org.hibernate.dialect.H2Dialect())
        sql.execute("CREATE SCHEMA $quoted")
        sql.execute("CREATE TABLE $quoted.control_probe(id INTEGER PRIMARY KEY)")
        assertEquals(0, sql.queryForObject("SELECT COUNT(*) FROM $quoted.control_probe", Int::class.java))
    }

    @Test
    fun storageGuardRejectsUnmigratedSchemaBeforeCommandDispatch() {
        val source = DriverManagerDataSource("jdbc:h2:mem:unmigrated-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE", "sa", "")
        JdbcTemplate(source).execute("CREATE SCHEMA tenant_a")
        val properties = TenantStorageProperties(TenantStorageMode.SEPARATE_SCHEMA, schemas = mapOf("a" to "tenant_a"))
        val provider = TenantConnectionProvider(source, properties, ConfiguredTenantStorageResolver(properties), setOf("required_business_table"))
        val guard = TenantStorageGuard(properties, provider)
        val command = object : TenantCommand {
            override val medolTenantScoped = true
            override var medolTenantScope: String? = null
            override var medolTenantUser: String? = null
        }
        val message = GenericCommandMessage(MessageType("test-command"), command, mapOf("tenantId" to "a", "userId" to user.toString()))
        val chain = object : MessageDispatchInterceptorChain<CommandMessage> {
            override fun proceed(message: CommandMessage, context: ProcessingContext?): MessageStream<*> = error("Unmigrated tenant must not dispatch commands")
        }
        assertThrows(AccessDeniedException::class.java) { TenantDispatchInterceptor(access, guard).interceptOnDispatch(message, null, chain) }
        assertNull(command.medolTenantScope)
    }

    @Test
    fun directoryQueriesStayInControlSchemaEvenOnBusinessConnections() {
        val source = DriverManagerDataSource("jdbc:h2:mem:control-query-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE", "sa", "")
        val sql = JdbcTemplate(source)
        sql.execute("CREATE SCHEMA control")
        sql.execute("CREATE SCHEMA business")
        sql.execute("CREATE TABLE control.tenants(id VARCHAR(100), status VARCHAR(20))")
        sql.execute("CREATE TABLE control.members(tenant VARCHAR(100), account VARCHAR(100), status VARCHAR(20))")
        sql.update("INSERT INTO control.tenants VALUES ('a', 'Ready')")
        sql.update("INSERT INTO control.members VALUES ('a', ?, 'Ready')", user.toString())
        source.connection.use { connection ->
            connection.schema = "business"
            val pinnedContract = contract.copy(accessQuery = contract.accessQuery.replace("FROM tenants", "FROM \"__medol_control__\".tenants").replace("JOIN members", "JOIN \"__medol_control__\".members"))
            val pinned = SameSchemaTenantAccess(NamedParameterJdbcTemplate(org.springframework.jdbc.datasource.SingleConnectionDataSource(connection, true)), pinnedContract, TenantStorageProperties(controlSchema = "control"))
            assertEquals("a", pinned.verify("a", user.toString()).tenantId)
            sql.update("DELETE FROM control.members")
            assertThrows(AccessDeniedException::class.java) { pinned.verify("a", user.toString()) }
        }
    }

    @Test
    fun uuidIdentitiesUseOneCanonicalPartitionWhileStringsRemainUnchanged() {
        jdbc.execute("CREATE TABLE uuid_tenants(id UUID PRIMARY KEY, status VARCHAR(20))")
        jdbc.execute("CREATE TABLE uuid_members(tenant UUID, account UUID, status VARCHAR(20))")
        val tenant = UUID.fromString("abcdefab-1234-5678-9abc-123456789abc")
        val account = UUID.fromString("fedcbafe-1234-5678-9abc-123456789abc")
        jdbc.update("INSERT INTO uuid_tenants VALUES (?, 'Ready')", tenant)
        jdbc.update("INSERT INTO uuid_members VALUES (?, ?, 'Ready')", tenant, account)
        val uuidContract = contract.copy(
            accessQuery = contract.accessQuery.replace("FROM tenants", "FROM uuid_tenants").replace("JOIN members", "JOIN uuid_members"),
            uuidTenantId = true, uuidUserId = true
        )
        val uuidAccess = SameSchemaTenantAccess(NamedParameterJdbcTemplate(jdbc.dataSource!!), uuidContract)
        assertEquals(TenantIdentity(tenant.toString(), account.toString()), uuidAccess.verify(tenant.toString().uppercase(), account.toString().uppercase()))
        assertThrows(AccessDeniedException::class.java) { uuidAccess.verify("invalid", account.toString()) }
        jdbc.update("INSERT INTO tenants VALUES ('Case-Sensitive', 'Ready')")
        jdbc.update("INSERT INTO members VALUES ('Case-Sensitive', ?, 'Ready')", user.toString())
        assertEquals("Case-Sensitive", access.verify("Case-Sensitive", user.toString()).tenantId)
        assertThrows(AccessDeniedException::class.java) { access.verify("case-sensitive", user.toString()) }
    }

    @Test
    fun restoresNestedScopesAndClearsOnException() {
        assertNull(TenantScope.current())
        assertThrows(IllegalStateException::class.java) {
            TenantScope.withIdentity(TenantIdentity("a", user.toString())) {
                TenantScope.withIdentity(TenantIdentity("b", user.toString())) { assertEquals("b", TenantScope.requireTenant()) }
                assertEquals("a", TenantScope.requireTenant())
                error("test failure")
            }
        }
        assertNull(TenantScope.current())
        assertThrows(AccessDeniedException::class.java) { TenantScope.requireTenant() }
    }

    @Test
    fun backgroundPaginationHasNoUnboundedInAndVisitsOnlyGrantedTenants() {
        for (index in 1..205) {
            val tenant = "tenant-" + index.toString().padStart(3, '0')
            jdbc.update("INSERT INTO tenants VALUES (?, 'Ready')", tenant)
            jdbc.update("INSERT INTO members VALUES (?, ?, 'Ready')", tenant, user.toString())
        }
        jdbc.update("INSERT INTO tenants VALUES ('not-granted', 'Ready')")
        val visited = mutableSetOf<String>()
        access.forEachTenant(user.toString()) { assertTrue(visited.add(TenantScope.requireTenant())) }
        assertEquals(207, visited.size)
        assertFalse(visited.contains("not-granted"))
        assertNull(TenantScope.current())
    }

    @Test
    fun dispatcherOverwritesPayloadTenantAndRejectsMissingOrConflictingContext() {
        val command = object : TenantCommand {
            override val medolTenantScoped = true
            override var medolTenantScope: String? = "forged"
            override var medolTenantUser: String? = "forged"
        }
        val interceptor = TenantDispatchInterceptor(access)
        val chain = object : MessageDispatchInterceptorChain<CommandMessage> {
            override fun proceed(message: CommandMessage, context: ProcessingContext?): MessageStream<*> = MessageStream.empty<CommandMessage>()
        }
        val message = GenericCommandMessage(MessageType("test-command"), command, mapOf("tenantId" to "a", "userId" to user.toString()))
        interceptor.interceptOnDispatch(message, null, chain)
        assertEquals("a", command.medolTenantScope)
        assertEquals(user.toString(), command.medolTenantUser)
        assertThrows(AccessDeniedException::class.java) {
            interceptor.interceptOnDispatch(GenericCommandMessage(MessageType("test-command"), command), null, chain)
        }
        TenantScope.withIdentity(TenantIdentity("b", user.toString())) {
            assertThrows(AccessDeniedException::class.java) { interceptor.interceptOnDispatch(message, null, chain) }
        }
    }

    @Test
    fun relayIsSignedAndRejectsTampering() {
        val relay = TenantRelay(security)
        val identity = TenantIdentity("a", user.toString())
        val token = relay.issue(identity)
        assertEquals(identity, relay.verify(token))
        assertThrows(AccessDeniedException::class.java) { relay.verify("x" + token) }
        assertThrows(AccessDeniedException::class.java) { relay.verify("invalid") }
    }

    @Test
    fun httpIgnoresSpoofedUserHeadersAndRequiresMembership() {
        val current = CurrentUser(user, "test-user", null, emptySet(), emptySet())
        val users = object : CurrentUserProvider { override fun currentUser() = current }
        val interceptor = TenantRequestInterceptor(access, users, contract, TenantRelay(security), security)
        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken(current, "bearer-token", emptyList())
        val handler = HandlerMethod(this, javaClass.getMethod("endpoint"))
        val request = MockHttpServletRequest().apply { addHeader("X-Tenant-Id", "a"); addHeader("X-User-Id", "forged") }
        assertTrue(interceptor.preHandle(request, MockHttpServletResponse(), handler))
        assertEquals(TenantIdentity("a", user.toString()), request.getAttribute(TenantScope.REQUEST_ATTRIBUTE))
        jdbc.update("DELETE FROM members WHERE tenant='a'")
        assertThrows(AccessDeniedException::class.java) { interceptor.preHandle(request, MockHttpServletResponse(), handler) }
        assertNull(request.getAttribute(TenantScope.REQUEST_ATTRIBUTE))
        assertThrows(AccessDeniedException::class.java) { interceptor.preHandle(MockHttpServletRequest(), MockHttpServletResponse(), handler) }
    }

    @Test
    fun relayRequiresServiceAuthenticationAndDoesNotBypassRevocation() {
        val current = CurrentUser(user, "test-user", null, emptySet(), emptySet())
        val users = object : CurrentUserProvider { override fun currentUser() = current }
        val relay = TenantRelay(security)
        val interceptor = TenantRequestInterceptor(access, users, contract, relay, security)
        val handler = HandlerMethod(this, javaClass.getMethod("endpoint"))
        val request = MockHttpServletRequest().apply { addHeader(TenantRelay.HEADER, relay.issue(TenantIdentity("a", user.toString()))) }
        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken(current, "untrusted-token", emptyList())
        assertThrows(AccessDeniedException::class.java) { interceptor.preHandle(request, MockHttpServletResponse(), handler) }
        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken(current, security.internalToken, emptyList())
        assertTrue(interceptor.preHandle(request, MockHttpServletResponse(), handler))
        jdbc.update("DELETE FROM members WHERE tenant='a'")
        assertThrows(AccessDeniedException::class.java) { interceptor.preHandle(request, MockHttpServletResponse(), handler) }
    }

    @Test
    fun filesAreNamespacedAndCrossTenantPathsAreDenied(@org.junit.jupiter.api.io.TempDir root: java.nio.file.Path) {
        lateinit var file: java.nio.file.Path
        TenantScope.withIdentity(TenantIdentity("a", user.toString())) {
            val directory = java.nio.file.Files.createDirectories(TenantFiles.directory(root.toString()))
            file = java.nio.file.Files.writeString(directory.resolve("export.csv"), "private")
            assertEquals(file.toRealPath(), TenantFiles.owned(file.toString(), root.toString()))
            assertFalse(java.nio.file.Files.exists(TenantFiles.owned(directory.resolve("missing.csv").toString(), root.toString())))
        }
        TenantScope.withIdentity(TenantIdentity("b", user.toString())) {
            assertThrows(AccessDeniedException::class.java) { TenantFiles.owned(file.toString(), root.toString()) }
        }
    }

    fun endpoint() = Unit
}
