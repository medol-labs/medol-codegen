const serviceName = 'medol-observability';
const defaultImage = 'grafana/otel-lgtm:0.41.0';
const {observabilityReferenceFiles} = require('./observability-reference');

function resolveObservability(config = {}, environment = 'dev') {
    const mode = config.mode ?? 'disabled';
    if (!['disabled', 'external', 'managed'].includes(mode)) throw new Error(`Invalid observability mode: ${mode}`);
    if (mode === 'managed' && !['dev', 'local', 'test'].includes(environment)) {
        throw new Error('Managed LGTM is for dev/local/test only. Use an external observability backend for staging/production.');
    }
    const samplingProbability = config.samplingProbability ?? 0.1;
    if (typeof samplingProbability !== 'number' || samplingProbability < 0 || samplingProbability > 1) {
        throw new Error('observability.samplingProbability must be between 0 and 1.');
    }
    const endpoint = mode === 'managed' ? `http://${serviceName}:4318` : config.endpoint;
    if (mode === 'external') {
        let url;
        try { url = new URL(endpoint); } catch { throw new Error('External observability requires an absolute OTLP HTTP endpoint.'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
            throw new Error('Observability endpoint must be HTTP(S) without embedded credentials, query or fragment.');
        }
    }
    const image = config.image ?? defaultImage;
    if (mode === 'managed' && (!/:[^/:]+$|@sha256:[a-f0-9]{64}$/.test(image) || /:latest$/.test(image))) {
        throw new Error('Managed observability requires a pinned image tag or digest.');
    }
    return {mode, endpoint: endpoint?.replace(/\/+$/, ''), samplingProbability, image,
        storageSize: config.storageSize ?? '10Gi'};
}

function applicationObservability(application, observability, environment) {
    if (application.kind !== 'backend') return [];
    const enabled = observability.mode !== 'disabled';
    return [
        {name: 'MEDOL_OBSERVABILITY_ENABLED', value: String(enabled)},
        ...(enabled ? [
            {name: 'OTEL_EXPORTER_OTLP_ENDPOINT', value: observability.endpoint},
            {name: 'MEDOL_OBSERVABILITY_ENVIRONMENT', value: environment},
            {name: 'MEDOL_TRACING_SAMPLE_PROBABILITY', value: String(observability.samplingProbability)},
            {name: 'MEDOL_AXON_LOG_PAYLOAD_ENABLED', value: 'false'}
        ] : [])
    ];
}

function observabilityCompose(observability) {
    if (observability?.mode !== 'managed') return {};
    return {[serviceName]: {
        image: observability.image,
        restart: 'unless-stopped',
        networks: ['medol-network'],
        expose: ['4318', '3000'],
        ports: ['127.0.0.1:${MEDOL_GRAFANA_PORT:-3000}:3000'],
        environment: {GF_AUTH_ANONYMOUS_ENABLED: 'false'},
        volumes: ['medol_observability_data:/data'],
        mem_limit: '2g',
        cpus: '2.0'
    }};
}

function observabilityKubernetes(observability) {
    if (observability?.mode !== 'managed') return [];
    const labels = {app: serviceName};
    return [
        {apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: {name: serviceName},
            spec: {accessModes: ['ReadWriteOnce'], resources: {requests: {storage: observability.storageSize}}}},
        {apiVersion: 'apps/v1', kind: 'Deployment', metadata: {name: serviceName}, spec: {
            replicas: 1, strategy: {type: 'Recreate'}, selector: {matchLabels: labels},
            template: {metadata: {labels}, spec: {containers: [{name: serviceName, image: observability.image,
                ports: [{name: 'otlp-http', containerPort: 4318}, {name: 'grafana', containerPort: 3000}],
                env: [{name: 'GF_AUTH_ANONYMOUS_ENABLED', value: 'false'}],
                resources: {requests: {cpu: '250m', memory: '512Mi'}, limits: {cpu: '2', memory: '2Gi'}},
                volumeMounts: [{name: 'data', mountPath: '/data'}]}],
                volumes: [{name: 'data', persistentVolumeClaim: {claimName: serviceName}}]}}
        }},
        {apiVersion: 'v1', kind: 'Service', metadata: {name: serviceName}, spec: {type: 'ClusterIP', selector: labels,
            ports: [{name: 'otlp-http', port: 4318, targetPort: 4318}, {name: 'grafana', port: 3000, targetPort: 3000}]}}
    ];
}

function observabilityFiles(model, environment) {
    const config = resolveObservability({...model.observability, ...model.environments.find(e => e.name === environment)?.observability}, environment);
    const root = `operations/observability/${environment}`;
    return {
        ...observabilityReferenceFiles(root),
        [`${root}/configuration.json`]: JSON.stringify(config, null, 2) + '\n',
        [`${root}/README.md`]: `# Observability\n\nMode: ${config.mode}. OTLP protocol: HTTP/protobuf.\n\nSee [OpenTelemetry + Grafana reference](reference/README.md) for independently configured Collector, Prometheus, Loki, Tempo and Grafana services (no Mimir). This is a separate opt-in stack, not an automatic replacement of managed LGTM.\n\n`
            + 'Configure operations/config/<environment>.yml and regenerate operations. Configuration examples:\n\n'
            + '```yaml\nenvironments:\n  local:\n    observability:\n      mode: managed # disabled | external | managed\n      samplingProbability: 0.1\n      storageSize: 10Gi\n```\n\n'
            + '```yaml\nobservability:\n  mode: external\n  endpoint: https://collector.example.com:4318\n```\n\n'
            + 'Managed mode is a development/test LGTM reference, not production HA. It is included in generated Compose and Kubernetes/K3s resources; operations does not execute deployments. Simulation may deploy those resources using its existing environment/deploy stages. When selecting individual services, include medol-observability or use external mode.\n\n'
            + 'Compose Grafana binds to loopback port 3000 (override MEDOL_GRAFANA_PORT per site). Kubernetes uses ClusterIP: kubectl -n <namespace> port-forward service/medol-observability 3000:3000. Reference image login is admin/admin; change it immediately. Never expose this test stack or its unauthenticated OTLP receiver to untrusted networks.\n\n'
            + 'Each isolated deployment site in managed mode gets its own stack. For centralized multi-site observations use external mode with a reachable Collector endpoint; container DNS is not cross-host routing. Native JVM processes must use a reachable endpoint, not the Compose service DNS.\n\n'
            + 'Spring applications export metrics, traces and logs when MEDOL_OBSERVABILITY_ENABLED=true. Endpoint paths /v1/metrics, /v1/traces and /v1/logs are appended to the base URL. Disabled mode performs no telemetry export. Do not install a second Java auto-instrumentation agent on top without reviewing duplicate instrumentation.\n\n'
            + 'Switching to disabled requires regeneration and application restart. It does not delete previously deployed collectors or data volumes; retire those explicitly through your deployment workflow.\n\n'
            + 'Use Spring management OTLP headers via private configuration or Secrets for authenticated external collectors. Do not put tokens in endpoint URLs or committed files. Production TLS, collector authentication, retention and alert routing belong to the external platform.\n\n'
            + 'Axon payload/metadata logging is disabled by default; opt-in debug output may contain sensitive business data. Audit retention is separate from telemetry retention. No model execution graph, Axon token-lag monitor, host/GPU metrics or Python/browser instrumentation is implied by this baseline.\n\n'
            + 'Verify a request in Grafana Explore: logs by service name, HTTP spans in Tempo, and JVM/HTTP metrics in Prometheus. Stop the collector and confirm business requests still succeed. Generated configs are not proof that telemetry was received.\n\n'
            + 'References: https://github.com/grafana/docker-otel-lgtm and https://docs.spring.io/spring-boot/3.5/reference/actuator/observability.html\n'
    };
}

module.exports = {resolveObservability, applicationObservability, observabilityCompose, observabilityKubernetes, observabilityFiles};
