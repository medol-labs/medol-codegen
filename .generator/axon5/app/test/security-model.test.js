const assert = require('node:assert/strict');
const test = require('node:test');
const {actorSecurityModel, iamSecurityContract} = require('../security-model');

const iamModel = () => ({
    contexts: [
        {
            name: 'IdentityAccessManagement'
        }
    ],
    slices: [
        {
            context: 'IdentityAccessManagement',
            readmodels: [
                {
                    name: 'UserAccountCatalog',
                    fields: ['accountId', 'loginName', 'credentialDigest'].map((name) => ({name}))
                },
                {
                    name: 'RoleCatalog',
                    fields: ['code', 'name', 'grants'].map((name) => ({name}))
                },
                {
                    name: 'PermissionCatalog',
                    fields: ['code', 'name', 'summary'].map((name) => ({name}))
                }
            ]
        }
    ]
});

test('derives embedded IAM security contract without fixed read model fields', () => {
    const contract = iamSecurityContract(iamModel());

    assert.equal(contract.mode, 'builtin');
    assert.equal(contract.repository.interfaceName, 'AuthIdentityRepository');
    assert.equal(contract.repository.defaultImplementationName, 'BuiltinReadModelAuthIdentityRepository');
});

test('rejects embedded IAM security artifacts when IAM context is missing', () => {
    assert.throws(
        () => iamSecurityContract({contexts: [], slices: []}),
        /require IdentityAccessManagement context/
    );
});

test('derives actor permissions for selected deployment contexts only', () => {
    const security = actorSecurityModel({
        actors: [],
        slices: [{
            context: 'Support',
            actors: [{name: 'SupportAdmin', title: 'Support Admin'}],
            commands: [{name: 'RegisterDictionary'}],
            readmodels: [{name: 'DictionaryCatalog'}]
        }, {
            context: 'RuntimeAgentOperations',
            actors: [{name: 'NodeOperator', title: 'Node Operator'}],
            commands: [{name: 'DeclareDataset'}],
            readmodels: [{name: 'DatasetCapability'}]
        }]
    }, {contexts: ['RuntimeAgentOperations']});

    assert(security.permissions.some((permission) => permission.code === 'declare_dataset:execute'));
    assert(security.permissions.every((permission) => permission.name));
    assert(security.permissions.some((permission) => permission.code === 'dataset_capability:list'));
    assert(!security.permissions.some((permission) => permission.code === 'register_dictionary:execute'));
    assert(!security.permissions.some((permission) => permission.code === 'dictionary_catalog:list'));
    assert.deepEqual(security.actors.map((actor) => actor.roleCode), ['ACTOR_NODE_OPERATOR', 'SERVICE_ACCOUNT']);
});
