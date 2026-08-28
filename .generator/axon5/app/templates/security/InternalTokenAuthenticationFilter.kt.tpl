package <%= rootPackage %>.shared.security

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.nio.charset.StandardCharsets
import java.util.UUID
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

@Component
class InternalTokenAuthenticationFilter(
    private val properties: MedolSecurityProperties,
) : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val expectedToken = properties.internalToken.trim()
        val actualToken = request.getHeader(INTERNAL_TOKEN_HEADER)?.trim()
        if (
            properties.enabled &&
            expectedToken.isNotBlank() &&
            actualToken == expectedToken &&
            SecurityContextHolder.getContext().authentication == null
        ) {
            val currentUser = CurrentUser(
                id = runCatching { UUID.fromString(properties.internalSubject) }
                    .getOrElse { UUID.nameUUIDFromBytes(properties.internalSubject.toByteArray(StandardCharsets.UTF_8)) },
                username = properties.internalUsername,
                organizationId = null,
                roles = properties.internalRoles.toSet(),
                permissions = properties.internalPermissions.toSet(),
            )
            val authorities = currentUser.permissions
                .map { SimpleGrantedAuthority(it) }
                .toMutableList()

            authorities += currentUser.roles.map { SimpleGrantedAuthority("ROLE_$it") }
            SecurityContextHolder.getContext().authentication =
                UsernamePasswordAuthenticationToken(currentUser, actualToken, authorities)
        }

        filterChain.doFilter(request, response)
    }

    companion object {
        const val INTERNAL_TOKEN_HEADER = "X-MEDOL-INTERNAL-TOKEN"
    }
}
