const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {escapeKotlin} = require('./model-helpers');
const quote = value => `"${escapeKotlin(value)}"`;

function dataAccessEnabled(model) {
    if (model.dataAccess === undefined) return false;
    if (model.dataAccess?.enabled !== true) throw new Error('Invalid dataAccess contract: remove the capability to disable it.');
    return true;
}

function validateAccessGrantNames(model) {
    if (!dataAccessEnabled(model)) return;
    const policies = new Map();
    for (const policy of model.accessPolicies ?? []) {
        const key = policy.name.toLowerCase();
        if (policies.has(key) && policies.get(key) !== policy.name) throw new Error('Access policy names collide after IAM permission normalization.');
        policies.set(key, policy.name);
        const names = new Map();
        const local = (model.slices ?? []).flatMap(s => (s.readmodels ?? [])
            .filter(r => (r.accessPolicy ?? model.defaultAccessPolicy) === policy.name).flatMap(r => r.accessRules ?? []));
        for (const rule of [...(policy.rules ?? []), ...local].filter(r => r.kind === 'scope')) {
            const code = rule.field.toLowerCase();
            if (names.has(code) && names.get(code) !== rule.field) throw new Error('Access rule names collide after IAM permission normalization.');
            names.set(code, rule.field);
        }
    }
}

function accessPolicyFor(model, readmodel) {
    if (!dataAccessEnabled(model)) return {name: undefined, fields: [], rules: []};
    validateAccessGrantNames(model);
    const name = readmodel.accessPolicy ?? model.defaultAccessPolicy;
    const policy = (model.accessPolicies ?? []).find(p => p.name === name);
    if (name && !policy) throw new Error(`Unknown access policy ${name}.`);
    if (!policy && (readmodel.accessRules?.length || Object.keys(readmodel.accessBindings ?? {}).length)) throw new Error('Access adjustments require a named policy.');
    if ((policy?.rules ?? []).some(r => !['scope', 'fields'].includes(r.kind))) throw new Error('Unsupported access policy rule.');
    const inherited = (policy?.rules ?? []).filter(r => r.kind === 'scope');
    for (const field of Object.keys(readmodel.accessBindings ?? {})) {
        if (!inherited.some(r => r.field === field)) throw new Error(`Unknown access binding ${field}.`);
    }
    if ((readmodel.accessRules ?? []).some(r => r.kind !== 'scope')) throw new Error('Additional access rules must be scope rules.');
    const rules = [...inherited, ...(readmodel.accessRules ?? [])];
    if (new Set(rules.map(r => r.field)).size !== rules.length) throw new Error('Duplicate access rule; additional rules cannot override inherited constraints.');
    return {name, fields: (policy?.rules ?? []).filter(r => r.kind === 'fields').flatMap(r => r.fields ?? []), rules: rules.map(rule => {
        const field = readmodel.accessBindings?.[rule.field] ?? rule.field;
        const target = readmodel.fields.find(f => f.name === field);
        if (!target || (target.cardinality && target.cardinality !== 'Single') || !['UUID', 'String', 'Int', 'Long'].includes(target.type)) throw new Error(`Readmodel ${readmodel.name}: missing or unsupported access field ${field}.`);
        if (rule.source === 'identity.userId' && target.type !== 'UUID') throw new Error('identity.userId requires a UUID target.');
        if (!/^identity\.[A-Za-z_][\w]*$/.test(rule.source) && (!/^[\w]+\.[\w]+\.[\w]+$/.test(rule.source) || !rule.subjectField || rule.subjectSource !== 'identity.userId')) throw new Error(`Invalid access source ${rule.source}.`);
        if (rule.source.startsWith('identity.') && (rule.subjectField || rule.subjectSource)) throw new Error('Identity scope cannot have a by binding.');
        if (!rule.source.startsWith('identity.') && model.slices) {
            const [context, readModel, sourceField] = rule.source.split('.');
            const matches = model.slices.filter(s => s.context === context).flatMap(s => s.readmodels ?? []).filter(r => r.name === readModel);
            if (matches.length !== 1) throw new Error(`Access source ${rule.source} must be deployed with the target readmodel. Cross-deployment sources require an explicit identity scope adapter.`);
            const value = matches[0].fields.find(f => f.name === sourceField);
            const subject = matches[0].fields.find(f => f.name === rule.subjectField);
            if (!value || value.type !== target.type || (value.cardinality && value.cardinality !== 'Single') || !subject || subject.type !== 'UUID' || (subject.cardinality && subject.cardinality !== 'Single')) throw new Error(`Incompatible access source ${rule.source}.`);
        }
        return {...rule, name: rule.field, field};
    })};
}
function policyLiteral(policy) {
    const list = values => values.length ? `listOf(${values.map(quote).join(', ')})` : 'emptyList()';
    const rule = r => `ReadModelAccessRule(name = ${quote(r.name)}, field = ${quote(r.field)}, source = ${quote(r.source)}, subjectField = ${r.subjectField ? quote(r.subjectField) : 'null'}, subjectSource = ${r.subjectSource ? quote(r.subjectSource) : 'null'})`;
    return `ReadModelAccessPolicy(name = ${policy.name ? quote(policy.name) : 'null'}, fields = ${list(policy.fields)}, rules = listOf(${policy.rules.map(rule).join(', ')}))`;
}
function writeAccessSupport(generator) {
    if (!dataAccessEnabled(generator.model)) {
        for (const file of ['ReadModelAccessPolicyFilter.kt', 'ReadModelAccessPolicyAutoConfiguration.kt', 'BackgroundDataAccess.kt']) {
            generator.fs.delete?.(generator._sharedKernelKotlinPath(`shared/application/access/${file}`));
        }
        const path = generator._sharedKernelResourcePath('META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports');
        const previous = generator.fs.read?.(path, {defaults: ''}) ?? '';
        const remaining = previous.split('\n').filter(line => line.trim() && line.trim() !== `${generator.model.rootPackage}.shared.application.access.ReadModelAccessPolicyAutoConfiguration`).join('\n');
        if (remaining) generator.fs.write(path, remaining + '\n'); else generator.fs.delete?.(path);
        return;
    }
    for (const file of ['ReadModelAccessPolicyFilter.kt', 'ReadModelAccessPolicyAutoConfiguration.kt', 'BackgroundDataAccess.kt']) {
        generator.fs.write(generator._sharedKernelKotlinPath(`shared/application/access/${file}`), readFileSync(join(__dirname, 'templates/access', `${file}.tpl`), 'utf8').replaceAll('__ROOT__', generator.model.rootPackage));
    }
    const importsPath = generator._sharedKernelResourcePath('META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports');
    const existing = (generator.fs.read?.(importsPath, {defaults: ''}) ?? '').split('\n').filter(Boolean);
    generator.fs.write(importsPath, [...new Set([...existing, `${generator.model.rootPackage}.shared.application.access.ReadModelAccessPolicyAutoConfiguration`])].join('\n') + '\n');
}
module.exports = {accessPolicyFor, policyLiteral, writeAccessSupport, validateAccessGrantNames, dataAccessEnabled};

function writeBusinessAccessSource(generator, {context, readmodel, packageName, entityName, path, scoped, tenantField}) {
    if (!dataAccessEnabled(generator.model)) { generator.fs.delete?.(path); return; }
    const model = generator.fullModel ?? generator.model;
    const candidates = [
        ...(model.accessPolicies ?? []).flatMap(p => p.rules ?? []),
        ...(model.slices ?? []).flatMap(s => (s.readmodels ?? []).flatMap(r => r.accessRules ?? []))
    ].filter(r => r.kind === 'scope' && r.source.startsWith(`${context}.${readmodel.name}.`));
    const rules = [...new Map(candidates.map(r => [`${r.source}|${r.subjectField}|${r.subjectSource}`, r])).values()];
    if (!rules.length) { generator.fs.delete?.(path); return; }
    for (const rule of rules) {
        const target = readmodel.fields.find(f => f.name === rule.source.split('.').at(-1));
        const subject = readmodel.fields.find(f => f.name === rule.subjectField);
        if (!target || !['UUID', 'String', 'Int', 'Long'].includes(target.type) || (target.cardinality && target.cardinality !== 'Single') || !subject || subject.type !== 'UUID' || (subject.cardinality && subject.cardinality !== 'Single') || rule.subjectSource !== 'identity.userId') throw new Error(`Invalid business access relation ${rule.source}.`);
    }
    const root = generator.model.rootPackage;
    const eligibility = (readmodel.eligibility ?? []).filter(e => !e.profile);
    if (eligibility.length > 1) throw new Error('Business access source requires at most one default eligibility rule.');
    const referenceField = ref => {
        const parts = ref.split('.');
        const field = readmodel.fields.find(f => f.name === parts.at(-1));
        const owner = parts.slice(0, -1).join('.');
        if (!field || (owner && owner !== readmodel.name && owner !== `${context}.${readmodel.name}` && field.type !== `${owner}.State` && !field.source?.from?.includes(ref))) throw new Error(`Access source eligibility field ${ref} is not materialized.`);
        return `record.get<Any>(${quote(field.name)})`;
    };
    const condition = c => {
        if (!['==', '!='].includes(c.operator)) throw new Error('Business access source currently supports equality and inequality default eligibility conditions.');
        const left = referenceField(c.left);
        if (c.rightReference) return `builder.${c.operator === '==' ? 'equal' : 'notEqual'}(${left}, ${referenceField(c.rightReference)})`;
        if (c.right === null) return `builder.${c.operator === '==' ? 'isNull' : 'isNotNull'}(${left})`;
        return `builder.${c.operator === '==' ? 'equal' : 'notEqual'}(${left}, AccessScopeValues.convert(${quote(String(c.right))}, ${left}.javaType))`;
    };
    const valid = eligibility[0];
    if (valid && !['AND', 'OR'].includes(valid.operator)) throw new Error('Unsupported access source eligibility operator.');
    const validPredicate = valid?.conditions?.length ? `predicates.add(builder.${valid.operator === 'OR' ? 'or' : 'and'}(${valid.conditions.map(condition).join(', ')}))` : '';
    generator.fs.write(path, `package ${packageName}

import jakarta.persistence.EntityManager
import org.springframework.stereotype.Repository
import org.springframework.transaction.annotation.Transactional
import org.springframework.security.access.AccessDeniedException
import ${root}.shared.security.CurrentUser
import ${root}.shared.application.access.*

@Repository
${generator.model.tenancy && !scoped ? `@${root}.shared.application.tenancy.TenantControlRepository\n` : ''}class ${entityName}AccessScopeSource(
    private val entityManager: EntityManager${scoped ? `,\n    private val boundary: ${root}.shared.application.tenancy.TenantPersistenceBoundary` : ''}
) : BusinessAccessScopeSource {
    override fun supports(rule: ReadModelAccessRule): Boolean =
        listOf(${rules.map(r => quote(`${r.source}|${r.subjectField}|${r.subjectSource}`)).join(', ')}).contains(rule.source + "|" + rule.subjectField + "|" + rule.subjectSource)

    @Transactional(readOnly = true)
    override fun values(actor: CurrentUser, rule: ReadModelAccessRule): Set<Any> {
        if (!supports(rule)) throw AccessDeniedException("Unknown modeled access source.")
${scoped ? `        val tenant = ${root}.shared.application.tenancy.TenantScope.requireTenant()\n        boundary.assertTenantTransaction()\n` : ''}        val builder = entityManager.criteriaBuilder
        val query = builder.createQuery(Any::class.java)
        val record = query.from(${entityName}::class.java)
        val value = record.get<Any>(rule.source.substringAfterLast('.'))
        val predicates = mutableListOf<jakarta.persistence.criteria.Predicate>()
        predicates.add(builder.equal(record.get<java.util.UUID>(requireNotNull(rule.subjectField)), actor.id))
        predicates.add(builder.isNotNull(value))
${scoped ? `        predicates.add(builder.equal(record.get<String>(${quote(tenantField)}), tenant))\n` : ''}        ${validPredicate}
        query.select(value).distinct(true).where(*predicates.toTypedArray())
        val values = entityManager.createQuery(query).setMaxResults(AccessScopeValues.MAX_VALUES + 1).resultList
        if (values.size > AccessScopeValues.MAX_VALUES) throw AccessDeniedException("Authorized scope exceeds the supported value limit.")
        return values.toSet()
    }
}
`);
}
module.exports.writeBusinessAccessSource = writeBusinessAccessSource;
