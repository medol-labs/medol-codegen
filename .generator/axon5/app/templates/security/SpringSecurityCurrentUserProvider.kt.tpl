package <%= rootPackage %>.shared.security

import org.springframework.security.authentication.AnonymousAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.stereotype.Component
import java.nio.charset.StandardCharsets
import java.util.UUID

@Component
class SpringSecurityCurrentUserProvider(
    private val properties: MedolSecurityProperties,
) : CurrentUserProvider {
    override fun currentUser(): CurrentUser {
        if (!properties.enabled) {
            return CurrentUser.anonymous()
        }

        val authentication = SecurityContextHolder.getContext().authentication
            ?: return CurrentUser.anonymous()
        if (!authentication.isAuthenticated || authentication is AnonymousAuthenticationToken) {
            return CurrentUser.anonymous()
        }

        return when (val principal = authentication.principal) {
            is CurrentUser -> principal
            is Jwt -> principal.toCurrentUser()
            else -> fallbackUser(authentication.name, authentication.authorities.map { it.authority }.toSet())
        }
    }

    private fun Jwt.toCurrentUser(): CurrentUser {
        val authorities = claims["permissions"].asStringSet() +
            claims["roles"].asStringSet().map { "ROLE_$it" }
        return fallbackUser(subject, authorities).copy(
            username = claims["username"] as? String ?: claims["email"] as? String ?: subject,
            organizationId = (claims["organizationId"] as? String)?.let { runCatching { UUID.fromString(it) }.getOrNull() },
        )
    }

    private fun fallbackUser(subject: String, authorities: Set<String>): CurrentUser {
        return CurrentUser(
            id = runCatching { UUID.fromString(subject) }
                .getOrElse { UUID.nameUUIDFromBytes(subject.toByteArray(StandardCharsets.UTF_8)) },
            username = subject,
            organizationId = null,
            roles = authorities
                .filter { it.startsWith("ROLE_") }
                .map { it.removePrefix("ROLE_") }
                .toSet(),
            permissions = authorities
                .filter { !it.startsWith("ROLE_") }
                .toSet(),
        )
    }

    private fun Any?.asStringSet(): Set<String> =
        when (this) {
            is Collection<*> -> mapNotNull { it?.toString() }.toSet()
            is Array<*> -> mapNotNull { it?.toString() }.toSet()
            is String -> split(",", " ").map { it.trim() }.filter { it.isNotBlank() }.toSet()
            else -> emptySet()
        }
}
