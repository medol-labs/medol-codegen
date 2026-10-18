package <%= rootPackage %>.shared.application.tenancy

import org.flywaydb.core.Flyway
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties
import org.springframework.core.io.support.PathMatchingResourcePatternResolver
import org.springframework.dao.DataAccessException
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.security.access.AccessDeniedException
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import javax.sql.DataSource

enum class TenantStorageState { EXTERNAL, UNINITIALIZED, MIGRATING, READY, FAILED }

data class TenantStorageStatus(
    val tenantId: String, val schema: String, val deploymentId: String,
    val state: TenantStorageState, val version: String? = null,
    val bundleHash: String? = null, val errorCode: String? = null
)

interface TenantStorageProvisioner {
    fun migrate(tenantId: String): TenantStorageStatus
    fun status(tenantId: String): TenantStorageStatus
    fun requireReady(tenantId: String, schema: String)
    fun register(tenantId: String) { error("Physical storage requires durable binding registration.") }
    fun registerEventSource(resource: String, fingerprint: String) { error("Physical event storage requires durable source identity registration.") }
}

class TenantMigrationConnections(private val properties: TenantStorageProperties, private val defaults: DataSourceProperties) : AutoCloseable {
    val migration: DataSource?
    val readiness: com.zaxxer.hikari.HikariDataSource?
    init {
        properties.validate()
        if (properties.migration.enabled || properties.mode == TenantStorageMode.SEPARATE_DATABASE || properties.eventStores.isNotEmpty()) {
            migration = DriverManagerDataSource().apply {
                setDriverClassName(defaults.determineDriverClassName())
                url = defaults.determineUrl()
                username = properties.migration.username ?: defaults.determineUsername()
                password = properties.migration.password ?: defaults.determinePassword()
            }
            readiness = defaults.initializeDataSourceBuilder().type(com.zaxxer.hikari.HikariDataSource::class.java).build().apply {
                poolName = "medol-tenant-readiness"
                maximumPoolSize = 2
                minimumIdle = 0
                schema = properties.controlSchema
                isReadOnly = true
            }
        } else { migration = null; readiness = null }
    }
    override fun close() { readiness?.close() }
    fun target(resource: String): DataSource {
        if (resource == "default") return requireNotNull(migration)
        val settings = properties.dataSources[resource] ?: error("Unknown migration datasource.")
        return DriverManagerDataSource().apply {
            setDriverClassName(settings.driverClassName); url = settings.url
            username = settings.migrationUsername ?: settings.username
            password = settings.migrationPassword ?: settings.password
        }
    }
    fun assertDatabaseIdentity(source: DataSource, resource: String) {
        val jdbc = JdbcTemplate(source)
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS medol_storage")
        jdbc.execute("CREATE TABLE IF NOT EXISTS medol_storage.database_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), resource_id VARCHAR(64) NOT NULL)")
        try { jdbc.update("INSERT INTO medol_storage.database_identity(singleton, resource_id) VALUES (1, ?)", resource) }
        catch (_: DuplicateKeyException) {
            check(jdbc.queryForObject("SELECT resource_id FROM medol_storage.database_identity WHERE singleton=1", String::class.java) == resource) {
                "A physical database cannot be registered under multiple resource identities or alias the control database."
            }
        }
    }
    fun verifyBusinessAccess(location: TenantStorageLocation, tables: List<TenantTableDefinition>) {
        val settings = properties.dataSources[location.dataSource]
        val source = DriverManagerDataSource().apply {
            setDriverClassName(settings?.driverClassName ?: defaults.determineDriverClassName())
            url = settings?.url ?: defaults.determineUrl()
            username = settings?.username ?: defaults.determineUsername()
            password = settings?.password ?: defaults.determinePassword()
        }
        source.connection.use { connection ->
            if (properties.mode == TenantStorageMode.SEPARATE_DATABASE) {
                connection.prepareStatement("SELECT resource_id FROM medol_storage.database_identity WHERE singleton=1").use { statement ->
                    statement.executeQuery().use { rows -> check(rows.next() && rows.getString(1) == location.dataSource) { "Business account cannot verify database identity." } }
                }
            }
            fun quote(value: String) = "\"" + value.replace("\"", "\"\"") + "\""
            for (table in tables) connection.prepareStatement("SELECT 1 FROM " + quote(location.schema) + "." + quote(table.name) + " WHERE 1=0").use { statement -> statement.executeQuery().close() }
        }
    }
}

class FlywayTenantStorageProvisioner(
    private val properties: TenantStorageProperties,
    private val contract: TenantCapabilityContract,
    private val resolver: TenantStorageResolver,
    private val connections: TenantMigrationConnections
) : TenantStorageProvisioner {
    init {
        properties.validate()
        require(contract.deploymentId.isNotBlank() && contract.deploymentId.length <= 255) { "Invalid migration deployment identifier." }
        require(contract.migrationHistoryTable.matches(Regex("[a-z_][a-z0-9_]{0,62}"))) { "Invalid tenant migration history table." }
        require(contract.migrationLocation.matches(Regex("db/tenant-migration/[a-z0-9_-]+"))) { "Invalid tenant migration resource location." }
    }
    private val initialized = AtomicBoolean(false)
    private val locations = java.util.concurrent.ConcurrentHashMap<String, TenantStorageLocation>()
    private fun location(tenant: String): TenantStorageLocation {
        val value = resolver.resolve(tenant)
        val previous = locations.putIfAbsent(tenant, value)
        check(previous == null || previous == value) { "Tenant storage binding changed during migration." }
        return value
    }
    private val control get() = requireNotNull(connections.migration) { "Managed tenant migration is disabled." }
    private val write get() = JdbcTemplate(control)
    private val read get() = JdbcTemplate(requireNotNull(connections.readiness))
    private val legacyBinding get() = "\"${properties.controlSchema}\".medol_tenant_storage_binding"
    private val binding get() = "\"${properties.controlSchema}\".medol_tenant_storage_location"
    private val progress get() = "\"${properties.controlSchema}\".medol_tenant_storage_progress"
    private val eventResources get() = "\"${properties.controlSchema}\".medol_tenant_event_resource"
    private val bundleHash: String by lazy {
        val scanner = PathMatchingResourcePatternResolver()
        val scripts = scanner.getResources("classpath*:${contract.migrationLocation}/**/*.sql")
        check(scripts.isNotEmpty()) { "Tenant migration scripts are missing." }
        val resources = scripts.toList() + scanner.getResources("classpath*:${contract.migrationLocation}/**/*.sql.conf").toList()
        val names = resources.map { requireNotNull(it.filename) }
        check(names.size == names.toSet().size) { "Tenant migration resources have duplicate filenames." }
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(contract.tenantSchemaHash.toByteArray(Charsets.UTF_8))
        for (resource in resources.sortedBy { it.filename }) {
            digest.update(requireNotNull(resource.filename).toByteArray(Charsets.UTF_8))
            digest.update(0.toByte())
            resource.inputStream.use { input ->
                val bytes = input.readBytes()
                digest.update(ByteBuffer.allocate(8).putLong(bytes.size.toLong()).array())
                digest.update(bytes)
            }
        }
        digest.digest().joinToString("") { "%02x".format(it) }
    }

    override fun migrate(tenantId: String): TenantStorageStatus {
        check(properties.migration.enabled && properties.mode != TenantStorageMode.SHARED_SCHEMA) { "Managed tenant migration is not enabled." }
        check(contract.tenantSchema.isNotEmpty() && contract.tenantSchemaHash.isNotBlank()) { "Generated tenant storage contract is missing." }
        require(tenantId.isNotBlank() && tenantId.length <= 255) { "Invalid tenant storage identifier." }
        val schema = schema(tenantId)
        val location = location(tenantId)
        val target = connections.target(location.dataSource)
        initializeRegistry()
        return locked("schema:" + location.dataSource + "/" + schema) {
            bind(tenantId, schema)
            val hash = bundleHash
            mark(tenantId, "MIGRATING", hash, null, null)
            try {
                if (properties.mode == TenantStorageMode.SEPARATE_DATABASE) connections.assertDatabaseIdentity(target, location.dataSource)
                target.connection.use { connection ->
                    fun tableExists(name: String): Boolean {
                        connection.metaData.getTables(null, schema, name, arrayOf("TABLE")).use { rows ->
                            while (rows.next()) if (rows.getString("TABLE_SCHEM") == schema && rows.getString("TABLE_NAME") == name) return true
                        }
                        return false
                    }
                    if (!tableExists(contract.migrationHistoryTable)) check(contract.tenantSchema.none {
                        it.name != "medol_tenant_projection_receipt" && tableExists(it.name)
                    }) { "Existing tenant tables have no deployment migration history; explicit adoption is required." }
                }
                val flyway = Flyway.configure().dataSource(target)
                    .locations("classpath:" + contract.migrationLocation)
                    .schemas(schema).defaultSchema(schema).table(contract.migrationHistoryTable)
                    .createSchemas(true).baselineOnMigrate(true).baselineVersion("0").cleanDisabled(true)
                    .ignoreMigrationPatterns(*emptyArray<String>())
                    .validateMigrationNaming(true).failOnMissingLocations(true).placeholderReplacement(false).load()
                flyway.migrate()
                target.connection.use { TenantSchemaVerifier.verify(it, schema, contract.tenantSchema) }
                connections.verifyBusinessAccess(location, contract.tenantSchema)
                val version = flyway.info().current()?.version?.toString()
                mark(tenantId, "READY", hash, version, null)
                requireReady(tenantId, schema)
                TenantStorageStatus(tenantId, schema, contract.deploymentId, TenantStorageState.READY, version, hash)
            } catch (failure: Exception) {
                try { mark(tenantId, "FAILED", hash, null, "MIGRATION_FAILED") } catch (recording: Exception) { failure.addSuppressed(recording) }
                throw IllegalStateException("Tenant storage migration failed for deployment ${contract.deploymentId}; storage remains unavailable.", failure)
            }
        }
    }

    override fun status(tenantId: String): TenantStorageStatus {
        if (properties.mode == TenantStorageMode.SHARED_SCHEMA) return TenantStorageStatus(tenantId, properties.controlSchema, contract.deploymentId, TenantStorageState.EXTERNAL)
        val schema = schema(tenantId)
        if (!properties.migration.enabled) return TenantStorageStatus(tenantId, schema, contract.deploymentId, TenantStorageState.EXTERNAL)
        return readStatus(tenantId, schema)
    }

    private fun readStatus(tenantId: String, schema: String): TenantStorageStatus {
        return try {
            read.query("SELECT p.state, p.version, p.bundle_hash, p.error_code FROM $binding b JOIN $progress p ON b.tenant_id=p.tenant_id WHERE b.tenant_id=? AND b.schema_name=? AND b.binding_hash=? AND p.deployment_id=?", { row, _ ->
                TenantStorageStatus(tenantId, schema, contract.deploymentId, TenantStorageState.valueOf(row.getString(1)), row.getString(2), row.getString(3), row.getString(4))
            }, tenantId, schema, bindingHash(tenantId), contract.deploymentId).singleOrNull()
                ?: TenantStorageStatus(tenantId, schema, contract.deploymentId, TenantStorageState.UNINITIALIZED)
        } catch (_: DataAccessException) {
            TenantStorageStatus(tenantId, schema, contract.deploymentId, TenantStorageState.FAILED, errorCode = "REGISTRY_UNAVAILABLE")
        }
    }

    override fun requireReady(tenantId: String, schema: String) {
        if (!properties.migration.enabled) {
            if (properties.mode == TenantStorageMode.SEPARATE_DATABASE || properties.eventStores.isNotEmpty()) {
                if (!bindingMatches(tenantId, schema)) throw AccessDeniedException("Physical tenant binding has not been registered for this configuration.")
            }
            return
        }
        val status = readStatus(tenantId, schema)
        if (status.schema != schema || status.state != TenantStorageState.READY || status.bundleHash != bundleHash) {
            throw AccessDeniedException("Tenant storage is not ready for this deployment version.")
        }
    }

    override fun register(tenantId: String) {
        val value = location(tenantId)
        require(tenantId.isNotBlank() && tenantId.length <= 255 && TenantStorageProperties.validSchema(value.schema))
        if (bindingMatches(tenantId, value.schema)) return
        initializeRegistry()
        locked("schema:" + value.dataSource + "/" + value.schema) { bind(tenantId, value.schema) }
    }

    private fun bindingMatches(tenantId: String, schema: String): Boolean = try {
        read.queryForObject("SELECT COUNT(*) FROM $binding WHERE tenant_id=? AND schema_name=? AND binding_hash=?", Int::class.java, tenantId, schema, bindingHash(tenantId)) == 1
    } catch (_: DataAccessException) { false }

    override fun registerEventSource(resource: String, fingerprint: String) {
        require(resource.matches(Regex("[a-z][a-z0-9_-]{0,47}")) && fingerprint.matches(Regex("[0-9a-f]{64}")))
        val recorded = try { read.queryForList("SELECT fingerprint FROM $eventResources WHERE resource_id=?", String::class.java, resource).singleOrNull() } catch (_: DataAccessException) { null }
        if (recorded != null) { check(recorded == fingerprint) { "Event store endpoint or generation changed; explicit migration is required." }; return }
        initializeRegistry()
        locked("event-source:" + resource) {
            write.execute("CREATE TABLE IF NOT EXISTS $eventResources (resource_id VARCHAR(48) PRIMARY KEY, fingerprint VARCHAR(64) NOT NULL)")
            try { write.update("INSERT INTO $eventResources(resource_id, fingerprint) VALUES (?, ?)", resource, fingerprint) }
            catch (_: DuplicateKeyException) { check(write.queryForObject("SELECT fingerprint FROM $eventResources WHERE resource_id=?", String::class.java, resource) == fingerprint) { "Event resource identity cannot be rebound automatically." } }
        }
    }

    private fun schema(tenantId: String): String = location(tenantId).schema.also {
        val resource = location(tenantId).dataSource
        require(TenantStorageProperties.validSchema(it) && (resource != "default" || it != properties.controlSchema)) { "Invalid separate tenant schema." }
    }

    private fun initializeRegistry() {
        if (initialized.get()) return
        locked("registry") {
            if (properties.mode == TenantStorageMode.SEPARATE_DATABASE) connections.assertDatabaseIdentity(control, "__medol_control__")
            write.execute("CREATE TABLE IF NOT EXISTS $legacyBinding (tenant_id VARCHAR(255) PRIMARY KEY, schema_name VARCHAR(63) NOT NULL UNIQUE)")
            write.execute("CREATE TABLE IF NOT EXISTS $binding (tenant_id VARCHAR(255) PRIMARY KEY, data_source VARCHAR(48) NOT NULL, schema_name VARCHAR(63) NOT NULL, binding_hash VARCHAR(64) NOT NULL, ownership_key VARCHAR(255) UNIQUE)")
            write.execute("CREATE TABLE IF NOT EXISTS $progress (tenant_id VARCHAR(255) NOT NULL, deployment_id VARCHAR(255) NOT NULL, state VARCHAR(16) NOT NULL, bundle_hash VARCHAR(64) NOT NULL, version VARCHAR(80), error_code VARCHAR(64), updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(tenant_id, deployment_id))")
            initialized.set(true)
        }
    }

    private fun bind(tenantId: String, schema: String) {
        val location = location(tenantId)
        val legacy = write.queryForList("SELECT schema_name FROM $legacyBinding WHERE tenant_id=?", String::class.java, tenantId).singleOrNull()
        check(legacy == null || (location.dataSource == "default" && legacy == schema)) { "Existing storage ownership requires explicit migration before rebinding." }
        if (location.dataSource == "default" && properties.mode != TenantStorageMode.SHARED_SCHEMA) {
            try { write.update("INSERT INTO $legacyBinding (tenant_id, schema_name) VALUES (?, ?)", tenantId, schema) }
            catch (_: DuplicateKeyException) { check(write.queryForObject("SELECT COUNT(*) FROM $legacyBinding WHERE tenant_id=? AND schema_name=?", Int::class.java, tenantId, schema) == 1) { "Tenant schema ownership is already bound." } }
        }
        val hash = bindingHash(tenantId)
        val ownership = if (properties.mode == TenantStorageMode.SHARED_SCHEMA) null else location.dataSource + "/" + schema
        try { write.update("INSERT INTO $binding (tenant_id, data_source, schema_name, binding_hash, ownership_key) VALUES (?, ?, ?, ?, ?)", tenantId, location.dataSource, schema, hash, ownership) }
        catch (_: DuplicateKeyException) {
            check(write.queryForObject("SELECT COUNT(*) FROM $binding WHERE tenant_id=? AND data_source=? AND schema_name=? AND binding_hash=?", Int::class.java, tenantId, location.dataSource, schema, hash) == 1) {
                "Tenant schema ownership is already bound; automatic rebinding is forbidden."
            }
        }
    }

    private fun bindingHash(tenantId: String): String {
        val location = location(tenantId)
        val values = listOf(location.dataSource, location.schema, location.eventStore, location.version,
            properties.dataSources[location.dataSource]?.url ?: "default",
            properties.eventStores[location.eventStore]?.target ?: "default",
            properties.eventStores[location.eventStore]?.generation ?: "1")
        return MessageDigest.getInstance("SHA-256").digest(values.joinToString("\u0000").toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }

    private fun mark(tenantId: String, state: String, hash: String, version: String?, error: String?) {
        val updated = write.update("UPDATE $progress SET state=?, bundle_hash=?, version=?, error_code=?, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND deployment_id=?", state, hash, version, error, tenantId, contract.deploymentId)
        if (updated == 0) write.update("INSERT INTO $progress (tenant_id, deployment_id, state, bundle_hash, version, error_code) VALUES (?, ?, ?, ?, ?, ?)", tenantId, contract.deploymentId, state, hash, version, error)
    }

    private fun <T> locked(key: String, block: () -> T): T = locks[Math.floorMod(key.hashCode(), locks.size)].withLock {
        control.connection.use { connection ->
            val postgres = connection.metaData.databaseProductName == "PostgreSQL"
            check(postgres || connection.metaData.databaseProductName == "H2") { "Managed tenant migration supports PostgreSQL; H2 is test-only." }
            val lockId = ByteBuffer.wrap(MessageDigest.getInstance("SHA-256").digest(("medol-tenant-storage:" + key).toByteArray(Charsets.UTF_8))).long
            fun lock(operation: String) { connection.prepareStatement("SELECT pg_advisory_$operation(?)").use { statement -> statement.setLong(1, lockId); statement.execute() } }
            if (postgres) lock("lock")
            try { block() } finally { if (postgres) lock("unlock") }
        }
    }

    companion object { private val locks = Array(64) { ReentrantLock() } }
}
