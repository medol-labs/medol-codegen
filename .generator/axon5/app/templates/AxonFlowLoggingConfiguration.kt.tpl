package <%= rootPackage %>.shared.application.axon

import org.axonframework.messaging.commandhandling.CommandMessage
import org.axonframework.messaging.core.Message
import org.axonframework.messaging.core.MessageDispatchInterceptor
import org.axonframework.messaging.core.MessageHandlerInterceptor
import org.axonframework.messaging.core.MessageStream
import org.axonframework.messaging.eventhandling.EventMessage
import org.axonframework.messaging.queryhandling.QueryMessage
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.time.Duration
import java.time.Instant

@Configuration
@ConditionalOnProperty(prefix = "medol.axon.flow-logging", name = ["enabled"], havingValue = "true", matchIfMissing = true)
class AxonFlowLoggingConfiguration {
    private val logger = LoggerFactory.getLogger("<%= rootPackage %>.shared.application.axon")

    @Bean
    fun axonCommandDispatchLogger(): MessageDispatchInterceptor<CommandMessage> =
        MessageDispatchInterceptor { message, context, chain ->
            logDispatchStart("COMMAND", message)
            observe("COMMAND", "DISPATCH", message) { chain.proceed(message, context) }
        }

    @Bean
    fun axonCommandHandlerLogger(): MessageHandlerInterceptor<CommandMessage> =
        MessageHandlerInterceptor { message, context, chain ->
            logHandleStart("COMMAND", message)
            observe("COMMAND", "HANDLE", message) { chain.proceed(message, context) }
        }

    @Bean
    fun axonEventDispatchLogger(): MessageDispatchInterceptor<EventMessage> =
        MessageDispatchInterceptor { message, context, chain ->
            logDispatchStart("EVENT", message)
            observe("EVENT", "DISPATCH", message) { chain.proceed(message, context) }
        }

    @Bean
    fun axonEventHandlerLogger(): MessageHandlerInterceptor<EventMessage> =
        MessageHandlerInterceptor { message, context, chain ->
            logHandleStart("EVENT", message)
            observe("EVENT", "HANDLE", message) { chain.proceed(message, context) }
        }

    @Bean
    fun axonQueryDispatchLogger(): MessageDispatchInterceptor<QueryMessage> =
        MessageDispatchInterceptor { message, context, chain ->
            logDispatchStart("QUERY", message)
            observe("QUERY", "DISPATCH", message) { chain.proceed(message, context) }
        }

    @Bean
    fun axonQueryHandlerLogger(): MessageHandlerInterceptor<QueryMessage> =
        MessageHandlerInterceptor { message, context, chain ->
            logHandleStart("QUERY", message)
            observe("QUERY", "HANDLE", message) { chain.proceed(message, context) }
        }

    private fun logDispatchStart(category: String, message: Message) {
        logger.info("AXON {} DISPATCH start {}", category, describe(message))
    }

    private fun logHandleStart(category: String, message: Message) {
        logger.info("AXON {} HANDLE start {}", category, describe(message))
    }

    private fun observe(category: String, phase: String, message: Message, proceed: () -> MessageStream<*>): MessageStream<*> {
        val startedAt = Instant.now()
        return try {
            proceed()
                .onComplete {
                    logger.info(
                        "AXON {} {} complete durationMs={} {}",
                        category,
                        phase,
                        Duration.between(startedAt, Instant.now()).toMillis(),
                        describe(message)
                    )
                }
                .onErrorContinue { error ->
                    logger.warn(
                        "AXON {} {} failed durationMs={} {} error={}",
                        category,
                        phase,
                        Duration.between(startedAt, Instant.now()).toMillis(),
                        describe(message),
                        error.message,
                        error
                    )
                    MessageStream.failed(error)
                }
        } catch (error: Throwable) {
            logger.warn(
                "AXON {} {} failed durationMs={} {} error={}",
                category,
                phase,
                Duration.between(startedAt, Instant.now()).toMillis(),
                describe(message),
                error.message,
                error
            )
            throw error
        }
    }

    private fun describe(message: Message): String {
        val payload = runCatching { message.payload() }.getOrNull()
        val payloadText = payload?.toString()?.replace(Regex("\\s+"), " ")?.take(600)
        return "messageId=${message.identifier()} type=${message.type()} payloadType=${message.payloadType().name} payload=$payloadText metadata=${message.metadata()}"
    }
}
