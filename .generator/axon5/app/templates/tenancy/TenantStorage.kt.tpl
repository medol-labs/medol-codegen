package <%= rootPackage %>.shared.application.tenancy

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.security.access.AccessDeniedException

enum class TenantStorageMode { SHARED_SCHEMA, SEPARATE_SCHEMA, SEPARATE_DATABASE }

data class TenantDataSourceProperties(
    val url: String = "", val username: String = "", val password: String = "",
    val driverClassName: String = "org.postgresql.Driver", val poolSize: Int = 5,
    val migrationUsername: String? = null, val migrationPassword: String? = null
) {
    override fun toString() = "TenantDataSourceProperties(credentials=<redacted>)"
}

data class TenantEventStoreProperties(
    val target: String = "", val plaintext: Boolean = false, val apiKey: String = "", val generation: String = "1"
) {
    override fun toString() = "TenantEventStoreProperties(credentials=<redacted>)"
}

data class TenantMigrationProperties(
    val enabled: Boolean = false,
    val username: String? = null,
    val password: String? = null
) {
    override fun toString() = "TenantMigrationProperties(enabled=$enabled, username=$username, password=<redacted>)"
}

@ConfigurationProperties("medol.tenancy")
data class TenantStorageProperties(
    val mode: TenantStorageMode = TenantStorageMode.SHARED_SCHEMA,
    val controlSchema: String = "public",
    val schemas: Map<String, String> = emptyMap(),
    val businessPoolSize: Int = 10,
    val migration: TenantMigrationProperties = TenantMigrationProperties(),
    val dataSources: Map<String, TenantDataSourceProperties> = emptyMap(),
    val eventStores: Map<String, TenantEventStoreProperties> = emptyMap(),
    val bindings: Map<String, TenantStorageLocation> = emptyMap()
) {
    fun validate() {
        require(validSchema(controlSchema)) { "Invalid tenant control schema." }
        require(businessPoolSize > 0) { "Tenant business pool size must be positive." }
        require(!migration.enabled || mode != TenantStorageMode.SHARED_SCHEMA) { "Managed tenant migrations require isolated storage." }
        require(dataSources.size <= 32 && eventStores.size <= 32) { "Too many tenant storage resources for one deployment." }
        require((dataSources.keys + eventStores.keys).all { it != "default" && it.matches(Regex("[a-z][a-z0-9_-]{0,47}")) }) { "Invalid tenant resource identifier." }
        require(dataSources.values.all { it.url.isNotBlank() && it.poolSize > 0 }) { "Invalid tenant datasource." }
        require(dataSources.values.none { Regex("[?&;](?:user|username|password)=|://[^/?#]*@", RegexOption.IGNORE_CASE).containsMatchIn(it.url) }) { "Tenant datasource URLs cannot contain embedded credentials." }
        require(dataSources.values.map { it.url }.toSet().size == dataSources.size) { "Datasource aliases cannot point to the same database." }
        require(eventStores.values.all { it.target.isNotBlank() && it.generation.matches(Regex("[a-zA-Z0-9_-]{1,32}")) }) { "Invalid tenant event store." }
        require(eventStores.values.map { it.target }.toSet().size == eventStores.size) { "Event store aliases cannot share an endpoint." }
        require(schemas.keys.intersect(bindings.keys).isEmpty()) { "Do not configure schemas and bindings for the same tenant." }
        val locations = schemas.mapValues { TenantStorageLocation(it.value) } + bindings
        require(locations.keys.all { it.isNotBlank() && it.length <= 255 }) { "Invalid tenant binding identifier." }
        for (location in locations.values) {
            require(validSchema(location.schema) && location.version.matches(Regex("[a-zA-Z0-9_-]{1,32}"))) { "Invalid tenant storage location." }
            require(location.eventStore == "default" || eventStores.containsKey(location.eventStore)) { "Unknown tenant event store." }
            when (mode) {
                TenantStorageMode.SHARED_SCHEMA -> require(location.dataSource == "default" && location.schema == controlSchema)
                TenantStorageMode.SEPARATE_SCHEMA -> require(location.dataSource == "default" && location.schema != controlSchema)
                TenantStorageMode.SEPARATE_DATABASE -> require(dataSources.containsKey(location.dataSource)) { "A separate database binding requires an explicit datasource." }
            }
        }
        if (mode != TenantStorageMode.SHARED_SCHEMA) require(locations.values.map { it.dataSource to it.schema }.toSet().size == locations.size) { "Tenant storage locations must be exclusive." }
        if (mode == TenantStorageMode.SEPARATE_SCHEMA) {
            require(schemas.keys.none(String::isBlank)) { "Tenant storage bindings require nonblank tenant identifiers." }
            require(schemas.values.all { validSchema(it) && it != controlSchema }) {
                "Tenant schemas must be safe identifiers and different from the control schema."
            }
            require(schemas.values.toSet().size == schemas.size) { "A separate schema cannot belong to multiple tenants." }
        }
    }

    companion object {
        fun validSchema(value: String): Boolean = value.matches(Regex("[a-z][a-z0-9_]{0,62}"))
    }
}

data class TenantStorageLocation(val schema: String, val dataSource: String = "default", val eventStore: String = "default", val version: String = "1")

interface TenantStorageResolver {
    fun resolve(tenantId: String): TenantStorageLocation
    fun forEachTenant(block: (String) -> Unit) {
        error("Startup migration requires the custom TenantStorageResolver to enumerate tenant bindings.")
    }
}

class ConfiguredTenantStorageResolver(private val properties: TenantStorageProperties) : TenantStorageResolver {
    init { properties.validate() }

    override fun resolve(tenantId: String): TenantStorageLocation {
        if (tenantId.isBlank()) throw AccessDeniedException("A verified tenant is required for storage routing.")
        properties.bindings[tenantId]?.let { return it }
        val schema = when (properties.mode) {
            TenantStorageMode.SHARED_SCHEMA -> {
                if (properties.eventStores.isNotEmpty()) throw AccessDeniedException("Physical event storage requires an explicit tenant binding.")
                properties.controlSchema
            }
            TenantStorageMode.SEPARATE_SCHEMA -> properties.schemas[tenantId]
                ?: throw AccessDeniedException("Tenant storage has not been provisioned.")
            TenantStorageMode.SEPARATE_DATABASE -> throw AccessDeniedException("Tenant storage has not been provisioned.")
        }
        return TenantStorageLocation(schema)
    }

    override fun forEachTenant(block: (String) -> Unit) { (properties.schemas.keys + properties.bindings.keys).sorted().forEach(block) }
}
