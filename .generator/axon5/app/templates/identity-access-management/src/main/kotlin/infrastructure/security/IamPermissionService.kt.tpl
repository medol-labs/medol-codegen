package <%= rootPackage %>.iam.infrastructure.security

import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes
import org.springframework.web.server.ResponseStatusException
import <%= rootPackage %>.shared.security.CurrentUser
import <%= rootPackage %>.shared.security.CurrentUserJwtResolver

@Service
class IamPermissionService(
    private val authIdentityRepository: AuthIdentityRepository,
) : CurrentUserJwtResolver {
    private val logger = LoggerFactory.getLogger(javaClass)

    override fun resolve(jwt: Jwt, fallback: CurrentUser): CurrentUser =
        if (jwt.getClaimAsString("provider") == "service-account") {
            fallback
        } else {
        loadBySubject(jwt.subject).copy(
            username = fallback.username,
        )
        }

    fun loadBySubject(subject: String): CurrentUser {
        val id = runCatching { UUID.fromString(subject) }.getOrNull()
        val user = authIdentityRepository.findBySubject(subject) ?: id?.let(authIdentityRepository::findById)

        if (user == null || !user.active) {
            val request = (RequestContextHolder.getRequestAttributes() as? ServletRequestAttributes)?.request
            logger.warn("JWT subject is not registered in this service. method={} path={}", request?.method, request?.requestURI)
            throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authenticated user is not registered.")
        }

        return user.toCurrentUser()
    }

    fun authenticateLocal(username: String, passwordMatches: (String) -> Boolean): CurrentUser {
        val user = authIdentityRepository.findByUsername(username)

        if (user == null || !user.active || user.passwordHash == null || !passwordMatches(user.passwordHash)) {
            throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid username or password.")
        }

        return user.toCurrentUser()
    }

    private fun AuthIdentity.toCurrentUser(): CurrentUser =
        CurrentUser(
            id = id,
            username = username,
            organizationId = organizationId,
            roles = roles,
            permissions = permissions,
        )
}
