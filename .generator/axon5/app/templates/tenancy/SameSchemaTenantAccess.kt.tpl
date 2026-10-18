package <%= rootPackage %>.shared.application.tenancy

import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.security.access.AccessDeniedException
import java.util.UUID

class SameSchemaTenantAccess(
    private val jdbc: NamedParameterJdbcTemplate,
    private val contract: TenantCapabilityContract,
    private val properties: TenantStorageProperties = TenantStorageProperties()
) : TenantAccess {
    init { properties.validate() }
    private fun controlQuery(query: String) = query.replace("\"__medol_control__\".", "\"" + properties.controlSchema + "\".")
    override fun initialize(contract: TenantCapabilityContract) {
        check(contract.accessQuery.isNotBlank()) { "Tenant access query is not configured." }
        try {
            jdbc.query(controlQuery(this.contract.accessQuery), this.contract.accessParameters + mapOf(
                "tenant" to identifier("00000000-0000-0000-0000-000000000000", this.contract.uuidTenantId),
                "user" to identifier("00000000-0000-0000-0000-000000000000", this.contract.uuidUserId)
            )) { row, _ -> row.getInt(1) }
        } catch (exception: org.springframework.dao.DataAccessException) {
            throw IllegalStateException("Tenant directories are unavailable. Check the fixed control-plane database and schema, initialized by the control plane.", exception)
        }
    }

    override fun verify(tenantId: String, userId: String): TenantIdentity {
        if (tenantId.isBlank() || userId.isBlank()) throw AccessDeniedException("Tenant and user are required.")
        val parameters = contract.accessParameters + mapOf(
            "tenant" to identifier(tenantId, contract.uuidTenantId),
            "user" to identifier(userId, contract.uuidUserId)
        )
        val allowed = jdbc.query(controlQuery(contract.accessQuery), parameters) { row, _ -> row.getInt(1) }.isNotEmpty()
        if (!allowed) throw AccessDeniedException("Tenant access is not available.")
        return TenantIdentity(parameters.getValue("tenant").toString(), parameters.getValue("user").toString())
    }

    private fun identifier(value: String, uuid: Boolean): Any =
        if (uuid) try { UUID.fromString(value) } catch (_: IllegalArgumentException) {
            throw AccessDeniedException("Invalid tenant identity.")
        } else value

    override fun forEachTenant(userId: String, block: () -> Unit) {
        var after: String? = null
        do {
            val parameters = contract.accessParameters.toMutableMap()
            parameters["user"] = identifier(userId, contract.uuidUserId)
            val condition = after?.let {
                parameters["after"] = identifier(it, contract.uuidTenantId)
                " AND " + contract.directoryIdColumn + " > :after"
            }.orEmpty()
            val ids = jdbc.query(controlQuery(contract.backgroundQuery) + condition + " ORDER BY " + contract.directoryIdColumn + " FETCH FIRST 200 ROWS ONLY", parameters) { row, _ -> row.getString(1) }
            ids.forEach { tenant -> TenantScope.withIdentity(verify(tenant, userId), block) }
            after = ids.lastOrNull()
        } while (ids.size == 200)
    }
}
