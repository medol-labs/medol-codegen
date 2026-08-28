package <%= rootPackage %>.shared.security

import java.util.UUID

data class CurrentUser(
    val id: UUID,
    val username: String,
    val organizationId: UUID?,
    val roles: Set<String>,
    val permissions: Set<String>,
) {
    fun hasPermission(permission: String): Boolean = permission in permissions

    companion object {
        fun anonymous(): CurrentUser =
            CurrentUser(
                id = UUID.fromString("00000000-0000-0000-0000-000000000000"),
                username = "anonymous",
                organizationId = null,
                roles = emptySet(),
                permissions = emptySet(),
            )
    }
}
