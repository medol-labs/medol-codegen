package <%= rootPackage %>.iam.infrastructure.security

import java.sql.ResultSet
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException
import <%= rootPackage %>.shared.security.CurrentUser

@Service
class IamPermissionService(
    private val jdbcTemplate: JdbcTemplate,
) {
    fun loadBySubject(subject: String): CurrentUser {
        val user = findUserByProviderSubject(subject) ?: findUserById(subject)

        if (user == null || !user.active) {
            throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authenticated user is not registered.")
        }

        return user.toCurrentUser()
    }

    fun authenticateLocal(username: String, passwordMatches: (String) -> Boolean): CurrentUser {
        val user = jdbcTemplate.query(
            """
            select id, provider_subject, username, password_hash, organization_id, active
            from app_user
            where username = ?
            """.trimIndent(),
            { rs, _ -> rs.toUserRecord() },
            username,
        ).firstOrNull()

        if (user == null || !user.active || user.passwordHash == null || !passwordMatches(user.passwordHash)) {
            throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid username or password.")
        }

        return user.toCurrentUser()
    }

    private fun UserRecord.toCurrentUser(): CurrentUser =
        CurrentUser(
            id = id,
            username = username,
            organizationId = organizationId,
            roles = roles(id),
            permissions = permissions(id),
        )

    private fun findUserByProviderSubject(subject: String): UserRecord? =
        jdbcTemplate.query(
            """
            select id, provider_subject, username, password_hash, organization_id, active
            from app_user
            where provider_subject = ?
            """.trimIndent(),
            { rs, _ -> rs.toUserRecord() },
            subject,
        ).firstOrNull()

    private fun findUserById(subject: String): UserRecord? {
        val id = runCatching { UUID.fromString(subject) }.getOrNull() ?: return null

        return jdbcTemplate.query(
            """
            select id, provider_subject, username, password_hash, organization_id, active
            from app_user
            where id = ?
            """.trimIndent(),
            { rs, _ -> rs.toUserRecord() },
            id,
        ).firstOrNull()
    }

    private fun roles(userId: UUID): Set<String> =
        jdbcTemplate.queryForList(
            """
            select role_code
            from app_user_role
            where user_id = ?
            """.trimIndent(),
            String::class.java,
            userId,
        ).toSet()

    private fun permissions(userId: UUID): Set<String> =
        jdbcTemplate.queryForList(
            """
            select distinct rp.permission_code
            from app_role_permission rp
            join app_user_role ur on ur.role_code = rp.role_code
            where ur.user_id = ?
            """.trimIndent(),
            String::class.java,
            userId,
        ).toSet()

    private fun ResultSet.toUserRecord(): UserRecord =
        UserRecord(
            id = getObject("id", UUID::class.java),
            providerSubject = getString("provider_subject"),
            username = getString("username"),
            passwordHash = getString("password_hash"),
            organizationId = getObject("organization_id", UUID::class.java),
            active = getBoolean("active"),
        )

    private data class UserRecord(
        val id: UUID,
        val providerSubject: String?,
        val username: String,
        val passwordHash: String?,
        val organizationId: UUID?,
        val active: Boolean,
    )
}
