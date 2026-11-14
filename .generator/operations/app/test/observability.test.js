const test = require('node:test');
const assert = require('node:assert/strict');
const YAML = require('yaml');
const {buildOperationsModel} = require('../operations-model-builder');
const {resolveOperationsModel} = require('../environment-resolver');
const {generateOperationsFiles} = require('../operations-generator');
const {resolveObservability} = require('../observability');

test('independent reference provisions all three signals without Mimir or public data stores', () => {
    const files = generateOperationsFiles(model('disabled'), {environment: 'local'});
    const root = 'operations/observability/local/reference/';
    const compose = YAML.parse(files[root + 'docker-compose.yml']);
    assert.deepEqual(Object.keys(compose.services).sort(), ['collector', 'grafana', 'loki', 'prometheus', 'tempo']);
    for (const service of Object.values(compose.services)) {
        assert(!service.image.endsWith(':latest'));
        assert((service.ports ?? []).every(p => p.startsWith('127.0.0.1:')));
        for (const mount of service.volumes) {
            if (mount.startsWith('./')) assert(files[root + mount.split(':')[0].slice(2)], mount);
        }
    }
    assert.match(compose.services.grafana.environment.GF_SECURITY_ADMIN_PASSWORD, /\:\?/);
    const collector = YAML.parse(files[root + 'collector.yml']);
    for (const signal of ['logs', 'metrics', 'traces']) {
        const pipeline = collector.service.pipelines[signal];
        for (const exporter of pipeline.exporters) assert(collector.exporters[exporter]);
        assert.deepEqual(pipeline.processors, ['memory_limiter', 'batch']);
    }
    const datasources = YAML.parse(files[root + 'datasources.yml']).datasources;
    assert.deepEqual(datasources.map(d => d.uid), ['prometheus', 'loki', 'tempo']);
    assert.equal(JSON.parse(files[root + 'overview.json']).panels.length, 2);
    assert(compose.services.tempo.command.includes('-target=all'));
    assert.match(files[root + '.gitignore'], /^\.env$/m);
    assert.match(files[root + 'README.md'], /mode: external/);
    assert(!YAML.parse(files['operations/docker-compose/local/docker-compose.yml']).services.collector);
});

const source = {domain: 'Sample', contexts: [{name: 'Orders'}], deployments: [{name: 'OrdersApi', contexts: [{name: 'Orders'}]}]};
function model(mode, extra = {}) {
    return buildOperationsModel(source, {environments: {local: {observability: {mode, ...extra}}}});
}

test('disabled mode emits no collector or exporting application environment', () => {
    const m = model('disabled');
    const app = resolveOperationsModel(m, 'local').applications.find(a => a.kind === 'backend');
    assert.equal(app.environmentVariables.find(v => v.name === 'MEDOL_OBSERVABILITY_ENABLED').value, 'false');
    assert(!app.environmentVariables.some(v => v.name === 'OTEL_EXPORTER_OTLP_ENDPOINT'));
    const files = generateOperationsFiles(m, {environment: 'local'});
    const compose = YAML.parse(files['operations/docker-compose/local/docker-compose.yml']);
    assert(!compose.services['medol-observability']);
    assert(!files['operations/kubernetes/environments/local/observability.yaml']);
});

test('managed mode includes private OTLP and persistent LGTM in Compose, K8s and host development', () => {
    const files = generateOperationsFiles(model('managed'), {environment: 'local'});
    const compose = YAML.parse(files['operations/docker-compose/local/docker-compose.yml']);
    const stack = compose.services['medol-observability'];
    assert.equal(stack.image, 'grafana/otel-lgtm:0.41.0');
    assert(stack.ports.every(port => port.startsWith('127.0.0.1:')));
    assert(stack.ports.every(port => !port.endsWith(':4318')));
    const app = Object.values(compose.services).find(s => s.environment?.MEDOL_OBSERVABILITY_ENABLED === 'true');
    assert.equal(app.environment.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://medol-observability:4318');
    assert(!app.depends_on?.['medol-observability'], 'telemetry must not gate application startup');
    assert(compose.volumes.medol_observability_data);
    for (const target of ['kubernetes', 'k3s']) {
        const resources = YAML.parseAllDocuments(files[`operations/${target}/environments/local/observability.yaml`]).map(d => d.toJSON());
        assert.equal(resources.find(r => r.kind === 'Service').spec.type, 'ClusterIP');
        assert(resources.some(r => r.kind === 'PersistentVolumeClaim'));
        assert(YAML.parse(files[`operations/${target}/environments/local/kustomization.yaml`]).resources.includes('observability.yaml'));
    }
    const host = YAML.parse(files['operations/local/docker-compose.yml']);
    assert(host.services['medol-observability'].ports.includes('127.0.0.1:${MEDOL_OTLP_PORT:-4318}:4318'));
    assert.match(files['operations/local/.env-example'], /OTEL_EXPORTER_OTLP_ENDPOINT=http:\/\/127.0.0.1:4318/);
    assert.match(files['operations/images/images.mjs'], /observability.mode === 'managed'/);
    assert(JSON.parse(files['operations/model/services.json']).services.some(service => service.name === 'medol-observability'));
});

test('external mode only configures application exporters and preserves environment isolation', () => {
    const m = model('external', {endpoint: 'https://telemetry.example.test/otlp/', samplingProbability: 0.25});
    const files = generateOperationsFiles(m, {environment: 'local'});
    const compose = YAML.parse(files['operations/docker-compose/local/docker-compose.yml']);
    assert(!compose.services['medol-observability']);
    const app = Object.values(compose.services).find(s => s.environment?.MEDOL_OBSERVABILITY_ENABLED === 'true');
    assert.equal(app.environment.OTEL_EXPORTER_OTLP_ENDPOINT, 'https://telemetry.example.test/otlp');
    assert.equal(resolveOperationsModel(m, 'prod').observability.mode, 'disabled');
});

test('invalid mode, insecure credentials, unpinned images and production managed mode fail early', () => {
    for (const config of [{mode: 'unknown'}, {mode: 'external'}, {mode: 'external', endpoint: 'ftp://collector'},
        {mode: 'external', endpoint: 'https://user:password@collector'}, {mode: 'managed', image: 'grafana/otel-lgtm:latest'},
        {mode: 'managed', samplingProbability: 2}]) assert.throws(() => resolveObservability(config));
    assert.throws(() => resolveObservability({mode: 'managed'}, 'prod'), /external/);
});

test('isolated sites each include managed resources without cross-host service DNS assumptions', () => {
    const m = model('managed');
    m.networkTopology = {sites: [{name: 'one', applications: m.applications.map(a => a.name), infrastructure: m.infrastructure.map(i => i.name), gateway: true}]};
    const files = generateOperationsFiles(m, {environment: 'local'});
    assert(YAML.parse(files['operations/docker-compose/local/sites/one/docker-compose.yml']).services['medol-observability']);
    assert(files['operations/kubernetes/environments/local/sites/one/observability.yaml']);
    assert(files['operations/k3s/environments/local/single-node/observability.yaml']);
});
