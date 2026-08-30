package <%= rootPackage %>.iam.infrastructure.security

import java.util.UUID
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.data.domain.PageRequest
import org.springframework.stereotype.Component
import tech.jhipster.service.filter.StringFilter
import <%= rootPackage %>.identityaccessmanagement.identityaccesscatalogs.RoleCatalogReadModelRepository
import <%= rootPackage %>.identityaccessmanagement.identityaccesscatalogs.UserAccountCatalogReadModel
import <%= rootPackage %>.identityaccessmanagement.identityaccesscatalogs.UserAccountCatalogReadModelCriteria
import <%= rootPackage %>.identityaccessmanagement.identityaccesscatalogs.UserAccountCatalogReadModelRepository

@Component
@ConditionalOnMissingBean(
    value = [AuthIdentityRepository::class],
    ignored = [BuiltinReadModelAuthIdentityRepository::class],
)
class BuiltinReadModelAuthIdentityRepository(
    private val userAccounts: UserAccountCatalogReadModelRepository,
    private val roles: RoleCatalogReadModelRepository,
) : AuthIdentityRepository {
    override fun findByUsername(username: String): AuthIdentity? =
        findBest(UserAccountCatalogReadModelCriteria().apply {
            this.username = exact(username)
        })

    override fun findBySubject(subject: String): AuthIdentity? =
        findBest(UserAccountCatalogReadModelCriteria().apply {
            this.providerSubject = exact(subject)
        })

    override fun findById(id: UUID): AuthIdentity? =
        userAccounts.findById(id)?.toAuthIdentity()

    override fun hasUserWithRole(roleCode: String): Boolean =
        userAccounts.findAll(PageRequest.of(0, 1000))
            .content
            .any { account -> account.roleCodes.any { it.equals(roleCode, ignoreCase = true) } }

    private fun findBest(criteria: UserAccountCatalogReadModelCriteria): AuthIdentity? =
        userAccounts.findAllByCriteria(criteria, PageRequest.of(0, 1000))
            .content
            .mapNotNull { it.toAuthIdentity() }
            .sortedWith(
                compareByDescending<AuthIdentity> { it.active }
                    .thenByDescending { it.roles.isNotEmpty() }
                    .thenBy { it.username }
            )
            .firstOrNull()

    private fun UserAccountCatalogReadModel.toAuthIdentity(): AuthIdentity? {
        val id = userAccountId ?: return null
        val loginName = username ?: return null
        val grantedRoles = roleCodes.filter { it.isNotBlank() }.toSet()
        return AuthIdentity(
            id = id,
            username = loginName,
            providerSubject = providerSubject,
            passwordHash = passwordHash,
            organizationId = organizationId,
            active = active ?: false,
            roles = grantedRoles,
            permissions = grantedRoles
                .flatMap { roleCode -> roles.findById(roleCode)?.permissionCodes ?: emptyList() }
                .filter { it.isNotBlank() }
                .toSet(),
        )
    }

    private fun exact(value: String): StringFilter =
        StringFilter().apply {
            equals = value
        }
}
