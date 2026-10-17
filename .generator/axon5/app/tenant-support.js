const {escapeKotlin} = require('./model-helpers');

function tenantContract(model) {
    const contract = model.tenancy;
    if (contract === undefined) return undefined;
    if (contract?.enabled !== true) {
        throw new Error('Invalid tenant capability: enabled must be true. Remove the capability from the model to disable multi-tenancy.');
    }
    for (const [name, roles] of [
        ['directory', ['id', 'state']],
        ['memberships', ['id', 'tenant', 'user', 'state']]
    ]) {
        const provider = contract[name];
        if (!provider?.context || !provider?.readModel || roles.some((role) => !provider.mappings?.[role])) {
            throw new Error(`Invalid tenant capability: ${name} requires a context, readModel and mappings for ${roles.join(', ')}.`);
        }
    }
    if (!Array.isArray(contract.managementContexts)
        || ![contract.directory.context, contract.memberships.context].every((context) => contract.managementContexts.includes(context))) {
        throw new Error('Invalid tenant capability: managementContexts must include provider contexts.');
    }
    return contract;
}

function writeTenantRuntimeContract(generator) {
    tenantContract(generator.model);
    generator.fs.write(generator._sharedKernelKotlinPath('shared/application/tenancy/TenantIsolationRuntime.kt'), `package ${generator.model.rootPackage}.shared.application.tenancy

data class TenantProviderContract(
    val context: String,
    val readModel: String,
    val mappings: Map<String, String>
)

data class TenantCapabilityContract(
    val directory: TenantProviderContract,
    val memberships: TenantProviderContract,
    val managementContexts: Set<String>
)

/**
 * Installs and verifies trusted tenant resolution and isolation for this deployment.
 * Implementations must cover command/state loading, events/replay, projections/queries,
 * tenant-specific IAM grants, asynchronous work, files, caches and uniqueness constraints.
 * Management contexts are a platform control plane and still require authorization.
 * Throw on incomplete configuration; tenant metadata alone is not isolation.
 */
interface TenantIsolationRuntime {
    fun initialize(contract: TenantCapabilityContract)
}
`);
}

function writeTenantBootstrap(generator) {
    const contract = tenantContract(generator.model);
    const bootstrapPath = generator._rootKotlinPath('infrastructure/tenancy/TenantCapabilityConfiguration.kt');
    if (!contract) {
        generator.fs.delete(bootstrapPath);
        return;
    }
    const quote = (value) => `"${escapeKotlin(value)}"`;
    const provider = (item) => `TenantProviderContract(
            context = ${quote(item.context)},
            readModel = ${quote(item.readModel)},
            mappings = mapOf(${Object.entries(item.mappings).map(([role, field]) => `${quote(role)} to ${quote(field)}`).join(', ')})
        )`;
    generator.fs.write(bootstrapPath, `package ${generator.model.rootPackage}.infrastructure.tenancy

import org.springframework.beans.factory.ObjectProvider
import org.springframework.beans.factory.SmartInitializingSingleton
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import ${generator.model.rootPackage}.shared.application.tenancy.TenantCapabilityContract
import ${generator.model.rootPackage}.shared.application.tenancy.TenantIsolationRuntime
import ${generator.model.rootPackage}.shared.application.tenancy.TenantProviderContract

@Configuration
class TenantCapabilityConfiguration {
    @Bean
    fun tenantCapabilityContract(): TenantCapabilityContract = TenantCapabilityContract(
        directory = ${provider(contract.directory)},
        memberships = ${provider(contract.memberships)},
        managementContexts = setOf(${contract.managementContexts.map(quote).join(', ')})
    )

    @Bean
    fun tenantIsolationBootstrap(
        runtimes: ObjectProvider<TenantIsolationRuntime>,
        contract: TenantCapabilityContract
    ): SmartInitializingSingleton = SmartInitializingSingleton {
        val adapters = runtimes.orderedStream().toList()
        check(adapters.size == 1) {
            "Tenant management is enabled: exactly one TenantIsolationRuntime adapter is required; found " + adapters.size +
                ". Tenant metadata propagation does not provide tenant isolation."
        }
        adapters.single().initialize(contract)
    }
}
`);
}

module.exports = {tenantContract, writeTenantRuntimeContract, writeTenantBootstrap};
