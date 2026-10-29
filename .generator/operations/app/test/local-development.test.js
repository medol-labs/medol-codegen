const assert = require('node:assert/strict');
const test = require('node:test');
const YAML = require('yaml');
const {buildOperationsModel} = require('../operations-model-builder');
const {generateOperationsFiles} = require('../operations-generator');

test('local host development runs only infrastructure and keeps application ports explicit', () => {
    const model = buildOperationsModel({domain: 'Example', deployments: [{name: 'Backend', contexts: []}]});
    const files = generateOperationsFiles(model, {target: 'docker-compose', environment: 'local'});
    const compose = YAML.parse(files['operations/local/docker-compose.yml']);
    assert(!compose.services.backend);
    assert(!compose.services.console);
    assert(!compose.services.apisix);
    assert(compose.services.postgres);
    assert(compose.services.umadb);
    assert(compose.services.postgres.ports.every((port) => port.startsWith('127.0.0.1:')));
    assert(files['operations/local/infrastructure/postgres/init/01-create-databases.sql']);
    assert.match(files['operations/local/README.md'], /SPRING_DOCKER_COMPOSE_ENABLED=false/);
    assert.match(files['operations/local/.env-example'], /^MEDOL_SECURITY_ADMIN_BOOTSTRAP_ENABLED=true$/m);
    assert.match(files['operations/local/.env-example'], /^MEDOL_SECURITY_ADMIN_BOOTSTRAP_SETUP_TOKEN=local-admin-setup$/m);
    assert.match(files['operations/local/.env-example'], /^MEDOL_SECURITY_INTERNAL_TOKEN=local-dev-internal-token$/m);
    assert(!generateOperationsFiles(model, {target: 'docker-compose', environment: 'test'})['operations/local/docker-compose.yml']);
});
