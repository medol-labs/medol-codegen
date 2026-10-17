package <%= rootPackage %>.shared.application.tenancy

import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.springframework.security.access.AccessDeniedException
import org.springframework.stereotype.Component
import <%= rootPackage %>.shared.security.MedolSecurityProperties

@Component
class TenantRelay(private val properties: MedolSecurityProperties) {
    fun issue(identity: TenantIdentity): String {
        val payload = listOf(identity.tenantId, identity.userId, (Instant.now().epochSecond + 60).toString()).joinToString("\n")
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(payload.toByteArray(UTF_8))
        return encoded + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(sign(encoded))
    }

    fun verify(value: String): TenantIdentity {
        try {
            val parts = value.split('.')
            if (parts.size != 2 || !MessageDigest.isEqual(sign(parts[0]), Base64.getUrlDecoder().decode(parts[1]))) denied()
            val fields = String(Base64.getUrlDecoder().decode(parts[0]), UTF_8).split('\n')
            if (fields.size != 3) denied()
            val remaining = fields[2].toLong() - Instant.now().epochSecond
            if (remaining !in 0..90) denied()
            return TenantIdentity(fields[0], fields[1])
        } catch (_: IllegalArgumentException) { denied() }
    }

    private fun sign(value: String): ByteArray {
        val secret = properties.internalToken
        check(secret.length >= 32 && secret != "local-dev-internal-token") {
            "Tenant relay requires a shared medol.security.internal-token of at least 32 characters."
        }
        return Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(secret.toByteArray(UTF_8), "HmacSHA256"))
            doFinal(value.toByteArray(UTF_8))
        }
    }

    private fun denied(): Nothing = throw AccessDeniedException("Invalid tenant relay context.")

    companion object { const val HEADER = "X-MEDOL-TENANT-CONTEXT" }
}
