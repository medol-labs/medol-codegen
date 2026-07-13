package <%= rootPackage %>.support

import org.axonframework.common.configuration.ComponentBuilder
import org.axonframework.common.configuration.ComponentRegistry
import org.axonframework.common.configuration.ConfigurationEnhancer
import org.axonframework.common.configuration.SearchScope
import org.axonframework.eventsourcing.eventstore.EventStorageEngine
import org.axonframework.eventsourcing.eventstore.inmemory.InMemoryEventStorageEngine
import org.springframework.core.env.Environment
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import tech.medo.axon.umadb.UmaDbEventStorageEngine
import tech.medo.axon.umadb.UmaDbEventStorageProperties
import java.time.Duration

@Configuration
@ConditionalOnProperty(prefix = "medol.axon", name = ["event-storage"], havingValue = "inmemory")
class InMemoryAxonEventStorageConfig {

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

@Configuration
@ConditionalOnProperty(prefix = "medol.axon", name = ["event-storage"], havingValue = "umadb")
class UmaDbAxonEventStorageConfig(private val environment: Environment) {

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
            environment.getRequiredProperty("medol.axon.umadb.endpoint"),
            environment.getRequiredProperty("medol.axon.umadb.database"),
            environment.getProperty("medol.axon.umadb.event-collection", "events"),
            environment.getProperty("medol.axon.umadb.tag-collection", "event_tags"),
            environment.getProperty("medol.axon.umadb.token-collection", "tracking_tokens"),
            environment.getProperty("medol.axon.umadb.append-path", "/api/v1/events/append"),
            environment.getProperty("medol.axon.umadb.token", ""),
            Duration.parse(environment.getProperty("medol.axon.umadb.request-timeout", "PT10S"))
        )
}
