package <%= rootPackage %>.iam.infrastructure.security

import jakarta.servlet.http.HttpServletRequest
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.CompletableFuture
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.security.oauth2.jwt.JwtDecoder
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import <%= rootPackage %>.identityaccessmanagement.assignroletouser.AssignRoleToUserCommand
import <%= rootPackage %>.identityaccessmanagement.registeruseraccount.RegisterUserAccountCommand
import <%= rootPackage %>.shared.application.metadata.MetadataFactory
import <%= rootPackage %>.shared.security.MedolSecurityProperties

@RestController
@RequestMapping("/api/auth")
class IamAdminSetupResource(
    private val properties: MedolSecurityProperties,
    private val authIdentityRepository: AuthIdentityRepository,
    private val authorizationBootstrap: IamAuthorizationBootstrap,
    private val commandGateway: CommandGateway,
    private val passwordEncoder: PasswordEncoder,
    private val jwtDecoder: JwtDecoder,
) {
    @PostMapping("/setup-admin")
    @ResponseStatus(HttpStatus.OK)
    fun setupLocalAdmin(
        @RequestBody request: LocalAdminSetupRequest,
        servletRequest: HttpServletRequest,
    ): CompletableFuture<AdminSetupResponse> {
        requireProvider("local", "Local admin setup is only available when local auth is enabled.")
        validateSetupToken(request.setupToken)
        ensureAdminIsNotInitialized()

        val userId = UUID.randomUUID()
        val username = request.username.trim().ifBlank {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Username is required.")
        }
        val password = request.password.ifBlank {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Password is required.")
        }

        return initializeAdmin(
            userAccountId = userId,
            username = username,
            providerSubject = userId.toString(),
            passwordHash = passwordEncoder.encode(password),
            organizationId = request.organizationId,
            servletRequest = servletRequest,
        )
    }

    @PostMapping("/setup-supabase-admin")
    @ResponseStatus(HttpStatus.OK)
    fun setupSupabaseAdmin(
        @RequestBody request: SupabaseAdminSetupRequest,
        servletRequest: HttpServletRequest,
    ): CompletableFuture<AdminSetupResponse> {
        requireProvider("supabase", "Supabase admin setup is only available when Supabase auth is enabled.")
        validateSetupToken(request.setupToken)
        ensureAdminIsNotInitialized()

        val jwt = decodeBearerJwt(servletRequest)
        val subject = jwt.subject?.trim().orEmpty().ifBlank {
            throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Supabase subject is required.")
        }
        val username = jwt.getClaimAsString("email")
            ?: jwt.getClaimAsString("username")
            ?: subject

        return initializeAdmin(
            userAccountId = subject.toStableUserId(),
            username = username,
            providerSubject = subject,
            passwordHash = null,
            organizationId = request.organizationId,
            servletRequest = servletRequest,
        )
    }

    private fun initializeAdmin(
        userAccountId: UUID,
        username: String,
        providerSubject: String,
        passwordHash: String?,
        organizationId: UUID?,
        servletRequest: HttpServletRequest,
    ): CompletableFuture<AdminSetupResponse> {
        val metadata = MetadataFactory.from(servletRequest)
        val commands = listOf(
            RegisterUserAccountCommand(
                userAccountId = userAccountId,
                username = username,
                providerSubject = providerSubject,
                passwordHash = passwordHash,
                organizationId = organizationId,
            ),
            AssignRoleToUserCommand(
                userAccountId = userAccountId,
                roleCode = ADMIN_ROLE,
            ),
        )

        return authorizationBootstrap.initialize(metadata).thenCompose {
            commands.fold(CompletableFuture.completedFuture(Unit)) { future, command ->
                future.thenCompose {
                    commandGateway.send(command, metadata).resultMessage.thenApply { Unit }
                }
            }
        }.thenApply {
            AdminSetupResponse(
                userAccountId = userAccountId,
                username = username,
                roleCode = ADMIN_ROLE,
            )
        }
    }

    private fun validateSetupToken(actual: String) {
        if (!properties.adminBootstrap.enabled) {
            throw ResponseStatusException(HttpStatus.NOT_FOUND, "Admin setup is disabled.")
        }
        val expected = properties.adminBootstrap.setupToken.trim()
        if (expected.isBlank()) {
            throw ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Admin setup token is not configured.")
        }
        if (actual.trim() != expected) {
            throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid admin setup token.")
        }
    }

    private fun requireProvider(expected: String, message: String) {
        if (!properties.provider.equals(expected, ignoreCase = true)) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, message)
        }
    }

    private fun ensureAdminIsNotInitialized() {
        if (authIdentityRepository.hasUserWithRole(ADMIN_ROLE)) {
            throw ResponseStatusException(HttpStatus.CONFLICT, "Admin account is already initialized.")
        }
    }

    private fun decodeBearerJwt(request: HttpServletRequest): Jwt {
        val header = request.getHeader(HttpHeaders.AUTHORIZATION).orEmpty()
        val token = header.removePrefix("Bearer").trim()
        if (!header.startsWith("Bearer ", ignoreCase = true) || token.isBlank()) {
            throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Bearer token is required.")
        }
        return runCatching { jwtDecoder.decode(token) }
            .getOrElse { throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid bearer token.", it) }
    }

    private fun String.toStableUserId(): UUID =
        runCatching { UUID.fromString(this) }
            .getOrElse { UUID.nameUUIDFromBytes(toByteArray(StandardCharsets.UTF_8)) }

    companion object {
        private const val ADMIN_ROLE = "ADMIN"
    }
}

data class LocalAdminSetupRequest(
    val setupToken: String = "",
    val username: String = "",
    val password: String = "",
    val organizationId: UUID? = null,
)

data class SupabaseAdminSetupRequest(
    val setupToken: String = "",
    val organizationId: UUID? = null,
)

data class AdminSetupResponse(
    val userAccountId: UUID,
    val username: String,
    val roleCode: String,
)
