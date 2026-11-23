package __ROOT__.shared.application.access

import __ROOT__.shared.security.CurrentUser
import __ROOT__.shared.security.CurrentUserProvider
import org.springframework.beans.factory.ObjectProvider
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import java.util.UUID

/** Reload current permissions from trusted IAM storage, never from a persisted token/permission snapshot. */
interface BackgroundAccessActorResolver {
    fun resolve(userId: UUID): CurrentUser
}

object DataAccessActorContext {
    private val actors = ThreadLocal<CurrentUser>()
    fun current(): CurrentUser? = actors.get()
    fun <T> withActor(actor: CurrentUser, block: () -> T): T {
        val previousActor = actors.get()
        val previousSecurity = SecurityContextHolder.getContext()
        val security = SecurityContextHolder.createEmptyContext()
        security.authentication = UsernamePasswordAuthenticationToken(actor, null,
            actor.permissions.map(::SimpleGrantedAuthority) + actor.roles.map { SimpleGrantedAuthority("ROLE_$it") })
        actors.set(actor)
        SecurityContextHolder.setContext(security)
        return try { block() } finally {
            if (previousActor == null) actors.remove() else actors.set(previousActor)
            SecurityContextHolder.setContext(previousSecurity)
        }
    }
}

class BackgroundDataAccess(
    private val users: CurrentUserProvider,
    private val resolvers: ObjectProvider<BackgroundAccessActorResolver>
) {
    private fun resolver(): BackgroundAccessActorResolver {
        val matches = resolvers.orderedStream().toList()
        if (matches.size != 1) throw AccessDeniedException("Protected background exports require exactly one BackgroundAccessActorResolver. Configure an IAM adapter before scheduling exports.")
        return matches.single()
    }
    fun requestActor(): String {
        val actor = DataAccessActorContext.current() ?: users.currentUser()
        if (actor.id == UUID(0, 0)) throw AccessDeniedException("An authenticated export owner is required.")
        return actor.id.toString()
    }
    fun prepare(): String {
        resolver() // Reject before enqueueing if identity cannot be restored on this deployment.
        return requestActor()
    }
    fun <T> run(subject: String?, requiredPermissions: Set<String>, block: () -> T): T {
        val id = try { UUID.fromString(subject) } catch (_: Exception) { throw AccessDeniedException("Export owner is missing or invalid.") }
        val actor = resolver().resolve(id)
        if (actor.id != id || actor.id == UUID(0, 0)) throw AccessDeniedException("Export identity does not match its owner.")
        if (requiredPermissions.none { it in actor.permissions }) throw AccessDeniedException("Export permission has been revoked.")
        return DataAccessActorContext.withActor(actor, block)
    }
}
