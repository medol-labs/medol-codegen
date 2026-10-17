package <%= rootPackage %>.shared.application.tenancy

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Component
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.authentication.AnonymousAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.method.HandlerMethod
import org.springframework.web.servlet.HandlerInterceptor
import org.springframework.web.servlet.config.annotation.InterceptorRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer
import <%= rootPackage %>.shared.security.CurrentUserProvider
import <%= rootPackage %>.shared.security.MedolSecurityProperties

@Configuration
class TenantWebConfiguration(private val interceptor: TenantRequestInterceptor) : WebMvcConfigurer {
    override fun addInterceptors(registry: InterceptorRegistry) { registry.addInterceptor(interceptor) }
}

@Component
class TenantRequestInterceptor(
    private val access: SameSchemaTenantAccess,
    private val users: CurrentUserProvider,
    private val contract: TenantCapabilityContract,
    private val relay: TenantRelay,
    private val security: MedolSecurityProperties
) : HandlerInterceptor {
            override fun preHandle(request: HttpServletRequest, response: HttpServletResponse, handler: Any): Boolean {
                request.removeAttribute(TenantScope.REQUEST_ATTRIBUTE)
                if (handler !is HandlerMethod) return true
                val owner = handler.beanType.name
                if (!owner.startsWith("<%= rootPackage %>.")) return true
                if (owner.startsWith("<%= rootPackage %>.shared.security.") || owner.startsWith("<%= rootPackage %>.iam.infrastructure.security.")) return true
                val authentication = SecurityContextHolder.getContext().authentication
                if (authentication == null || !authentication.isAuthenticated || authentication is AnonymousAuthenticationToken) {
                    throw AccessDeniedException("Authentication is required for tenant access.")
                }
                if (contract.controlPlanePackages.any { owner.startsWith(it) }) return true
                val forwarded = request.getHeader(TenantRelay.HEADER)
                val requestedIdentity = if (forwarded != null) {
                    if (authentication.credentials != security.internalToken) throw AccessDeniedException("Tenant relay requires service authentication.")
                    relay.verify(forwarded)
                } else null
                val selectedTenant = requestedIdentity?.tenantId ?: request.getHeader("X-Tenant-Id")?.trim()
                    ?: throw AccessDeniedException("Select a tenant before accessing business resources.")
                val identity = access.verify(selectedTenant, requestedIdentity?.userId ?: users.currentUser().id.toString())
                request.setAttribute(TenantScope.REQUEST_ATTRIBUTE, identity)
                return true
            }
}
