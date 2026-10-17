const {escapeKotlin, readModelTableName, safeDatabaseName, readModelStorageType} = require('./model-helpers');
const {contextPackage} = require('../../common/util/value-types');

const runtimeFiles = ['TenantScope.kt', 'SameSchemaTenantAccess.kt', 'TenantDispatchInterceptor.kt', 'TenantWebConfiguration.kt', 'TenantRelay.kt', 'TenantBackgroundRunner.kt', 'TenantFiles.kt'];

function tenantScoped(model, context) {
    const contract = tenantContract(model);
    return Boolean(contract && !contract.managementContexts.includes(context));
}

function tenantAccessQuery(model) {
    const contract = tenantContract(model);
    if (!contract) return undefined;
    const tables = new Map();
    for (const slice of model.slices ?? []) for (const readmodel of slice.readmodels ?? []) {
        const name = readModelTableName(model, slice.context, readmodel);
        const owner = `${slice.context}.${readmodel.name}`;
        if (tables.has(name) && tables.get(name) !== owner) throw new Error(`Shared-schema table ${name} is bound to multiple readmodels. Use distinct table names.`);
        tables.set(name, owner);
    }
    const parameters = {};
    const provider = (binding, alias) => {
        const matches = (model.slices ?? []).filter((slice) => slice.context === binding.context)
            .flatMap((slice) => slice.readmodels ?? []).filter((readmodel) => readmodel.name === binding.readModel);
        if (matches.length !== 1) throw new Error(`Tenant source ${binding.context}.${binding.readModel} is not available in the full model.`);
        const readmodel = matches[0];
        const column = (name) => {
            if (!(readmodel.fields ?? []).some((field) => field.name === name)) throw new Error(`Unknown tenant eligibility field ${name}.`);
            return `${alias}."${safeDatabaseName(name)}"`;
        };
        const referenceColumn = (reference) => {
            const parts = String(reference).split('.');
            const fieldName = parts.at(-1);
            const owner = parts.slice(0, -1).join('.');
            const field = readmodel.fields.find((item) => item.name === fieldName);
            if (owner && owner !== readmodel.name && owner !== `${binding.context}.${readmodel.name}`
                && field?.type !== `${owner}.State` && !field?.source?.from?.includes(reference)) {
                throw new Error(`Tenant eligibility reference ${reference} is not materialized on ${binding.context}.${readmodel.name}.`);
            }
            return column(fieldName);
        };
        const eligibility = (readmodel.eligibility ?? []).filter((item) => !item.profile);
        if (eligibility.length !== 1 || eligibility[0].operator !== 'AND' || !eligibility[0].conditions?.length) {
            throw new Error(`Tenant source ${binding.context}.${binding.readModel} requires a default eligible when condition.`);
        }
        const conditions = eligibility[0].conditions.map((condition, index) => {
            const fieldColumn = referenceColumn(condition.left);
            const operator = ({'==': '=', '!=': '<>', '>': '>', '<': '<', '>=': '>=', '<=': '<='})[condition.operator];
            if (!operator) throw new Error('Unsupported tenant eligibility operator.');
            if (condition.right === null) {
                if (!['==', '!='].includes(condition.operator)) throw new Error('Invalid null tenant eligibility comparison.');
                return `${fieldColumn} IS ${condition.operator === '!=' ? 'NOT ' : ''}NULL`;
            }
            if (condition.rightReference) return `${fieldColumn} ${operator} ${referenceColumn(condition.rightReference)}`;
            const key = `${alias}${index}`;
            parameters[key] = condition.right;
            return `${fieldColumn} ${operator} :${key}`;
        });
        return {readmodel, context: binding.context, column, conditions, table: `"${readModelTableName(model, binding.context, readmodel)}"`};
    };
    const directory = provider(contract.directory, 'd');
    const members = provider(contract.memberships, 'm');
    const type = (info, field) => {
        const definition = info.readmodel.fields.find((item) => item.name === field);
        const parts = definition.type.split('.');
        const typeName = parts.pop();
        const owner = parts.join('.') || info.context;
        const valueType = model.valueTypes?.find((item) => item.name === typeName && item.context === owner);
        return readModelStorageType(valueType ? {...definition, valueType} : definition, false);
    };
    const tenantType = type(directory, contract.directory.mappings.id);
    const userType = type(members, contract.memberships.mappings.user);
    if (![tenantType, userType].every((value) => ['UUID', 'String'].includes(value))) {
        throw new Error('Same-schema tenancy currently requires UUID or String tenant and user identifiers.');
    }
    const sql = `SELECT 1 FROM ${directory.table} d JOIN ${members.table} m ON ${members.column(contract.memberships.mappings.tenant)} = ${directory.column(contract.directory.mappings.id)} WHERE ${directory.column(contract.directory.mappings.id)} = :tenant AND ${members.column(contract.memberships.mappings.user)} = :user AND ${[...directory.conditions, ...members.conditions].join(' AND ')} FETCH FIRST 1 ROW ONLY`;
    const backgroundSql = `SELECT DISTINCT ${directory.column(contract.directory.mappings.id)} FROM ${directory.table} d JOIN ${members.table} m ON ${members.column(contract.memberships.mappings.tenant)} = ${directory.column(contract.directory.mappings.id)} WHERE ${members.column(contract.memberships.mappings.user)} = :user AND ${[...directory.conditions, ...members.conditions].join(' AND ')}`;
    return {sql, parameters, backgroundSql, directoryIdColumn: directory.column(contract.directory.mappings.id), uuidTenantId: tenantType === 'UUID', uuidUserId: userType === 'UUID'};
}

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
    const contract = tenantContract(generator.model);
    const testPath = generator._sharedKernelKotlinPath('shared/application/tenancy/SameSchemaTenantRuntimeTest.kt').replace('/src/main/kotlin/', '/src/test/kotlin/');
    if (!contract) {
        for (const file of ['TenantIsolationRuntime.kt', ...runtimeFiles]) {
            generator.fs.delete(generator._sharedKernelKotlinPath(`shared/application/tenancy/${file}`));
        }
        generator.fs.delete(testPath);
        return;
    }
    for (const file of runtimeFiles) {
        generator.fs.copyTpl(generator.templatePath(`tenancy/${file}.tpl`),
            generator._sharedKernelKotlinPath(`shared/application/tenancy/${file}`), {rootPackage: generator.model.rootPackage});
    }
    generator.fs.copyTpl(generator.templatePath('tenancy/SameSchemaTenantRuntimeTest.kt.tpl'), testPath, {rootPackage: generator.model.rootPackage});
    generator.fs.write(generator._sharedKernelKotlinPath('shared/application/tenancy/TenantIsolationRuntime.kt'), `package ${generator.model.rootPackage}.shared.application.tenancy

data class TenantProviderContract(
    val context: String,
    val readModel: String,
    val mappings: Map<String, String>
)

data class TenantCapabilityContract(
    val directory: TenantProviderContract,
    val memberships: TenantProviderContract,
    val managementContexts: Set<String>,
    val controlPlanePackages: Set<String> = emptySet(),
    val accessQuery: String = "",
    val backgroundQuery: String = "",
    val directoryIdColumn: String = "",
    val accessParameters: Map<String, Any?> = emptyMap(),
    val uuidTenantId: Boolean = true,
    val uuidUserId: Boolean = true
)

/**
 * Installs and verifies trusted tenant resolution and isolation for this deployment.
 * The generated same-schema implementation validates modeled directory availability.
 * Generated command, state and repository code enforce the data boundary separately.
 * Business authorization and custom storage adapters must preserve that boundary.
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
    const query = tenantAccessQuery(generator.fullModel ?? generator.model);
    const controlContexts = [...new Set(contract.managementContexts)];
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
        managementContexts = setOf(${contract.managementContexts.map(quote).join(', ')}),
        controlPlanePackages = setOf(${controlContexts.map((context) => quote(`${generator.model.rootPackage}.${contextPackage(context)}.`)).join(', ')}),
        accessQuery = ${quote(query.sql)},
        backgroundQuery = ${quote(query.backgroundSql)},
        directoryIdColumn = ${quote(query.directoryIdColumn)},
        accessParameters = mapOf(${Object.entries(query.parameters).map(([key, value]) => `${quote(key)} to ${typeof value === 'string' ? quote(value) : String(value)}`).join(', ')}),
        uuidTenantId = ${query.uuidTenantId},
        uuidUserId = ${query.uuidUserId}
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

function tenantTestFixture(model) {
    if (!model.tenancy) return '';
    const root = model.rootPackage;
    return `    @org.springframework.test.context.bean.override.convention.TestBean(name = "sameSchemaTenantAccess", methodName = "tenantAccessFixture")
    private lateinit var tenantAccess: ${root}.shared.application.tenancy.SameSchemaTenantAccess

    companion object {
        @JvmStatic
        fun tenantAccessFixture(): ${root}.shared.application.tenancy.SameSchemaTenantAccess =
            ${root}.shared.application.tenancy.SameSchemaTenantAccess(
                org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate(
                    org.springframework.jdbc.datasource.DriverManagerDataSource("jdbc:h2:mem:tenant-fixture-" + java.util.UUID.randomUUID(), "sa", "")
                ),
                ${root}.shared.application.tenancy.TenantCapabilityContract(
                    ${root}.shared.application.tenancy.TenantProviderContract("Fixture", "Tenants", emptyMap()),
                    ${root}.shared.application.tenancy.TenantProviderContract("Fixture", "Members", emptyMap()),
                    emptySet(), accessQuery = "SELECT 1 WHERE :tenant IN ('test-tenant', 'test-tenant-b') AND :user = 'test-user'",
                    uuidTenantId = false, uuidUserId = false
                )
            )
    }
`;
}

module.exports = {tenantContract, tenantScoped, tenantAccessQuery, tenantTestFixture, writeTenantRuntimeContract, writeTenantBootstrap};
