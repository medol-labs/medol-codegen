package <%= rootPackage %>.iam.infrastructure.security

import com.fasterxml.jackson.databind.ObjectMapper
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.CompletableFuture
import org.axonframework.messaging.core.Metadata
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.springframework.beans.factory.annotation.Value
import org.springframework.core.io.Resource
import org.springframework.stereotype.Component
import <%= rootPackage %>.identityaccessmanagement.grantpermissiontorole.GrantPermissionToRoleCommand
import <%= rootPackage %>.identityaccessmanagement.registerpermission.RegisterPermissionCommand
import <%= rootPackage %>.identityaccessmanagement.registerrole.RegisterRoleCommand

@Component
class IamAuthorizationBootstrap(
    private val commandGateway: CommandGateway,
    private val objectMapper: ObjectMapper,
    @Value("\${medol.security.authorization-bootstrap.seed:classpath:iam/bootstrap/authorization-seed.json}")
    private val seedResource: Resource,
) {
    fun initialize(metadata: Metadata): CompletableFuture<Unit> {
        val seed = loadSeed()
        val commands = buildList {
            seed.permissions.forEach { permission ->
                add(
                    RegisterPermissionCommand(
                        permissionId = permissionIdFor(permission.code),
                        permissionCode = permission.code,
                        permissionName = permission.name,
                        description = permission.description,
                    ),
                )
            }
            seed.roles.forEach { role ->
                add(
                    RegisterRoleCommand(
                        roleId = roleIdFor(role.code),
                        roleCode = role.code,
                        roleName = role.name,
                    ),
                )
            }
            (listOf(SeedGrant("ADMIN", "*:*")) + seed.grants).forEach { grant ->
                add(
                    GrantPermissionToRoleCommand(
                        roleId = roleIdFor(grant.roleCode),
                        roleCode = grant.roleCode,
                        permissionCodes = listOf(grant.permissionCode),
                    ),
                )
            }
        }

        return commands.fold(CompletableFuture.completedFuture(Unit)) { future, command ->
            future.thenCompose {
                commandGateway.send(command, metadata).resultMessage.thenApply { Unit }
            }
        }
    }

    private fun loadSeed(): AuthorizationSeed =
        seedResource.inputStream.use { input ->
            objectMapper.readValue(input, AuthorizationSeed::class.java)
        }

    data class AuthorizationSeed(
        val actors: List<SeedActor> = emptyList(),
        val permissions: List<SeedPermission> = emptyList(),
        val grants: List<SeedGrant> = emptyList(),
    ) {
        val roles: List<SeedRole> =
            listOf(SeedRole("ADMIN", "Administrator")) +
                actors.map { SeedRole(it.roleCode, it.title) }
    }

    data class SeedActor(
        val name: String,
        val title: String,
        val roleCode: String,
    )

    data class SeedPermission(
        val code: String,
        val name: String,
        val description: String?,
    )

    data class SeedRole(
        val code: String,
        val name: String,
    )

    data class SeedGrant(
        val roleCode: String,
        val permissionCode: String,
    )

    private fun roleIdFor(roleCode: String): UUID =
        UUID.nameUUIDFromBytes("iam-role:${roleCode.lowercase()}".toByteArray(StandardCharsets.UTF_8))

    private fun permissionIdFor(permissionCode: String): UUID =
        UUID.nameUUIDFromBytes("iam-permission:${permissionCode.lowercase()}".toByteArray(StandardCharsets.UTF_8))
}
