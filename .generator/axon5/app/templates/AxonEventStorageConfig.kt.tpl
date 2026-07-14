package <%= rootPackage %>.support

import org.axonframework.common.configuration.ComponentBuilder
import org.axonframework.common.configuration.ComponentRegistry
import org.axonframework.common.configuration.ConfigurationEnhancer
import org.axonframework.common.configuration.SearchScope
import org.axonframework.eventsourcing.eventstore.EventStorageEngine
import org.axonframework.eventsourcing.eventstore.inmemory.InMemoryEventStorageEngine
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
<% if (hasInfra) { -%>
import org.springframework.core.env.Environment
import <%= rootPackage %>.infra.umadb.UmaDbEventStorageEngine
import <%= rootPackage %>.infra.umadb.UmaDbEventStorageProperties
import java.time.Duration
<% } -%>

private const val AXON_SERVER_CONFIGURATION_ENHANCER =
    "io.axoniq.framework.axonserver.connector.configuration.AxonServerConfigurationEnhancer"

private fun disableAxonServerConfigurationEnhancer(): ConfigurationEnhancer =
    object : ConfigurationEnhancer {
        override fun order(): Int = Int.MIN_VALUE

        override fun enhance(registry: ComponentRegistry) {
            registry.disableEnhancer(AXON_SERVER_CONFIGURATION_ENHANCER)
        }
    }

@Configuration
@ConditionalOnProperty(prefix = "medol.axon", name = ["event-storage"], havingValue = "inmemory")
class InMemoryAxonEventStorageConfig {

    @Bean
    fun axonServerConfigurationEnhancerDisabler(): ConfigurationEnhancer =
        disableAxonServerConfigurationEnhancer()

    @Bean
    fun inMemoryEventStorageEngineConfigurationEnhancer(): ConfigurationEnhancer =
        object : ConfigurationEnhancer {
            override fun order(): Int = 0

            override fun enhance(registry: ComponentRegistry) {
                registry.registerIfNotPresent(
                    EventStorageEngine::class.java,
                    ComponentBuilder { InMemoryEventStorageEngine() },
                    SearchScope.ALL
                )
            }
        }
}

<% if (hasInfra) { -%>
@Configuration
@ConditionalOnProperty(prefix = "medol.axon", name = ["event-storage"], havingValue = "umadb")
class UmaDbAxonEventStorageConfig(private val environment: Environment) {

    @Bean
    fun axonServerConfigurationEnhancerDisabler(): ConfigurationEnhancer =
        disableAxonServerConfigurationEnhancer()

    @Bean
    fun umaDbEventStorageEngineConfigurationEnhancer(): ConfigurationEnhancer =
        object : ConfigurationEnhancer {
            override fun order(): Int = 0

            override fun enhance(registry: ComponentRegistry) {
                registry.registerIfNotPresent(
                    EventStorageEngine::class.java,
                    ComponentBuilder { UmaDbEventStorageEngine(umaDbProperties()) },
                    SearchScope.ALL
                )
            }
        }

    private fun umaDbProperties(): UmaDbEventStorageProperties =
        UmaDbEventStorageProperties.of(
            environment.getRequiredProperty("medol.axon.umadb.target"),
            environment.getProperty("medol.axon.umadb.plaintext", "true").toBoolean(),
            environment.getProperty("medol.axon.umadb.api-key", ""),
            environment.getProperty("medol.axon.umadb.batch-size", "256").toInt(),
            Duration.parse(environment.getProperty("medol.axon.umadb.request-timeout", "PT10S"))
        )
}
<% } -%>
