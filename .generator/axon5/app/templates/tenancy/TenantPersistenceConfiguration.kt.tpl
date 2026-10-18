package <%= rootPackage %>.shared.application.tenancy

import jakarta.persistence.EntityManagerFactory
import org.hibernate.Session
import org.hibernate.boot.model.naming.CamelCaseToUnderscoresNamingStrategy
import org.hibernate.boot.model.naming.Identifier
import org.hibernate.context.spi.CurrentTenantIdentifierResolver
import org.hibernate.engine.jdbc.connections.spi.MultiTenantConnectionProvider
import org.hibernate.engine.jdbc.env.spi.JdbcEnvironment
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.boot.autoconfigure.orm.jpa.HibernatePropertiesCustomizer
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.beans.factory.SmartInitializingSingleton
import org.springframework.core.env.Environment
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.orm.jpa.EntityManagerHolder
import org.springframework.orm.jpa.EntityManagerFactoryUtils
import org.springframework.security.access.AccessDeniedException
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import java.sql.Connection
import javax.sql.DataSource

private const val CONTROL_TENANT = "__medol_control__"

class TenantSchemaNamingStrategy(private val properties: TenantStorageProperties) : CamelCaseToUnderscoresNamingStrategy() {
    override fun toPhysicalSchemaName(name: Identifier?, jdbcEnvironment: JdbcEnvironment): Identifier? =
        if (name?.text == CONTROL_TENANT) Identifier.toIdentifier(properties.controlSchema, true)
        else super.toPhysicalSchemaName(name, jdbcEnvironment)
}

class TenantConnectionProvider(
    private val dataSource: DataSource,
    private val properties: TenantStorageProperties,
    private val resolver: TenantStorageResolver,
    private val tenantTables: Set<String> = emptySet(),
    private val businessDataSource: DataSource = dataSource,
    private val provisioner: TenantStorageProvisioner? = null,
    private val resources: TenantBusinessConnections = TenantBusinessConnections(businessDataSource)
) : MultiTenantConnectionProvider<String> {
    private val verifiedSchemas = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private val schemaOwners = java.util.concurrent.ConcurrentHashMap<String, String>()
    private val bindings = java.util.concurrent.ConcurrentHashMap<String, TenantStorageLocation>()
    private val resets = java.util.Collections.synchronizedMap(java.util.IdentityHashMap<Connection, String?>())
    override fun getAnyConnection(): Connection = connection(properties.controlSchema)
    override fun releaseAnyConnection(connection: Connection) = release(connection)
    override fun getConnection(tenantIdentifier: String): Connection {
        if (tenantIdentifier == CONTROL_TENANT) return if (TenantScope.isControlStorage() && resources.controlDataSource != null)
            connection(properties.controlSchema, resource = "@control", source = resources.controlDataSource)
            else connection(properties.controlSchema)
        val location = businessLocation(tenantIdentifier)
        return connection(location.schema, true, location.dataSource, resources.resolve(location.dataSource))
    }
    override fun releaseConnection(tenantIdentifier: String, connection: Connection) = release(connection)
    override fun supportsAggressiveRelease() = false
    override fun isUnwrappableAs(type: Class<*>) = type.isInstance(this)
    override fun <T : Any?> unwrap(type: Class<T>): T = type.cast(this)

    fun verifyStorage(tenantId: String) {
        val location = businessLocation("tenant:" + tenantId)
        if (!verifiedSchemas.contains(location.dataSource + "/" + location.schema)) releaseConnection("tenant:" + tenantId, getConnection("tenant:" + tenantId))
    }

    private fun businessLocation(identifier: String): TenantStorageLocation {
        if (!identifier.startsWith("tenant:")) throw AccessDeniedException("Invalid tenant storage identity.")
        val tenant = identifier.removePrefix("tenant:")
        val location = resolver.resolve(tenant)
        val schema = location.schema
        if (!TenantStorageProperties.validSchema(schema) ||
            (location.dataSource == "default" && schema == properties.controlSchema) ||
            (properties.mode == TenantStorageMode.SEPARATE_DATABASE && !properties.dataSources.containsKey(location.dataSource)) ||
            (properties.mode == TenantStorageMode.SEPARATE_SCHEMA && location.dataSource != "default")) {
            throw AccessDeniedException("Invalid separate tenant storage binding.")
        }
        val previous = bindings.putIfAbsent(tenant, location)
        if (previous != null && previous != location) throw AccessDeniedException("Tenant storage binding cannot change while the application is running.")
        val owner = schemaOwners.putIfAbsent(location.dataSource + "/" + schema, tenant)
        if (owner != null && owner != tenant) throw AccessDeniedException("A separate schema cannot belong to multiple tenants.")
        if (properties.migration.enabled || properties.mode == TenantStorageMode.SEPARATE_DATABASE || properties.eventStores.isNotEmpty()) requireNotNull(provisioner).requireReady(tenant, schema)
        return location
    }

    private fun connection(schema: String, business: Boolean = false, resource: String = "default", source: DataSource = dataSource): Connection {
        val connection = source.connection
        try {
            val original = connection.schema
            connection.schema = schema
            val cacheKey = resource + "/" + schema
            // Cache only successful schema existence checks, never membership decisions.
            if (!verifiedSchemas.contains(cacheKey)) {
                if (business && properties.mode == TenantStorageMode.SEPARATE_DATABASE) {
                    connection.prepareStatement("SELECT resource_id FROM medol_storage.database_identity WHERE singleton=1").use { statement ->
                        statement.executeQuery().use { rows ->
                            if (!rows.next() || rows.getString(1) != resource) throw AccessDeniedException("Physical database identity has not been provisioned for this resource.")
                        }
                    }
                }
                connection.metaData.getSchemas(null, schema).use { rows ->
                    var found = false
                    while (rows.next()) if (rows.getString("TABLE_SCHEM") == schema) found = true
                    if (!found) throw AccessDeniedException("Tenant schema has not been provisioned.")
                }
                if (business && tenantTables.isNotEmpty()) {
                    val tables = mutableSetOf<String>()
                    connection.metaData.getTables(null, schema, null, arrayOf("TABLE")).use { rows ->
                        while (rows.next()) if (rows.getString("TABLE_SCHEM") == schema) tables.add(rows.getString("TABLE_NAME"))
                    }
                    if (!tables.containsAll(tenantTables)) throw AccessDeniedException("Tenant tables have not been migrated for this deployment.")
                }
                verifiedSchemas.add(cacheKey)
            }
            resets[connection] = original
            return connection
        } catch (failure: Throwable) {
            resets.remove(connection)
            try { connection.abort { it.run() } } catch (cleanup: Throwable) { failure.addSuppressed(cleanup) }
            try { connection.close() } catch (cleanup: Throwable) { failure.addSuppressed(cleanup) }
            throw failure
        }
    }

    private fun release(connection: Connection) {
        try {
            connection.schema = resets.remove(connection)
        } catch (failure: Throwable) {
            try { connection.abort { it.run() } } catch (cleanup: Throwable) { failure.addSuppressed(cleanup) }
            throw failure
        } finally { connection.close() }
    }
}

class TenantStorageGuard(
    private val properties: TenantStorageProperties = TenantStorageProperties(),
    private val provider: TenantConnectionProvider? = null,
    private val resolver: TenantStorageResolver? = null, private val provisioner: TenantStorageProvisioner? = null
) {
    fun verify(identity: TenantIdentity) {
        if (properties.mode != TenantStorageMode.SHARED_SCHEMA) requireNotNull(provider).verifyStorage(identity.tenantId)
        else if (properties.eventStores.isNotEmpty()) requireNotNull(provisioner).requireReady(identity.tenantId, requireNotNull(resolver).resolve(identity.tenantId).schema)
    }
}

class TenantIdentifierResolver : CurrentTenantIdentifierResolver<String> {
    override fun resolveCurrentTenantIdentifier(): String = if (TenantScope.isControlStorage()) CONTROL_TENANT else TenantScope.current()?.tenantId?.let { "tenant:" + it } ?: CONTROL_TENANT
    override fun validateExistingCurrentSessions() = true
}

class TenantPersistenceBoundary(private val properties: TenantStorageProperties, private val factory: EntityManagerFactory) {
    fun assertTenantTransaction() {
        if (properties.mode == TenantStorageMode.SHARED_SCHEMA) return
        val tenant = TenantScope.requireTenant()
        val holder = TransactionSynchronizationManager.getResource(factory) as? EntityManagerHolder ?: return
        if (holder.entityManager.unwrap(Session::class.java).tenantIdentifierValue != "tenant:" + tenant) {
            throw AccessDeniedException("A transaction cannot switch tenant storage.")
        }
    }
}

class TenantBusinessConnections(val dataSource: DataSource? = null, private val properties: TenantStorageProperties = TenantStorageProperties(), val controlDataSource: DataSource? = null) : AutoCloseable {
    private val pools = java.util.concurrent.ConcurrentHashMap<String, com.zaxxer.hikari.HikariDataSource>()
    fun resolve(resource: String): DataSource {
        if (resource == "default") return requireNotNull(dataSource)
        val settings = properties.dataSources[resource] ?: throw AccessDeniedException("Unknown tenant datasource.")
        return pools.computeIfAbsent(resource) {
            com.zaxxer.hikari.HikariDataSource(com.zaxxer.hikari.HikariConfig().apply {
                jdbcUrl = settings.url; username = settings.username; password = settings.password
                driverClassName = settings.driverClassName; maximumPoolSize = settings.poolSize; minimumIdle = 0
                poolName = "medol-tenant-" + resource
            })
        }
    }
    override fun close() { (pools.values.toList() + listOfNotNull(dataSource, controlDataSource)).distinct().forEach { (it as? AutoCloseable)?.close() } }
}

data class TenantProjectionReceiptKey(var projector: String = "", var eventId: String = "") : java.io.Serializable

@jakarta.persistence.Entity
@jakarta.persistence.Table(name = "medol_tenant_projection_receipt")
@jakarta.persistence.IdClass(TenantProjectionReceiptKey::class)
class TenantProjectionReceipt {
    @jakarta.persistence.Id
    var projector: String = ""
    @jakarta.persistence.Id
    var eventId: String = ""
}

class TenantExecution(
    private val properties: TenantStorageProperties = TenantStorageProperties(),
    private val factory: EntityManagerFactory? = null,
    private val manager: PlatformTransactionManager? = null
) {
    fun verifyEventTenant(tenant: String, message: org.axonframework.messaging.eventhandling.EventMessage) {
        if (message.metadata()["medol.eventSource"] != null && message.metadata()["tenantId"] != tenant) throw AccessDeniedException("Event payload tenant does not match its stored tenant tag.")
    }
    fun project(identity: TenantIdentity, projector: String, eventId: String, source: String? = null, block: () -> Unit) {
        if (properties.mode == TenantStorageMode.SHARED_SCHEMA) { run(identity, block); return }
        run(identity) {
            TransactionTemplate(requireNotNull(manager)).executeWithoutResult {
                val entityManager = requireNotNull(EntityManagerFactoryUtils.getTransactionalEntityManager(requireNotNull(factory)))
                val receiptProjector = if (source == null || source == "default") projector else TenantEventStores.digest(source + "\u0000" + projector)
                val key = TenantProjectionReceiptKey(receiptProjector, eventId)
                if (entityManager.find(TenantProjectionReceipt::class.java, key) == null) {
                    block()
                    entityManager.persist(TenantProjectionReceipt().apply { this.projector = receiptProjector; this.eventId = eventId })
                }
            }
        }
    }

    fun <T> run(identity: TenantIdentity, block: () -> T): T = TenantScope.withIdentity(identity) {
        if (properties.mode == TenantStorageMode.SHARED_SCHEMA) return@withIdentity block()
        val holder = TransactionSynchronizationManager.getResource(requireNotNull(factory)) as? EntityManagerHolder
        val existing = holder?.entityManager?.unwrap(Session::class.java)?.tenantIdentifierValue
        if (existing != null && existing != CONTROL_TENANT && existing != "tenant:" + identity.tenantId) {
            throw AccessDeniedException("A transaction cannot switch tenant storage.")
        }
        if (holder == null || existing != CONTROL_TENANT) return@withIdentity block()
        val transaction = TransactionTemplate(requireNotNull(manager)).apply {
            propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
        }
        @Suppress("UNCHECKED_CAST")
        transaction.execute { block() } as T
    }
}

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(TenantStorageProperties::class)
class TenantPersistenceConfiguration {
    @Bean
    @ConditionalOnMissingBean(TenantAccess::class)
    fun sameSchemaTenantAccess(jdbc: NamedParameterJdbcTemplate, contract: TenantCapabilityContract, properties: TenantStorageProperties, connections: TenantMigrationConnections): SameSchemaTenantAccess =
        SameSchemaTenantAccess(if (properties.mode == TenantStorageMode.SEPARATE_DATABASE || properties.eventStores.isNotEmpty())
            NamedParameterJdbcTemplate(requireNotNull(connections.readiness)) else jdbc, contract, properties)

    @Bean
    @ConditionalOnMissingBean(TenantStorageResolver::class)
    fun tenantStorageResolver(properties: TenantStorageProperties): TenantStorageResolver = ConfiguredTenantStorageResolver(properties)

    @Bean
    fun tenantPersistenceBoundary(properties: TenantStorageProperties, factory: EntityManagerFactory) = TenantPersistenceBoundary(properties, factory)

    @Bean
    fun tenantExecution(properties: TenantStorageProperties, factory: EntityManagerFactory, manager: PlatformTransactionManager) = TenantExecution(properties, factory, manager)

    @Bean(destroyMethod = "close")
    @ConditionalOnMissingBean(TenantBusinessConnections::class)
    fun tenantBusinessConnections(properties: TenantStorageProperties, defaults: DataSourceProperties): TenantBusinessConnections {
        if (properties.mode == TenantStorageMode.SHARED_SCHEMA) return TenantBusinessConnections()
        properties.validate()
        val pool = defaults.initializeDataSourceBuilder().type(com.zaxxer.hikari.HikariDataSource::class.java).build().apply {
            poolName = "medol-tenant-business"
            maximumPoolSize = properties.businessPoolSize
            schema = properties.controlSchema
        }
        val controlQueries = defaults.initializeDataSourceBuilder().type(com.zaxxer.hikari.HikariDataSource::class.java).build().apply {
            poolName = "medol-tenant-control-query"; maximumPoolSize = properties.businessPoolSize; minimumIdle = 0
            schema = properties.controlSchema
        }
        return TenantBusinessConnections(pool, properties, controlQueries)
    }

    @Bean
    fun tenantConnectionProvider(dataSource: DataSource, properties: TenantStorageProperties, resolver: TenantStorageResolver, contract: TenantCapabilityContract, business: TenantBusinessConnections, provisioner: TenantStorageProvisioner) =
        TenantConnectionProvider(dataSource, properties, resolver, contract.tenantTables, business.dataSource ?: dataSource, provisioner, business)

    @Bean(destroyMethod = "close")
    fun tenantMigrationConnections(properties: TenantStorageProperties, defaults: DataSourceProperties): TenantMigrationConnections {
        properties.validate()
        return TenantMigrationConnections(properties, defaults)
    }

    @Bean
    @ConditionalOnMissingBean(TenantStorageProvisioner::class)
    fun tenantStorageProvisioner(properties: TenantStorageProperties, contract: TenantCapabilityContract, resolver: TenantStorageResolver, connections: TenantMigrationConnections): TenantStorageProvisioner =
        FlywayTenantStorageProvisioner(properties, contract, resolver, connections)

    @Bean
    fun tenantMigrationBootstrap(properties: TenantStorageProperties, resolver: TenantStorageResolver, provisioner: TenantStorageProvisioner, environment: Environment): SmartInitializingSingleton = SmartInitializingSingleton {
        if ((properties.mode == TenantStorageMode.SEPARATE_DATABASE || properties.eventStores.isNotEmpty()) && environment.getProperty("medol.axon.event-storage") == "umadb") {
            provisioner.registerEventSource("default", TenantEventStores.digest("default\u00001\u0000" + environment.getRequiredProperty("medol.axon.umadb.target")))
            for ((id, resource) in properties.eventStores) provisioner.registerEventSource(id, TenantEventStores.digest(id + "\u0000" + resource.generation + "\u0000" + resource.target))
        }
        if (properties.migration.enabled) resolver.forEachTenant { provisioner.migrate(it) }
        else if (properties.mode == TenantStorageMode.SEPARATE_DATABASE || properties.eventStores.isNotEmpty()) resolver.forEachTenant { provisioner.register(it) }
    }

    @Bean
    fun tenantStorageGuard(properties: TenantStorageProperties, provider: TenantConnectionProvider, resolver: TenantStorageResolver, provisioner: TenantStorageProvisioner) = TenantStorageGuard(properties, provider, resolver, provisioner)

    @Bean
    fun tenantHibernateProperties(properties: TenantStorageProperties, provider: TenantConnectionProvider, environment: Environment): HibernatePropertiesCustomizer {
        properties.validate()
        check(properties.eventStores.isEmpty() || environment.getProperty("medol.axon.event-storage") == "umadb") { "Physical event stores require the UmaDB adapter." }
        return HibernatePropertiesCustomizer { settings ->
            settings["hibernate.physical_naming_strategy"] = TenantSchemaNamingStrategy(properties)
            if (properties.mode != TenantStorageMode.SHARED_SCHEMA) {
                check(environment.getProperty("spring.jpa.hibernate.ddl-auto", "update") == "none" &&
                    settings["hibernate.hbm2ddl.auto"]?.toString().let { it == null || it == "none" } &&
                    settings["jakarta.persistence.schema-generation.database.action"]?.toString().let { it == null || it == "none" }) {
                    "Separate tenant schemas require ddl-auto=none and externally provisioned migrations."
                }
                settings.remove("hibernate.default_schema")
                settings["hibernate.multi_tenant_connection_provider"] = provider
                settings["hibernate.tenant_identifier_resolver"] = TenantIdentifierResolver()
            }
        }
    }
}
