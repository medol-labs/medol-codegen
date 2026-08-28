package <%= rootPackage %>.iam.infrastructure.security

import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Date
import javax.crypto.spec.SecretKeySpec
import com.nimbusds.jose.jwk.source.ImmutableSecret
import org.springframework.http.HttpStatus
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.oauth2.jose.jws.MacAlgorithm
import org.springframework.security.oauth2.jwt.JwsHeader
import org.springframework.security.oauth2.jwt.JwtClaimsSet
import org.springframework.security.oauth2.jwt.JwtEncoder
import org.springframework.security.oauth2.jwt.JwtEncoderParameters
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import <%= rootPackage %>.shared.security.CurrentUser
import <%= rootPackage %>.shared.security.MedolSecurityProperties

@RestController
@RequestMapping("/api/auth")
class IamAuthResource(
    private val properties: MedolSecurityProperties,
    private val permissionService: IamPermissionService,
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

    @PostMapping("/login")
    @ResponseStatus(HttpStatus.OK)
    fun login(@RequestBody request: IamLoginRequest): IamLoginResponse {
        if (!properties.provider.equals("local", ignoreCase = true)) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Local login is disabled.")
        }

        val user = permissionService.authenticateLocal(request.username) { passwordHash ->
            passwordEncoder.matches(request.password, passwordHash)
        }
        val issuedAt = Instant.now()
        val expiresAt = issuedAt.plus(properties.localTokenTtlSeconds, ChronoUnit.SECONDS)
        val claims = JwtClaimsSet.builder()
            .subject(user.id.toString())
            .issuedAt(issuedAt)
            .expiresAt(expiresAt)
            .claim("username", user.username)
            .claim("organizationId", user.organizationId?.toString())
            .claim("roles", user.roles)
            .claim("permissions", user.permissions)
            .claim("provider", "local")
            .build()
        val header = JwsHeader.with(MacAlgorithm.HS256).build()
        val token = jwtEncoder.encode(JwtEncoderParameters.from(header, claims)).tokenValue

        return IamLoginResponse(
            accessToken = token,
            tokenType = "Bearer",
            expiresAt = Date.from(expiresAt).time,
            user = user,
        )
    }
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
