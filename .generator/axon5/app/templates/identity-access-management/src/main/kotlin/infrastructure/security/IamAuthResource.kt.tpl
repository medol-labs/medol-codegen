package <%= rootPackage %>.iam.infrastructure.security

import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Date
import java.util.UUID
import java.util.concurrent.CompletableFuture
import javax.crypto.spec.SecretKeySpec
import jakarta.servlet.http.HttpServletRequest
import com.nimbusds.jose.jwk.source.ImmutableSecret
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.springframework.http.HttpStatus
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.oauth2.jose.jws.MacAlgorithm
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.security.oauth2.jwt.JwsHeader
import org.springframework.security.oauth2.jwt.JwtClaimsSet
import org.springframework.security.oauth2.jwt.JwtDecoder
import org.springframework.security.oauth2.jwt.JwtEncoder
import org.springframework.security.oauth2.jwt.JwtEncoderParameters
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import <%= rootPackage %>.identityaccessmanagement.registeruseraccount.RegisterUserAccountCommand
import <%= rootPackage %>.shared.application.metadata.MetadataFactory
import <%= rootPackage %>.shared.security.CurrentUser
import <%= rootPackage %>.shared.security.MedolSecurityProperties

@RestController
@RequestMapping("/api/auth")
class IamAuthResource(
    private val properties: MedolSecurityProperties,
    private val permissionService: IamPermissionService,
    private val authIdentityRepository: AuthIdentityRepository,
    private val commandGateway: CommandGateway,
    private val passwordEncoder: PasswordEncoder,
) {
    private val jwtEncoder: JwtEncoder by lazy {
        NimbusJwtEncoder(
            ImmutableSecret(
                SecretKeySpec(
                    properties.jwtSecret.toByteArray(Charsets.UTF_8),
                    "HmacSHA256",
                ),
            ),
        )
    }

    private val portalJwtDecoder: JwtDecoder by lazy {
        val secret = properties.portalSso.jwtSecret.trim()
        if (secret.isBlank()) {
            throw ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Portal SSO JWT secret is not configured.")
        }
        NimbusJwtDecoder
            .withSecretKey(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
            .macAlgorithm(MacAlgorithm.HS256)
            .build()
    }

    @PostMapping("/login")
    @ResponseStatus(HttpStatus.OK)
    fun login(@RequestBody request: IamLoginRequest): IamLoginResponse {
        if (!properties.provider.equals("local", ignoreCase = true)) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Local login is disabled.")
        }

        val user = permissionService.authenticateLocal(request.username) { passwordHash ->
            passwordEncoder.matches(request.password, passwordHash)
        }
        return issueSystemToken(user, "local")
    }

    @PostMapping("/exchange-portal-jwt")
    @ResponseStatus(HttpStatus.OK)
    fun exchangePortalJwtForSystemSession(
        @RequestBody request: ExchangePortalJwtForSystemSessionRequest,
        servletRequest: HttpServletRequest,
    ): CompletableFuture<ExchangePortalJwtForSystemSessionResponse> {
        if (!properties.portalSso.enabled) {
            throw ResponseStatusException(HttpStatus.NOT_FOUND, "Portal SSO is disabled.")
        }

        val portalJwt = decodePortalJwt(request.portalJwt)
        validatePortalJwt(portalJwt)

        val subject = portalJwt.subject?.trim().orEmpty().ifBlank {
            throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Portal JWT subject is required.")
        }
        val username = (
            portalJwt.getClaimAsString("email")
                ?: portalJwt.getClaimAsString("username")
                ?: portalJwt.getClaimAsString("preferred_username")
                ?: subject
        ).trim().ifBlank {
            throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Portal JWT username is required.")
        }
        val providerSubject = "portal|$subject"
        val requestedPath = request.requestedPath?.takeIf { it.startsWith("/") }?.takeUnless { it.startsWith("//") }
        val redirectPath = requestedPath ?: properties.portalSso.defaultRedirectPath.takeIf { it.startsWith("/") } ?: "/"
        val userSource = request.systemSource?.trim()?.takeIf { it.isNotEmpty() }
            ?: properties.portalSso.userSource.ifBlank { "PORTAL_SSO" }

        authIdentityRepository.findBySubject(providerSubject)?.let { identity ->
            val token = issueSystemToken(identity.toCurrentUser(), "portal")
            return CompletableFuture.completedFuture(
                ExchangePortalJwtForSystemSessionResponse(
                    accessToken = token.accessToken,
                    tokenType = token.tokenType,
                    expiresAt = token.expiresAt,
                    user = token.user,
                    redirectPath = redirectPath,
                    registrationRequired = false,
                    permissionAssignmentRequired = identity.roles.isEmpty(),
                    notice = if (identity.roles.isEmpty()) "Please contact an administrator to assign permissions." else null,
                )
            )
        }
        authIdentityRepository.findByUsername(username)?.let {
            throw ResponseStatusException(HttpStatus.CONFLICT, "User already exists with a different identity provider.")
        }

        val userAccountId = UUID.nameUUIDFromBytes("portal-sso:$subject".toByteArray(Charsets.UTF_8))
        val metadata = MetadataFactory.from(servletRequest)
        val command = RegisterUserAccountCommand(
            userAccountId = userAccountId,
            username = username,
            providerSubject = providerSubject,
            userSource = userSource,
            passwordHash = null,
        )

        return commandGateway.send(command, metadata).resultMessage.thenApply {
            val user = CurrentUser(
                id = userAccountId,
                username = username,
                organizationId = null,
                roles = emptySet(),
                permissions = emptySet(),
            )
            val token = issueSystemToken(user, "portal")
            ExchangePortalJwtForSystemSessionResponse(
                accessToken = token.accessToken,
                tokenType = token.tokenType,
                expiresAt = token.expiresAt,
                user = token.user,
                redirectPath = redirectPath,
                registrationRequired = true,
                permissionAssignmentRequired = true,
                notice = "Your account has been created. Please contact an administrator to assign permissions.",
            )
        }
    }

    private fun issueSystemToken(user: CurrentUser, provider: String): IamLoginResponse {
        val issuedAt = Instant.now()
        val expiresAt = issuedAt.plus(properties.localTokenTtlSeconds, ChronoUnit.SECONDS)
        val claimsBuilder = JwtClaimsSet.builder()
            .subject(user.id.toString())
            .issuedAt(issuedAt)
            .expiresAt(expiresAt)
            .claim("username", user.username)
            .claim("roles", user.roles)
            .claim("permissions", user.permissions)
            .claim("provider", provider)
        user.organizationId?.let { claimsBuilder.claim("organizationId", it.toString()) }
        val claims = claimsBuilder.build()
        val header = JwsHeader.with(MacAlgorithm.HS256).build()
        val token = jwtEncoder.encode(JwtEncoderParameters.from(header, claims)).tokenValue

        return IamLoginResponse(
            accessToken = token,
            tokenType = "Bearer",
            expiresAt = Date.from(expiresAt).time,
            user = user,
        )
    }

    private fun decodePortalJwt(token: String): Jwt =
        runCatching { portalJwtDecoder.decode(token.trim()) }
            .getOrElse { throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid portal JWT.", it) }

    private fun validatePortalJwt(jwt: Jwt) {
        val issuer = properties.portalSso.issuer.trim()
        if (issuer.isNotBlank() && jwt.issuer?.toString() != issuer) {
            throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Portal JWT issuer is not trusted.")
        }

        val audience = properties.portalSso.audience.trim()
        if (audience.isNotBlank() && audience !in jwt.audience) {
            throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Portal JWT audience is not accepted.")
        }
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

data class IamLoginRequest(
    val username: String = "",
    val password: String = "",
)

data class IamLoginResponse(
    val accessToken: String,
    val tokenType: String,
    val expiresAt: Long,
    val user: CurrentUser,
)

data class ExchangePortalJwtForSystemSessionRequest(
    val portalJwt: String = "",
    val requestedPath: String? = null,
    val systemSource: String? = null,
)

data class ExchangePortalJwtForSystemSessionResponse(
    val accessToken: String,
    val tokenType: String,
    val expiresAt: Long,
    val user: CurrentUser,
    val redirectPath: String,
    val registrationRequired: Boolean,
    val permissionAssignmentRequired: Boolean,
    val notice: String?,
)
