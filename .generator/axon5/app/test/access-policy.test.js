const test = require('node:test');
const assert = require('node:assert/strict');
const {accessPolicyFor, policyLiteral, writeBusinessAccessSource} = require('../access-policy');
const {actorSecurityModel} = require('../security-model');
const rule = {kind: 'scope', field: 'organizationId', source: 'People.Members.organizationId', subjectField: 'userId', subjectSource: 'identity.userId'};
const source = {name: 'Members', fields: [{name: 'userId', type: 'UUID'}, {name: 'organizationId', type: 'UUID'}, {name: 'state', type: 'String'}], eligibility: [{operator: 'AND', conditions: [{left: 'state', operator: '==', right: 'Active'}]}]};
const target = {name: 'Orders', fields: [{name: 'ownerOrganizationId', type: 'UUID'}, {name: 'ownerId', type: 'UUID'}], accessBindings: {organizationId: 'ownerOrganizationId'}, accessRules: [{kind: 'scope', field: 'ownerId', source: 'identity.userId'}]};
const model = {dataAccess: {enabled: true}, rootPackage: 'example', defaultAccessPolicy: 'Participants', accessPolicies: [{name: 'Participants', rules: [rule]}], slices: [{context: 'People', readmodels: [source, target]}]};

test('resolves default bindings and additions while preserving stable grant names', () => {
    const result = accessPolicyFor(model, target);
    assert.equal(result.rules[0].name, 'organizationId');
    assert.equal(result.rules[0].field, 'ownerOrganizationId');
    assert.equal(result.rules.length, 2);
    assert.match(policyLiteral(result), /field = "ownerOrganizationId"/);
    assert.throws(() => accessPolicyFor(model, {...target, accessBindings: {unknown: 'ownerId'}}), /Unknown access binding/);
    assert.throws(() => accessPolicyFor(model, {...target, fields: []}), /missing or unsupported/);
    assert.throws(() => accessPolicyFor({...model, slices: []}, target), /must be deployed/);
    assert.throws(() => accessPolicyFor(model, {...target, accessRules: [rule]}), /cannot override/);
});

test('generates a bounded distinct relation query with actor, validity and tenant predicates', () => {
    let output;
    writeBusinessAccessSource({model, fs: {write: (_, text) => output = text}}, {context: 'People', readmodel: source, packageName: 'example.people', entityName: 'MemberEntity', path: 'source.kt', scoped: true, tenantField: 'tenantId'});
    assert.match(output, /distinct\(true\)/);
    assert.match(output, /setMaxResults\(AccessScopeValues.MAX_VALUES \+ 1\)/);
    assert.match(output, /actor.id/);
    assert.match(output, /record.get<String>\("tenantId"\), tenant/);
    assert.match(output, /AccessScopeValues.convert\("Active"/);
    assert.doesNotMatch(output, /exists|findByIdWithAccessPolicy/i);
});

test('IAM catalogs explicit scope grants without implicitly assigning them to actors', () => {
    const security = actorSecurityModel(model);
    assert.ok(security.permissions.some(p => p.code === 'data:participants:organizationid:scope'));
    assert.ok(security.permissions.some(p => p.code === 'data:participants:ownerid:all'));
    assert.ok(!security.grants.some(g => g.permissionCode.startsWith('data:')));
});

test('legacy config normalization retains executable scopes and rejects unknown rule kinds', () => {
    const {fromConfig} = require('../../../common/core/codegen-model');
    const normalized = fromConfig({accessPolicies: model.accessPolicies, slices: []});
    assert.deepEqual(normalized.accessPolicies[0].rules, [rule]);
    assert.throws(() => fromConfig({accessPolicies: [{name: 'Unsafe', rules: [{kind: 'unknown'}]}]}), /Unsupported access policy/);
});

test('direct codegen input cannot bypass source typing, rule kind or normalized grant validation', () => {
    const {validateAccessGrantNames} = require('../access-policy');
    assert.throws(() => validateAccessGrantNames({dataAccess: {enabled: true}, accessPolicies: [{name: 'Scope'}, {name: 'scope'}]}), /normalization/);
    assert.throws(() => accessPolicyFor(model, {...target, accessRules: [{kind: 'fields', field: 'ownerId', source: 'identity.userId'}]}), /must be scope/);
    assert.throws(() => accessPolicyFor(model, {...target, fields: [target.fields[0], {name: 'ownerId', type: 'String'}]}), /UUID target/);
    assert.throws(() => accessPolicyFor({...model, accessPolicies: [{name: 'Participants', rules: [rule, {...rule, field: 'OrganizationId'}]}]}, target), /normalization/);
});

test('absence disables enforcement and grants, and regeneration removes runtime registration', () => {
    const {writeAccessSupport, dataAccessEnabled} = require('../access-policy');
    const disabled = {...model}; delete disabled.dataAccess;
    assert.equal(dataAccessEnabled(disabled), false);
    assert.deepEqual(accessPolicyFor(disabled, {...target, fields: []}), {name: undefined, fields: [], rules: []});
    assert.ok(!actorSecurityModel(disabled).permissions.some(p => p.code.startsWith('data:')));
    assert.throws(() => dataAccessEnabled({dataAccess: {enabled: false}}), /Invalid dataAccess/);
    const files = new Map();
    const writer = {model, fs: {write: (p,v) => files.set(p,v), read: p => files.get(p) ?? '', delete: p => files.delete(p)}, _sharedKernelKotlinPath: p => p, _sharedKernelResourcePath: p => p};
    writeAccessSupport(writer);
    const imports = 'META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports';
    files.set(imports, files.get(imports) + 'example.UnrelatedConfiguration\n');
    assert.ok(files.has('shared/application/access/BackgroundDataAccess.kt'));
    writer.model = disabled;
    writeAccessSupport(writer);
    assert.ok(![...files.keys()].some(p => p.startsWith('shared/application/access/')));
    assert.equal(files.get(imports), 'example.UnrelatedConfiguration\n');
    files.set('source.kt', 'old scope source');
    writeBusinessAccessSource(writer, {context: 'People', readmodel: source, path: 'source.kt'});
    assert.ok(!files.has('source.kt'));
});
