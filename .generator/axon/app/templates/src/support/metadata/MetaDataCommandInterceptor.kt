package <%= rootPackageName%>.support.metadata

import java.util.function.BiFunction
import org.axonframework.commandhandling.CommandMessage
import org.axonframework.messaging.MessageDispatchInterceptor
import org.springframework.stereotype.Component

// @Component
class MetaDataCommandInterceptor : MessageDispatchInterceptor<CommandMessage<Any>> {
    override fun handle(
        messages: List<CommandMessage<Any>>
    ): BiFunction<Int, CommandMessage<Any>, CommandMessage<Any>> {
        return BiFunction { _, message ->
            // Check if "X-User-Id" metadata exists
            if (!message.metaData.containsKey(SESSION_ID_HEADER)) {
                throw kotlin.IllegalArgumentException("Missing required header: X-Session-Id")
            }
            message
        }
    }
}
