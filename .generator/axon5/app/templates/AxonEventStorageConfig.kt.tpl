package <%= rootPackage %>.support

import org.axonframework.common.configuration.ComponentBuilder
import org.axonframework.common.configuration.ComponentRegistry
import org.axonframework.common.configuration.ConfigurationEnhancer
import org.axonframework.common.configuration.SearchScope
import org.axonframework.eventsourcing.eventstore.EventStorageEngine
import org.axonframework.eventsourcing.eventstore.inmemory.InMemoryEventStorageEngine
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration
class AxonEventStorageConfig {

    @Bean
    fun dcbEventStorageEngineConfigurationEnhancer(): ConfigurationEnhancer =
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
