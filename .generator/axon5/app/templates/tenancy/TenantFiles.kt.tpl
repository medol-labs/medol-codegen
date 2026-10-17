package <%= rootPackage %>.shared.application.tenancy

import java.nio.file.Path
import java.nio.file.Files
import java.security.MessageDigest
import org.springframework.security.access.AccessDeniedException

object TenantFiles {
    fun directory(root: String): Path {
        val key = MessageDigest.getInstance("SHA-256").digest(TenantScope.requireTenant().toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return Path.of(root, key).toAbsolutePath().normalize()
    }

    fun owned(filePath: String, root: String): Path {
        val expected = directory(root)
        val path = Path.of(filePath).toAbsolutePath().normalize()
        if (!path.startsWith(expected)) throw AccessDeniedException("File belongs to a different tenant.")
        if (!Files.exists(path)) return path
        val real = path.toRealPath()
        if (!real.startsWith(expected.toRealPath())) throw AccessDeniedException("File belongs to a different tenant.")
        return real
    }
}
