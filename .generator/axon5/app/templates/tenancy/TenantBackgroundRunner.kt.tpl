package <%= rootPackage %>.shared.application.tenancy

import org.springframework.stereotype.Component
import <%= rootPackage %>.shared.security.MedolSecurityProperties

@Component
class TenantBackgroundRunner(private val access: TenantAccess, private val security: MedolSecurityProperties) {
    fun forEachTenant(block: () -> Unit) = access.forEachTenant(security.internalSubject, block)
}
