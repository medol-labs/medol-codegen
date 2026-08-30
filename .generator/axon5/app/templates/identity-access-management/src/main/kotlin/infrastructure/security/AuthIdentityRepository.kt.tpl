package <%= rootPackage %>.iam.infrastructure.security

import java.util.UUID

interface AuthIdentityRepository {
    fun findByUsername(username: String): AuthIdentity?
    fun findBySubject(subject: String): AuthIdentity?
    fun findById(id: UUID): AuthIdentity?
    fun hasUserWithRole(roleCode: String): Boolean
}

data class AuthIdentity(
    val id: UUID,
    val username: String,
    val providerSubject: String?,
    val passwordHash: String?,
    val organizationId: UUID?,
    val active: Boolean,
    val roles: Set<String>,
    val permissions: Set<String>,
)
