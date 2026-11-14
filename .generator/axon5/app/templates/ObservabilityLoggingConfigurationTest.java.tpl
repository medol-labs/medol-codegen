package <%= rootPackage %>.shared.application.logging;

import com.sun.net.httpserver.HttpServer;
import io.micrometer.core.instrument.MeterRegistry;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.actuate.autoconfigure.logging.OpenTelemetryLoggingAutoConfiguration;
import org.springframework.boot.actuate.autoconfigure.logging.otlp.OtlpLoggingAutoConfiguration;
import org.springframework.boot.actuate.autoconfigure.metrics.MetricsAutoConfiguration;
import org.springframework.boot.actuate.autoconfigure.metrics.export.otlp.OtlpMetricsExportAutoConfiguration;
import org.springframework.boot.actuate.autoconfigure.opentelemetry.OpenTelemetryAutoConfiguration;
import org.springframework.boot.actuate.autoconfigure.tracing.OpenTelemetryTracingAutoConfiguration;
import org.springframework.boot.actuate.autoconfigure.tracing.otlp.OtlpTracingAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.PropertiesPropertySource;
import org.springframework.core.io.ClassPathResource;

import java.net.InetSocketAddress;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

class ObservabilityLoggingConfigurationTest {
    private ApplicationContextRunner runner(boolean enabled, String endpoint) {
        return new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(
                OpenTelemetryAutoConfiguration.class, OpenTelemetryLoggingAutoConfiguration.class,
                OtlpLoggingAutoConfiguration.class, OpenTelemetryTracingAutoConfiguration.class,
                OtlpTracingAutoConfiguration.class, MetricsAutoConfiguration.class, OtlpMetricsExportAutoConfiguration.class))
            .withUserConfiguration(ObservabilityLoggingConfiguration.class)
            .withInitializer(context -> {
                var yaml = new YamlPropertiesFactoryBean();
                yaml.setResources(new ClassPathResource("observability-test.yml"));
                context.getEnvironment().getPropertySources().addLast(new PropertiesPropertySource("observability", yaml.getObject()));
            })
            .withPropertyValues("spring.application.name=observability-test", "MEDOL_OBSERVABILITY_ENABLED=" + enabled,
                "OTEL_SERVICE_INSTANCE_ID=test-instance", "OTEL_EXPORTER_OTLP_ENDPOINT=" + endpoint,
                "MEDOL_TRACING_SAMPLE_PROBABILITY=1.0", "MEDOL_METRICS_EXPORT_STEP=1s");
    }

    @Test
    void exportsAllSignalsToOtlpAndDetachesAppender() throws Exception {
        Set<String> requests = ConcurrentHashMap.newKeySet();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/", exchange -> {
            if (exchange.getRequestBody().readAllBytes().length > 0) requests.add(exchange.getRequestURI().getPath());
            exchange.getResponseHeaders().set("Content-Type", "application/x-protobuf");
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        try {
            runner(true, "http://127.0.0.1:" + server.getAddress().getPort()).run(context -> {
                assertThat(context).hasNotFailed();
                var sdk = context.getBean(OpenTelemetrySdk.class);
                assertThat(context.getBean(io.micrometer.registry.otlp.OtlpConfig.class).resourceAttributes())
                    .containsEntry("service.instance.id", "test-instance");
                assertThat(context.getBean(org.springframework.boot.actuate.autoconfigure.opentelemetry.OpenTelemetryProperties.class)
                    .getResourceAttributes()).containsEntry("service.instance.id", "test-instance");
                sdk.getTracer("test").spanBuilder("smoke").startSpan().end();
                LoggerFactory.getLogger("observability-test").info("Telemetry smoke test");
                context.getBean(MeterRegistry.class).counter("medol.smoke").increment();
                sdk.getSdkTracerProvider().forceFlush().join(5, TimeUnit.SECONDS);
                sdk.getSdkLoggerProvider().forceFlush().join(5, TimeUnit.SECONDS);
                await().atMost(10, TimeUnit.SECONDS).untilAsserted(() ->
                    assertThat(requests).contains("/v1/logs", "/v1/traces", "/v1/metrics"));
            });
            var root = (ch.qos.logback.classic.Logger) LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
            assertThat(root.getAppender("MEDOL_OTLP")).isNull();
        } finally {
            server.stop(0);
        }
    }

    @Test
    void disabledModeDoesNotCreateExportersOrAttachAppender() {
        runner(false, "http://127.0.0.1:1").run(context -> {
            assertThat(context).hasNotFailed().doesNotHaveBean(ObservabilityLoggingConfiguration.class);
            assertThat(context.getBeansOfType(io.opentelemetry.sdk.logs.export.LogRecordExporter.class)).isEmpty();
            assertThat(context.getBeansOfType(io.opentelemetry.sdk.trace.export.SpanExporter.class)).isEmpty();
            assertThat(context.getBeansOfType(io.micrometer.registry.otlp.OtlpMeterRegistry.class)).isEmpty();
        });
    }

    @Test
    void unavailableCollectorDoesNotPreventStartupOrLogging() {
        runner(true, "http://127.0.0.1:1").run(context -> {
            assertThat(context).hasNotFailed();
            LoggerFactory.getLogger("observability-test").info("Collector is unavailable; application remains usable");
        });
    }
}
