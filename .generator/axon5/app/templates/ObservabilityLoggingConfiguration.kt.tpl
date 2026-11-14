package <%= rootPackage %>.shared.application.logging

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.LoggerContext
import io.opentelemetry.api.OpenTelemetry
import io.opentelemetry.instrumentation.logback.appender.v1_0.OpenTelemetryAppender
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.DisposableBean
import org.springframework.beans.factory.InitializingBean
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.stereotype.Component

@Component
@ConditionalOnProperty(name = ["medol.observability.enabled"], havingValue = "true")
class ObservabilityLoggingConfiguration(
    private val openTelemetry: OpenTelemetry,
) : InitializingBean, DisposableBean {
    private var appender: OpenTelemetryAppender? = null

    override fun afterPropertiesSet() {
        val context = LoggerFactory.getILoggerFactory() as? LoggerContext ?: return
        val created = OpenTelemetryAppender()
        created.context = context
        created.name = "MEDOL_OTLP"
        created.setCaptureMdcAttributes("traceId,spanId,correlationId,causationId")
        created.start()
        context.getLogger(Logger.ROOT_LOGGER_NAME).addAppender(created)
        OpenTelemetryAppender.install(openTelemetry)
        appender = created
    }

    override fun destroy() {
        val context = LoggerFactory.getILoggerFactory() as? LoggerContext
        appender?.let {
            context?.getLogger(Logger.ROOT_LOGGER_NAME)?.detachAppender(it)
            it.stop()
        }
    }
}
