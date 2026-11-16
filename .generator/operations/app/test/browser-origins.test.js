const test = require('node:test');
const assert = require('node:assert/strict');
const {buildOperationsModel} = require('../operations-model-builder');
const {resolveOperationsModel} = require('../environment-resolver');
const {generateOperationsFiles} = require('../operations-generator');
const source = {domain: 'Sample', contexts: [{name: 'Orders'}], deployments: [{name: 'OrdersApi', contexts: [{name: 'Orders'}]}]};
test('environment browser origins reach Compose and Kubernetes without hardcoded ports', () => {
    const model = buildOperationsModel(source, {environments: {local: {browserOrigins: ['https://console.example.test:31443/']}}});
    const files = generateOperationsFiles(model, {environment: 'local'});
    for (const path of ['operations/docker-compose/local/docker-compose.yml', 'operations/kubernetes/environments/local/configmap.yaml', 'operations/k3s/environments/local/configmap.yaml']) {
        assert.match(files[path], /MEDOL_SECURITY_ALLOWED_ORIGINS: "https:\/\/console.example.test:31443"/);
    }
    assert(!resolveOperationsModel(model, 'prod').applications[0].environmentVariables.some(v => v.name === 'MEDOL_SECURITY_ALLOWED_ORIGINS'));
});
test('reject unsafe or non-origin entries before rendering', () => {
    for (const browserOrigins of [[], ['*'], ['https://*.example.test'], ['https://user:pass@site'], ['http://site/path'], ['file:///tmp']]) {
        const model = buildOperationsModel(source, {environments: {local: {browserOrigins}}});
        assert.throws(() => resolveOperationsModel(model, 'local'), /origin|Origins/);
    }
});
