package <%= rootPackage %>.shared.application.tenancy

import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes
import org.springframework.security.access.AccessDeniedException

data class TenantIdentity(val tenantId: String, val userId: String)

object TenantScope {
    const val REQUEST_ATTRIBUTE = "medol.verifiedTenant"
    const val TAG = "__medol_tenant"
    private val local = ThreadLocal<TenantIdentity?>()
    private val control = ThreadLocal<Boolean>()

    fun current(): TenantIdentity? {
        return local.get() ?: ((RequestContextHolder.getRequestAttributes() as? ServletRequestAttributes)
            ?.request?.getAttribute(REQUEST_ATTRIBUTE) as? TenantIdentity)
    }

    fun requireIdentity(): TenantIdentity = current()
        ?: throw AccessDeniedException("A verified tenant context is required.")

    fun requireTenant(): String = requireIdentity().tenantId
    fun isControlStorage(): Boolean = control.get() == true

    fun <T> control(block: () -> T): T {
        val previous = control.get()
        control.set(true)
        try { return block() } finally { if (previous == null) control.remove() else control.set(previous) }
    }

    fun <T> withIdentity(identity: TenantIdentity, block: () -> T): T {
        require(identity.tenantId.isNotBlank() && identity.userId.isNotBlank())
        val previous = local.get()
        val previousControl = control.get()
        control.remove()
        local.set(identity)
        try { return block() } finally {
            if (previous == null) local.remove() else local.set(previous)
            if (previousControl == null) control.remove() else control.set(previousControl)
        }
    }
}

interface TenantCommand {
    val medolTenantScoped: Boolean
    var medolTenantScope: String?
    var medolTenantUser: String?
}
