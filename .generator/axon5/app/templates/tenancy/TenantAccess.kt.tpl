package <%= rootPackage %>.shared.application.tenancy

interface TenantAccess : TenantIsolationRuntime {
    fun verify(tenantId: String, userId: String): TenantIdentity
    fun forEachTenant(userId: String, block: () -> Unit)
}
