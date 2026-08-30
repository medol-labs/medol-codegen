package <%= rootPackage %>.iam.infrastructure.security

import java.util.concurrent.CompletableFuture
import org.axonframework.messaging.core.Metadata
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.springframework.stereotype.Component
import <%= rootPackage %>.identityaccessmanagement.grantpermissiontorole.GrantPermissionToRoleCommand
import <%= rootPackage %>.identityaccessmanagement.registerpermission.RegisterPermissionCommand
import <%= rootPackage %>.identityaccessmanagement.registerrole.RegisterRoleCommand

@Component
class IamAuthorizationBootstrap(
    private val commandGateway: CommandGateway,
) {
    fun initialize(metadata: Metadata): CompletableFuture<Unit> {
        val commands = buildList {
            permissions.forEach { permission ->
                add(
                    RegisterPermissionCommand(
                        permissionCode = permission.code,
                        permissionName = permission.name,
                        description = permission.description,
                    ),
                )
            }
            roles.forEach { role ->
                add(
                    RegisterRoleCommand(
                        roleCode = role.code,
                        roleName = role.name,
                    ),
                )
            }
            grants.forEach { grant ->
                add(
                    GrantPermissionToRoleCommand(
                        roleCode = grant.roleCode,
                        permissionCode = grant.permissionCode,
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

    private data class SeedPermission(
        val code: String,
        val name: String,
        val description: String?,
    )

    private data class SeedRole(
        val code: String,
        val name: String,
    )

    private data class SeedGrant(
        val roleCode: String,
        val permissionCode: String,
    )

    companion object {
        private val permissions = listOf(
<% security.permissions.forEach((permission, index) => { -%>
            SeedPermission("<%- permission.code.replace(/\\/g, '\\\\').replace(/"/g, '\\"') %>", "<%- permission.description.replace(/\\/g, '\\\\').replace(/"/g, '\\"') %>", "<%- permission.description.replace(/\\/g, '\\\\').replace(/"/g, '\\"') %>")<%= index + 1 === security.permissions.length ? '' : ',' %>
<% }) -%>
        )

        private val roles = listOf(
            SeedRole("ADMIN", "Administrator")<%= security.actors.length > 0 ? ',' : '' %>
<% security.actors.forEach((actor, index) => { -%>
            SeedRole("<%- actor.roleCode.replace(/\\/g, '\\\\').replace(/"/g, '\\"') %>", "<%- actor.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"') %>")<%= index + 1 === security.actors.length ? '' : ',' %>
<% }) -%>
        )

        private val grants = listOf(
            SeedGrant("ADMIN", "*:*")<%= security.grants.length > 0 ? ',' : '' %>
<% security.grants.forEach((grant, index) => { -%>
            SeedGrant("<%- grant.roleCode.replace(/\\/g, '\\\\').replace(/"/g, '\\"') %>", "<%- grant.permissionCode.replace(/\\/g, '\\\\').replace(/"/g, '\\"') %>")<%= index + 1 === security.grants.length ? '' : ',' %>
<% }) -%>
        )
    }
}
