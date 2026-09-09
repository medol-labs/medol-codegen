const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {loadCodegenModel} = require('../../../common/core/codegen-model-loader');

function restoreEnv(name, value) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}

function writeModel(model) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-model-loader-'));
    fs.writeFileSync(path.join(directory, 'codegen-model.json'), JSON.stringify(model, null, 2));
    return directory;
}

function writeWorkspaceModel(model) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-model-loader-'));
    fs.mkdirSync(path.join(directory, '.medol'));
    fs.writeFileSync(path.join(directory, '.medol/codegen-model.json'), JSON.stringify(model, null, 2));
    return directory;
}

function deployedMultiDomainModel() {
    return {
        rootPackage: 'tech.medo',
        domain: 'BusinessDomain',
        domains: [
            {name: 'BusinessDomain'},
            {name: 'IdentityAccessManagement'}
        ],
        deployments: [{
            name: 'Support',
            contexts: [
                {name: 'DictionaryMaintenance'},
                {name: 'IdentityAccessManagement'}
            ]
        }],
        contexts: [
            {name: 'DictionaryMaintenance', domain: 'BusinessDomain'},
            {name: 'IdentityAccessManagement', domain: 'IdentityAccessManagement'}
        ],
        slices: [
            {
                name: 'RegisterDictionary',
                title: 'RegisterDictionary',
                context: 'DictionaryMaintenance'
            },
            {
                name: 'RegisterUserAccount',
                title: 'RegisterUserAccount',
                context: 'IdentityAccessManagement'
            }
        ]
    };
}

test('keeps deployed built-in contexts when no domain is explicitly selected', () => {
    const previousDomain = process.env.CODEGEN_DOMAIN;
    const previousDeployment = process.env.CODEGEN_DEPLOYMENT;
    delete process.env.CODEGEN_DOMAIN;
    delete process.env.CODEGEN_DEPLOYMENT;
    try {
        const model = loadCodegenModel(writeModel(deployedMultiDomainModel()));
        assert.deepEqual(
            model.contexts.map((context) => context.name),
            ['DictionaryMaintenance', 'IdentityAccessManagement']
        );
        assert.deepEqual(
            model.slices.map((slice) => slice.name),
            ['RegisterDictionary', 'RegisterUserAccount']
        );
    } finally {
        restoreEnv('CODEGEN_DOMAIN', previousDomain);
        restoreEnv('CODEGEN_DEPLOYMENT', previousDeployment);
    }
});

test('still filters by domain when CODEGEN_DOMAIN is explicit', () => {
    const previousDomain = process.env.CODEGEN_DOMAIN;
    const previousDeployment = process.env.CODEGEN_DEPLOYMENT;
    process.env.CODEGEN_DOMAIN = 'BusinessDomain';
    delete process.env.CODEGEN_DEPLOYMENT;
    try {
        const model = loadCodegenModel(writeModel(deployedMultiDomainModel()));
        assert.deepEqual(model.contexts.map((context) => context.name), ['DictionaryMaintenance']);
        assert.deepEqual(model.slices.map((slice) => slice.name), ['RegisterDictionary']);
    } finally {
        restoreEnv('CODEGEN_DOMAIN', previousDomain);
        restoreEnv('CODEGEN_DEPLOYMENT', previousDeployment);
    }
});

test('loads codegen model from .medol by default', () => {
    const model = loadCodegenModel(writeWorkspaceModel(deployedMultiDomainModel()));
    assert.equal(model.domain, 'BusinessDomain');
    assert.deepEqual(
        model.contexts.map((context) => context.name),
        ['DictionaryMaintenance', 'IdentityAccessManagement']
    );
});
