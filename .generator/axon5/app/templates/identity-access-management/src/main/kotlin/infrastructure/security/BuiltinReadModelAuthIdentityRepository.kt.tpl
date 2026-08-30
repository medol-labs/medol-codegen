package <%= rootPackage %>.iam.infrastructure.security

import java.util.UUID
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.data.domain.PageRequest
import org.springframework.stereotype.Component
import tech.jhipster.service.filter.StringFilter
import <%= rootPackage %>.identityaccessmanagement.useraccountcatalogs.UserAccountCatalogReadModel
import <%= rootPackage %>.identityaccessmanagement.useraccountcatalogs.UserAccountCatalogReadModelCriteria
import <%= rootPackage %>.identityaccessmanagement.useraccountcatalogs.UserAccountCatalogReadModelRepository
import <%= rootPackage %>.identityaccessmanagement.rolepermissiongrantcatalog.RolePermissionGrantCatalogReadModelCriteria
import <%= rootPackage %>.identityaccessmanagement.rolepermissiongrantcatalog.RolePermissionGrantCatalogReadModelRepository
import <%= rootPackage %>.identityaccessmanagement.userroleassignmentcatalog.UserRoleAssignmentCatalogReadModelCriteria
import <%= rootPackage %>.identityaccessmanagement.userroleassignmentcatalog.UserRoleAssignmentCatalogReadModelRepository

@Component
@ConditionalOnMissingBean(
    value = [AuthIdentityRepository::class],
    ignored = [BuiltinReadModelAuthIdentityRepository::class],
)
class BuiltinReadModelAuthIdentityRepository(
    private val userAccounts: UserAccountCatalogReadModelRepository,
    private val userRoleAssignments: UserRoleAssignmentCatalogReadModelRepository,
    private val rolePermissionGrants: RolePermissionGrantCatalogReadModelRepository,
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
        userRoleAssignments.findAll(PageRequest.of(0, 1000))
            .content
            .any { assignment -> assignment.roleCode?.equals(roleCode, ignoreCase = true) == true }

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
        val grantedRoles = roleCodesForUser(id)
        return AuthIdentity(
            id = id,
            username = loginName,
            providerSubject = providerSubject,
            passwordHash = passwordHash,
            organizationId = null,
            active = active ?: false,
            roles = grantedRoles,
            permissions = grantedRoles
                .flatMap { roleCode -> permissionsForRoleCode(roleCode) }
                .filter { it.isNotBlank() }
                .toSet(),
        )
    }

    private fun roleCodesForUser(userAccountId: UUID): Set<String> =
        userRoleAssignments.findAllByCriteria(UserRoleAssignmentCatalogReadModelCriteria().apply {
            this.userAccountId = exact(userAccountId.toString())
        }, PageRequest.of(0, 1000))
            .content
            .mapNotNull { assignment -> assignment.roleCode }
            .filter { roleCode -> roleCode.isNotBlank() }
            .toSet()

    private fun permissionsForRoleCode(roleCode: String): List<String> =
        rolePermissionGrants.findAllByCriteria(RolePermissionGrantCatalogReadModelCriteria().apply {
            this.roleCode = exact(roleCode)
        }, PageRequest.of(0, 1000))
            .content
            .mapNotNull { grant -> grant.permissionCode }
            .filter { permissionCode -> permissionCode.isNotBlank() }

    private fun exact(value: String): StringFilter =
        StringFilter().apply {
            equals = value
        }
}
