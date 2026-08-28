package <%= rootPackage %>.shared.security

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties(prefix = "medol.security")
data class MedolSecurityProperties(
    var enabled: Boolean = true,
    var provider: String = "local",
    var jwtSecret: String = "change-me-change-me-change-me-change-me",
    var localTokenTtlSeconds: Long = 28_800,
    var allowedOrigins: List<String> = listOf("http://localhost:5173", "http://127.0.0.1:5173"),
    var internalToken: String = "local-dev-internal-token",
    var internalSubject: String = "00000000-0000-0000-0000-000000000001",
    var internalUsername: String = "internal-service",
    var internalRoles: List<String> = listOf("SERVICE"),
    var internalPermissions: List<String> = listOf("*:*"),
    var supabase: Supabase = Supabase(),
) {
    data class Supabase(
        var issuerUri: String = "",
        var jwkSetUri: String = "",
    )
}
