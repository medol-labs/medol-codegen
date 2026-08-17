package <%= rootPackage %>.shared.application.axon

import org.axonframework.messaging.commandhandling.CommandMessage
import org.axonframework.messaging.core.Message
import org.axonframework.messaging.core.MessageDispatchInterceptor
import org.axonframework.messaging.core.MessageHandlerInterceptor
import org.axonframework.messaging.core.MessageHandlerInterceptorChain
import org.axonframework.messaging.core.MessageStream
import org.axonframework.messaging.core.unitofwork.ProcessingContext
import org.axonframework.messaging.eventhandling.EventMessage
import org.axonframework.messaging.queryhandling.QueryMessage
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.lang.reflect.Method
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
            val consumer = describeConsumer(chain, context)
            logHandleStart("COMMAND", message, consumer)
            observe("COMMAND", "HANDLE", message, consumer) { chain.proceed(message, context) }
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
            val consumer = describeConsumer(chain, context)
            logHandleStart("EVENT", message, consumer)
            observe("EVENT", "HANDLE", message, consumer) { chain.proceed(message, context) }
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
            val consumer = describeConsumer(chain, context)
            logHandleStart("QUERY", message, consumer)
            observe("QUERY", "HANDLE", message, consumer) { chain.proceed(message, context) }
        }

    private fun logDispatchStart(category: String, message: Message) {
        logger.info("AXON {} DISPATCH start {}", category, describe(message))
    }

    private fun logHandleStart(category: String, message: Message, consumer: String) {
        logger.info("AXON {} HANDLE start consumer={} {}", category, consumer, describe(message))
    }

    private fun observe(
        category: String,
        phase: String,
        message: Message,
        consumer: String? = null,
        proceed: () -> MessageStream<*>
    ): MessageStream<*> {
        val startedAt = Instant.now()
        return try {
            proceed()
                .onComplete {
                    logger.info(
                        "AXON {} {} complete durationMs={}{} {}",
                        category,
                        phase,
                        Duration.between(startedAt, Instant.now()).toMillis(),
                        consumer?.let { " consumer=$it" } ?: "",
                        describe(message)
                    )
                }
                .onErrorContinue { error ->
                    logger.warn(
                        "AXON {} {} failed durationMs={}{} {} error={}",
                        category,
                        phase,
                        Duration.between(startedAt, Instant.now()).toMillis(),
                        consumer?.let { " consumer=$it" } ?: "",
                        describe(message),
                        error.message,
                        error
                    )
                    MessageStream.failed(error)
                }
        } catch (error: Throwable) {
            logger.warn(
                "AXON {} {} failed durationMs={}{} {} error={}",
                category,
                phase,
                Duration.between(startedAt, Instant.now()).toMillis(),
                consumer?.let { " consumer=$it" } ?: "",
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

    private fun describeConsumer(
        chain: MessageHandlerInterceptorChain<out Message>,
        context: ProcessingContext
    ): String {
        val handler = readField(chain, "interceptingHandler")
            ?: return "unknown chain=${chain.javaClass.name}"
        return describeConsumerObject(handler, mutableSetOf())
    }

    private fun describeConsumerObject(value: Any, visited: MutableSet<Int>, depth: Int = 0): String {
        if (depth > 4 || !visited.add(System.identityHashCode(value))) {
            return compactClassName(value)
        }

        describeMessageHandlingMember(value)?.let { return it }
        if (value is Method) {
            return "${value.declaringClass.name}#${value.name}"
        }
        if (value.javaClass.name.startsWith("<%= rootPackage %>.")) {
            return value.javaClass.name
        }

        readField(value, "target")?.let { target ->
            val nested = describeConsumerObject(target, visited, depth + 1)
            return if (nested.startsWith("<%= rootPackage %>.")) nested else "${compactClassName(value)} target=$nested"
        }

        listOf("next", "messageHandlingMember", "handlingMember", "member", "delegate", "handler").forEach { fieldName ->
            readField(value, fieldName)?.let { nested ->
                return describeConsumerObject(nested, visited, depth + 1)
            }
        }

        readField(value, "name")?.let { name ->
            if (name is String && name.isNotBlank()) {
                return "${compactClassName(value)} name=$name"
            }
        }

        if (value.javaClass.isSynthetic || value.javaClass.name.contains("\$\$Lambda")) {
            value.javaClass.declaredFields
                .asSequence()
                .mapNotNull { field ->
                    runCatching {
                        field.isAccessible = true
                        field.get(value)
                    }.getOrNull()
                }
                .filterNot { it.isJdkInternalObject() }
                .map { describeConsumerObject(it, visited, depth + 1) }
                .firstOrNull { it.startsWith("<%= rootPackage %>.") || "#" in it }
                ?.let { return it }
        }

        return compactClassName(value)
    }

    private fun describeMessageHandlingMember(value: Any): String? {
        val declaringClass = invokeNoArg(value, "declaringClass") as? Class<*>
        val signature = invokeNoArg(value, "signature") as? String
        if (declaringClass != null && signature != null) {
            return "${declaringClass.name}.$signature"
        }

        val method = readField(value, "method") as? Method
        if (method != null) {
            return "${method.declaringClass.name}#${method.name}"
        }

        return null
    }

    private fun readField(target: Any, fieldName: String): Any? {
        var current: Class<*>? = target.javaClass
        while (current != null) {
            val field = runCatching { current.getDeclaredField(fieldName) }.getOrNull()
            if (field != null) {
                return runCatching {
                    field.isAccessible = true
                    field.get(target)
                }.getOrNull()
            }
            current = current.superclass
        }
        return null
    }

    private fun invokeNoArg(target: Any, methodName: String): Any? =
        runCatching {
            val method = target.javaClass.getMethod(methodName)
            method.isAccessible = true
            method.invoke(target)
        }.getOrNull()

    private fun Any.isJdkInternalObject(): Boolean {
        val name = javaClass.name
        return name.startsWith("java.") ||
            name.startsWith("javax.") ||
            name.startsWith("kotlin.") ||
            name.startsWith("sun.") ||
            name.startsWith("jdk.")
    }

    private fun compactClassName(value: Any): String {
        val name = value.javaClass.name.substringBefore("/")
        return if (name.contains("\$\$Lambda")) {
            name.substringBefore("\$\$Lambda") + "\$\$Lambda"
        } else {
            name
        }
    }
}
