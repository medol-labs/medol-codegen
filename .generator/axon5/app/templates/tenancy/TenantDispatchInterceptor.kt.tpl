package <%= rootPackage %>.shared.application.tenancy

import org.axonframework.messaging.commandhandling.CommandMessage
import org.axonframework.messaging.core.MessageDispatchInterceptor
import org.axonframework.messaging.core.MessageDispatchInterceptorChain
import org.axonframework.messaging.core.MessageStream
import org.axonframework.messaging.core.unitofwork.ProcessingContext
import org.springframework.stereotype.Component
import org.springframework.security.access.AccessDeniedException
import <%= rootPackage %>.shared.application.metadata.MetadataKeys

@Component
class TenantDispatchInterceptor(private val access: SameSchemaTenantAccess) : MessageDispatchInterceptor<CommandMessage> {
    override fun interceptOnDispatch(
        message: CommandMessage, context: ProcessingContext?, chain: MessageDispatchInterceptorChain<CommandMessage>
    ): MessageStream<*> {
        val command = message.payload() as? TenantCommand
            ?: throw AccessDeniedException("Command does not declare its tenant boundary.")
        if (!command.medolTenantScoped) {
            command.medolTenantScope = null
            command.medolTenantUser = null
            return chain.proceed(message.withMetadata(message.metadata().entries.filter { it.key != MetadataKeys.TENANT_ID }.associate { it.key to it.value }), context)
        }
        val tenantId = message.metadata()[MetadataKeys.TENANT_ID] ?: TenantScope.current()?.tenantId
            ?: throw AccessDeniedException("Tenant metadata is required.")
        if (TenantScope.current()?.tenantId?.let { it != tenantId } == true) {
            throw AccessDeniedException("Command tenant does not match the verified context.")
        }
        val userId = TenantScope.current()?.userId ?: message.metadata()[MetadataKeys.USER_ID]
            ?: throw AccessDeniedException("User metadata is required.")
        val identity = access.verify(tenantId, userId)
        command.medolTenantScope = identity.tenantId
        command.medolTenantUser = identity.userId
        return chain.proceed(message.andMetadata(mapOf(MetadataKeys.TENANT_ID to identity.tenantId, MetadataKeys.USER_ID to identity.userId)), context)
    }
}
