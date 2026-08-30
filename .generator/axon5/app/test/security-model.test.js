const assert = require('node:assert/strict');
const test = require('node:test');
const {iamSecurityContract} = require('../security-model');

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
