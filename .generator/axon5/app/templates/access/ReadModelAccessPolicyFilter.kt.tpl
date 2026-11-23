package __ROOT__.shared.application.access

import __ROOT__.shared.security.CurrentUser
import __ROOT__.shared.security.CurrentUserProvider
import org.springframework.beans.factory.ObjectProvider
import org.springframework.data.jpa.domain.Specification
import org.springframework.security.access.AccessDeniedException
import java.util.UUID

data class ReadModelAccessRule(
    val name: String, val field: String, val source: String,
    val subjectField: String? = null, val subjectSource: String? = null
)
data class ReadModelAccessPolicy(
    val name: String?, val fields: List<String> = emptyList(),
    val rules: List<ReadModelAccessRule> = emptyList()
)

sealed interface AuthorizationScope {
    data object All : AuthorizationScope
    data object None : AuthorizationScope
    data class Values(val values: Set<Any>) : AuthorizationScope
}

/** Resolve one rule for the trusted actor. Never accept scopes from request parameters. */
interface AuthorizationScopeResolver {
    fun resolve(actor: CurrentUser, context: String, readModel: String, policy: String, rule: ReadModelAccessRule): AuthorizationScope
}

/** Override for IAM department attributes or a remote IAM. Unknown attributes must fail closed. */
interface IdentityAccessAttributes {
    fun values(actor: CurrentUser, attribute: String): Set<Any>
}
class CurrentUserAccessAttributes : IdentityAccessAttributes {
    override fun values(actor: CurrentUser, attribute: String): Set<Any> = when (attribute) {
        "userId" -> setOf(actor.id)
        "organizationId" -> actor.organizationId?.let { setOf(it) } ?: emptySet()
        else -> throw AccessDeniedException("No IAM access attribute adapter for $attribute.")
    }
}

/** Internal, generated relation lookup. Not an HTTP API; bypasses readmodel ACL recursion. */
interface BusinessAccessScopeSource {
    fun supports(rule: ReadModelAccessRule): Boolean
    fun values(actor: CurrentUser, rule: ReadModelAccessRule): Set<Any>
}

class DefaultAuthorizationScopeResolver(
    private val attributes: IdentityAccessAttributes,
    private val sources: ObjectProvider<BusinessAccessScopeSource>
) : AuthorizationScopeResolver {
    override fun resolve(actor: CurrentUser, context: String, readModel: String, policy: String, rule: ReadModelAccessRule): AuthorizationScope {
        // Explicit grants are per policy rule. A grant for one dimension cannot erase another.
        val permission = "data:$policy:${rule.name}".lowercase(java.util.Locale.ROOT)
        if ("$permission:all" in actor.permissions) return AuthorizationScope.All
        if ("$permission:scope" !in actor.permissions) return AuthorizationScope.None
        val values = if (rule.source.startsWith("identity.")) {
            attributes.values(actor, rule.source.removePrefix("identity."))
        } else {
            val providers = sources.orderedStream().filter { it.supports(rule) }.toList()
            if (providers.size != 1) throw AccessDeniedException("Exactly one business scope source is required for ${rule.source}.")
            providers.single().values(actor, rule)
        }
        if (values.size > AccessScopeValues.MAX_VALUES) throw AccessDeniedException("Authorized scope exceeds the supported value limit.")
        return if (values.isEmpty()) AuthorizationScope.None else AuthorizationScope.Values(values.toSet())
    }
}

object AccessScopeValues {
    const val MAX_VALUES = 1000
    fun convert(value: Any, type: Class<*>): Any = try {
        when {
            type.isInstance(value) -> value
            type == UUID::class.java -> UUID.fromString(value.toString())
            type == String::class.java -> value.toString()
            type == Int::class.javaObjectType || type == Int::class.javaPrimitiveType -> value.toString().toInt()
            type == Long::class.javaObjectType || type == Long::class.javaPrimitiveType -> value.toString().toLong()
            type == Boolean::class.javaObjectType || type == Boolean::class.javaPrimitiveType -> value.toString().toBooleanStrict()
            type.isEnum -> type.enumConstants.firstOrNull { (it as Enum<*>).name == value.toString() }
                ?: throw IllegalArgumentException("Unknown enum value")
            else -> throw IllegalArgumentException("Unsupported scope type")
        }
    } catch (failure: IllegalArgumentException) {
        throw AccessDeniedException("Access scope value does not match the modeled field type.", failure)
    }
}

interface ReadModelAccessPolicyFilter {
    fun <T> specification(contextName: String, readModelName: String, policy: ReadModelAccessPolicy): Specification<T>
    /** Historical outbox payloads cannot safely use the current-row filter (including deletes). */
    fun requireUnrestricted(contextName: String, readModelName: String, policy: ReadModelAccessPolicy) {
        if (policy.fields.isNotEmpty() || policy.rules.isNotEmpty()) throw AccessDeniedException("Incremental sync requires explicit unrestricted data access.")
    }
}

class ScopedReadModelAccessPolicyFilter(
    private val users: CurrentUserProvider,
    private val resolver: AuthorizationScopeResolver
) : ReadModelAccessPolicyFilter {
    override fun requireUnrestricted(contextName: String, readModelName: String, policy: ReadModelAccessPolicy) {
        if (policy.fields.isNotEmpty()) throw AccessDeniedException("Legacy access policy requires migration.")
        if (policy.rules.isEmpty()) return
        val actor = DataAccessActorContext.current() ?: users.currentUser()
        if (actor.id == UUID(0, 0)) throw AccessDeniedException("An authenticated sync actor is required.")
        val name = policy.name ?: throw AccessDeniedException("An access policy name is required.")
        if (policy.rules.any { resolver.resolve(actor, contextName, readModelName, name, it) != AuthorizationScope.All }) {
            throw AccessDeniedException("Incremental sync requires explicit unrestricted access for every data scope dimension.")
        }
    }
    override fun <T> specification(contextName: String, readModelName: String, policy: ReadModelAccessPolicy): Specification<T> {
        if (policy.fields.isNotEmpty()) throw AccessDeniedException("Legacy field-only access policies require migration or a custom access filter.")
        if (policy.rules.isEmpty()) return Specification.where(null)
        val actor = DataAccessActorContext.current() ?: users.currentUser()
        if (actor.id == UUID(0, 0)) throw AccessDeniedException("An authenticated actor is required for data access.")
        val name = policy.name ?: throw AccessDeniedException("An access policy name is required.")
        // Resolve before building predicates, so JPA count/select reuse exactly the same values.
        val scopes = policy.rules.map { rule -> rule to resolver.resolve(actor, contextName, readModelName, name, rule) }
        return Specification { root, _, builder ->
            val predicates = scopes.map { (rule, scope) ->
                when (scope) {
                    AuthorizationScope.All -> builder.conjunction()
                    AuthorizationScope.None -> builder.disjunction()
                    is AuthorizationScope.Values -> {
                        if (scope.values.size > AccessScopeValues.MAX_VALUES) throw AccessDeniedException("Authorized scope exceeds the supported value limit.")
                        if (scope.values.isEmpty()) builder.disjunction()
                        else {
                            val field = root.get<Any>(rule.field)
                            field.`in`(scope.values.map { AccessScopeValues.convert(it, field.javaType) })
                        }
                    }
                }
            }
            builder.and(*predicates.toTypedArray())
        }
    }
}

/** Compatibility for handwritten code: permits only genuinely empty policies. */
class PermitAllReadModelAccessPolicyFilter : ReadModelAccessPolicyFilter {
    override fun <T> specification(contextName: String, readModelName: String, policy: ReadModelAccessPolicy): Specification<T> {
        if (policy.fields.isNotEmpty() || policy.rules.isNotEmpty()) throw AccessDeniedException("A data access scope resolver is required.")
        return Specification.where(null)
    }
}
