package <%= rootPackage %>.shared.application.tenancy

interface TenantAccess : TenantIsolationRuntime {
    fun verify(tenantId: String, userId: String): TenantIdentity
    fun forEachTenant(userId: String, block: () -> Unit)
    fun choices(userId: String, after: String?, size: Int): TenantChoicePage =
        error("Custom tenant access must implement paginated member tenant choices.")
}

data class TenantChoice(val id: String, val label: String)
data class TenantChoicePage(val items: List<TenantChoice>, val nextCursor: String?)
