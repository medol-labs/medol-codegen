package <%= rootPackage %>.shared.security

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties(prefix = "medol.security")
data class MedolSecurityProperties(
    var enabled: Boolean = true,
    var provider: String = "local",
    var jwtSecret: String = "change-me-change-me-change-me-change-me",
    var localTokenTtlSeconds: Long = 28_800,
    var allowedOrigins: List<String> = listOf("http://localhost:*", "http://127.0.0.1:*"),
    var internalToken: String = "local-dev-internal-token",
    var internalSubject: String = "00000000-0000-0000-0000-000000000001",
    var internalUsername: String = "internal-service",
    var internalRoles: List<String> = listOf("SERVICE"),
    var internalPermissions: List<String> = listOf("*:*"),
    var adminBootstrap: AdminBootstrap = AdminBootstrap(),
    var supabase: Supabase = Supabase(),
    var portalSso: PortalSso = PortalSso(),
) {
    data class AdminBootstrap(
        var enabled: Boolean = false,
        var setupToken: String = "",
    )

    data class Supabase(
        var issuerUri: String = "",
        var jwkSetUri: String = "",
    )

    data class PortalSso(
        var enabled: Boolean = false,
        var jwtSecret: String = "",
        var issuer: String = "",
        var audience: String = "",
        var defaultRedirectPath: String = "/",
        var userSource: String = "PORTAL_SSO",
    )
}
