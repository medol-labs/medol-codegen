package <%= rootPackage %>.shared.application.tenancy

import <%= rootPackage %>.infra.umadb.*
import org.axonframework.eventsourcing.eventstore.EventStorageEngine
import org.axonframework.extension.spring.config.*
import org.axonframework.messaging.eventhandling.configuration.EventProcessorConfiguration
import org.axonframework.messaging.eventhandling.configuration.EventProcessorModule
import org.axonframework.messaging.eventhandling.processing.streaming.pooled.PooledStreamingEventProcessorConfiguration
import org.axonframework.messaging.eventhandling.processing.streaming.pooled.PooledStreamingEventProcessorModule
import org.springframework.beans.factory.ObjectProvider
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import java.security.MessageDigest
import java.time.Duration

class TenantEventStores(properties: TenantStorageProperties, resolver: TenantStorageResolver, environment: Environment, provisioner: TenantStorageProvisioner) : AutoCloseable {
    private val clients = mutableListOf<GrpcUmaDbClient>()
    private val pins = java.util.concurrent.ConcurrentHashMap<String, TenantStorageLocation>()
    val identities: Map<String, String>
    val defaultEngine: EventStorageEngine
    val router: RoutingUmaDbEventStorageEngine
    init {
        properties.validate()
        val defaults = UmaDbEventStorageProperties.of(
            environment.getRequiredProperty("medol.axon.umadb.target"),
            environment.getProperty("medol.axon.umadb.plaintext", "true").toBoolean(),
            environment.getProperty("medol.axon.umadb.api-key", ""),
            environment.getProperty("medol.axon.umadb.batch-size", "256").toInt(),
            Duration.parse(environment.getProperty("medol.axon.umadb.request-timeout", "PT10S"))
        )
        check(properties.eventStores.values.none { it.target == defaults.target() }) { "A tenant event store cannot alias the control endpoint." }
        val engines = linkedMapOf<String, EventStorageEngine>()
        fun engine(settings: UmaDbEventStorageProperties): EventStorageEngine {
            val client = GrpcUmaDbClient(settings); clients.add(client)
            return UmaDbEventStorageEngine(settings, client)
        }
        defaultEngine = engine(defaults)
        engines["default"] = defaultEngine
        val ids = linkedMapOf("default" to "default")
        for ((id, resource) in properties.eventStores.toSortedMap()) {
            engines[id] = engine(UmaDbEventStorageProperties.of(resource.target, resource.plaintext, resource.apiKey, defaults.batchSize(), defaults.requestTimeout()))
            ids[id] = digest(id + "\u0000" + resource.generation + "\u0000" + resource.target)
        }
        identities = ids
        router = RoutingUmaDbEventStorageEngine(engines) { tenant ->
            val location = resolver.resolve(tenant)
            if (!pins.containsKey(tenant)) provisioner.requireReady(tenant, location.schema)
            val previous = pins.putIfAbsent(tenant, location)
            check(previous == null || previous == location) { "Tenant event binding cannot change while running." }
            RoutingUmaDbEventStorageEngine.Route(location.eventStore, digest(tenant + "\u0000" + location.toString()))
        }
    }
    override fun close() { clients.forEach { it.close() } }
    companion object {
        fun digest(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}

class TenantProcessorModuleFactory(
    private val definitions: List<EventProcessorDefinition>, private val settings: EventProcessorSettings.MapWrapper,
    private val customizations: List<PooledStreamingEventProcessorModule.Customization>,
    private val properties: TenantStorageProperties, private val stores: ObjectProvider<TenantEventStores>
) : ProcessorModuleFactory {
    override fun buildProcessorModules(handlers: Set<EventProcessorDefinition.EventHandlerDescriptor>): Set<EventProcessorModule> {
        if (properties.eventStores.isEmpty()) return DefaultProcessorModuleFactory(definitions, settings.settings(), customizations).buildProcessorModules(handlers)
        val runtime = stores.getObject()
        val declared = definitions.toMutableList()
        for (handler in handlers.filter { descriptor -> definitions.none { it.matchesSelector(descriptor) } }) {
            declared.add(EventProcessorDefinition.pooledStreaming("custom-" + TenantEventStores.digest(handler.beanName()).take(32))
                .assigningHandlers { it.beanName() == handler.beanName() }.notCustomized())
        }
        return runtime.identities.flatMap { (source, identity) ->
            val names = mutableMapOf<String, String>()
            val scoped = declared.map { definition ->
                val name = if (source == "default") definition.name() else definition.name().take(100) + "-" + TenantEventStores.digest(definition.name()).take(32) + "-source-" + identity
                names[definition.name()] = name
                object : EventProcessorDefinition {
                    override fun name() = name
                    override fun mode() = definition.mode()
                    override fun matchesSelector(descriptor: EventProcessorDefinition.EventHandlerDescriptor) = definition.matchesSelector(descriptor)
                    override fun applySettings(configuration: EventProcessorConfiguration): EventProcessorConfiguration {
                        val configured = definition.applySettings(configuration)
                        check(configured is PooledStreamingEventProcessorConfiguration) { "Physical event isolation requires streaming processors." }
                        return configured.eventSource(runtime.router.eventSource(source, identity))
                    }
                }
            }
            DefaultProcessorModuleFactory(scoped, settings.settings().mapKeys { names[it.key] ?: it.key }, customizations).buildProcessorModules(handlers)
        }.toSet()
    }
}

@Configuration(proxyBeanMethods = false)
class TenantEventStorageConfiguration {
    @Bean(destroyMethod = "close")
    @ConditionalOnProperty(prefix = "medol.axon", name = ["event-storage"], havingValue = "umadb")
    fun tenantEventStores(properties: TenantStorageProperties, resolver: TenantStorageResolver, environment: Environment, provisioner: TenantStorageProvisioner) = TenantEventStores(properties, resolver, environment, provisioner)

    @Bean
    @org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean(ProcessorModuleFactory::class)
    fun tenantProcessorModuleFactory(definitions: List<EventProcessorDefinition>, settings: EventProcessorSettings.MapWrapper,
        customizations: List<PooledStreamingEventProcessorModule.Customization>, properties: TenantStorageProperties,
        stores: ObjectProvider<TenantEventStores>): ProcessorModuleFactory = TenantProcessorModuleFactory(definitions, settings, customizations, properties, stores)
}
