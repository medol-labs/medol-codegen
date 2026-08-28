package <%= rootPackage %>.shared.security

import java.nio.charset.StandardCharsets
import java.util.UUID
import javax.crypto.spec.SecretKeySpec
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.convert.converter.Converter
import org.springframework.http.HttpMethod
import org.springframework.security.authentication.AbstractAuthenticationToken
import org.springframework.security.config.Customizer
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.crypto.factory.PasswordEncoderFactories
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.oauth2.jose.jws.MacAlgorithm
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.security.oauth2.jwt.JwtDecoder
import org.springframework.security.oauth2.jwt.JwtDecoders
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter
import org.springframework.security.web.SecurityFilterChain
import org.springframework.web.cors.CorsConfiguration
import org.springframework.web.cors.CorsConfigurationSource
import org.springframework.web.cors.UrlBasedCorsConfigurationSource

@Configuration
@EnableMethodSecurity
@EnableConfigurationProperties(MedolSecurityProperties::class)
class MedolSecurityConfiguration {
    @Bean
    fun passwordEncoder(): PasswordEncoder = PasswordEncoderFactories.createDelegatingPasswordEncoder()

    @Bean
    fun medolJwtDecoder(properties: MedolSecurityProperties): JwtDecoder {
        if (!properties.enabled || properties.provider.equals("local", ignoreCase = true)) {
            return NimbusJwtDecoder
                .withSecretKey(secretKey(properties))
                .macAlgorithm(MacAlgorithm.HS256)
                .build()
        }

        if (properties.provider.equals("supabase", ignoreCase = true)) {
            val jwkSetUri = properties.supabase.jwkSetUri.trim()
            if (jwkSetUri.isNotBlank()) {
                return NimbusJwtDecoder.withJwkSetUri(jwkSetUri).build()
            }

            val issuerUri = properties.supabase.issuerUri.trim()
            require(issuerUri.isNotBlank()) {
                "medol.security.supabase.issuer-uri or jwk-set-uri is required when Supabase auth is enabled."
            }

            return JwtDecoders.fromIssuerLocation(issuerUri)
        }

        throw IllegalArgumentException("Unsupported medol.security.provider: ${properties.provider}")
    }

    @Bean
    fun medolJwtAuthenticationConverter(
    ): Converter<Jwt, AbstractAuthenticationToken> =
        Converter { jwt ->
            val currentUser = jwt.toCurrentUser()
            val authorities = currentUser.permissions
                .map { SimpleGrantedAuthority(it) }
                .toMutableList()

            authorities += currentUser.roles.map { SimpleGrantedAuthority("ROLE_$it") }

            JwtAuthenticationToken(jwt, authorities, currentUser.username)
        }

    @Bean
    fun medolSecurityFilterChain(
        http: HttpSecurity,
        properties: MedolSecurityProperties,
        internalTokenAuthenticationFilter: InternalTokenAuthenticationFilter,
        jwtDecoder: JwtDecoder,
        jwtAuthenticationConverter: Converter<Jwt, AbstractAuthenticationToken>,
    ): SecurityFilterChain {
        http.csrf { it.disable() }
        http.cors(Customizer.withDefaults())
        http.sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }

        http.authorizeHttpRequests { requests ->
            requests
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                .requestMatchers(
                    "/api/auth/login",
                    "/actuator/health",
                    "/actuator/info",
                    "/swagger-ui.html",
                    "/swagger-ui/**",
                    "/v3/api-docs/**",
                ).permitAll()

            if (properties.enabled) {
                requests.anyRequest().authenticated()
            } else {
                requests.anyRequest().permitAll()
            }
        }

        if (properties.enabled) {
            http.addFilterBefore(
                internalTokenAuthenticationFilter,
                BearerTokenAuthenticationFilter::class.java,
            )
            http.oauth2ResourceServer { oauth2 ->
                oauth2.jwt { jwt ->
                    jwt.decoder(jwtDecoder)
                    jwt.jwtAuthenticationConverter(jwtAuthenticationConverter)
                }
            }
        }

        return http.build()
    }

    @Bean
    fun medolCorsConfigurationSource(properties: MedolSecurityProperties): CorsConfigurationSource {
        val configuration = CorsConfiguration()
        configuration.allowedOriginPatterns = properties.allowedOrigins
        configuration.allowedMethods = listOf("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
        configuration.allowedHeaders = listOf("*")
        configuration.exposedHeaders = listOf("Authorization", "Location")
        configuration.allowCredentials = true

        return UrlBasedCorsConfigurationSource().also {
            it.registerCorsConfiguration("/**", configuration)
        }
    }

    private fun secretKey(properties: MedolSecurityProperties): SecretKeySpec =
        SecretKeySpec(
            properties.jwtSecret.toByteArray(StandardCharsets.UTF_8),
            "HmacSHA256",
        )

    private fun Jwt.toCurrentUser(): CurrentUser {
        val id = runCatching { UUID.fromString(subject) }
            .getOrElse { UUID.nameUUIDFromBytes(subject.toByteArray(StandardCharsets.UTF_8)) }
        val organizationId = getClaimAsString("organizationId")
            ?.let { runCatching { UUID.fromString(it) }.getOrNull() }

        return CurrentUser(
            id = id,
            username = getClaimAsString("username") ?: getClaimAsString("email") ?: subject,
            organizationId = organizationId,
            roles = stringClaimSet("roles"),
            permissions = stringClaimSet("permissions"),
        )
    }

    private fun Jwt.stringClaimSet(name: String): Set<String> {
        val claim = claims[name] ?: return emptySet()
        return when (claim) {
            is String -> claim.split(',').map { it.trim() }.filter { it.isNotBlank() }.toSet()
            is Collection<*> -> claim.mapNotNull { it?.toString()?.trim() }.filter { it.isNotBlank() }.toSet()
            else -> emptySet()
        }
    }
}
