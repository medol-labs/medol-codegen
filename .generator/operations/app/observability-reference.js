const {renderYaml} = require('./renderers/yaml');

// An independently deployable reference, deliberately separate from managed LGTM.
function observabilityReferenceFiles(root) {
    const images = {
        collector: 'otel/opentelemetry-collector-contrib:0.165.0',
        prometheus: 'prom/prometheus:v3.16.0',
        loki: 'grafana/loki:3.7.10',
        tempo: 'grafana/tempo:3.1.1',
        grafana: 'grafana/grafana:13.3.1'
    };
    const service = (name, command, volumes) => ({image: images[name], restart: 'unless-stopped',
        ...(command ? {command} : {}), volumes, mem_limit: name === 'collector' ? '512m' : '1g'});
    const compose = {
        services: {
            collector: {...service('collector', ['--config=/etc/otelcol/config.yml'], ['./collector.yml:/etc/otelcol/config.yml:ro']),
                ports: ['127.0.0.1:${OTLP_HTTP_PORT:-14318}:4318']},
            prometheus: service('prometheus', ['--config.file=/etc/prometheus/prometheus.yml', '--storage.tsdb.path=/prometheus',
                '--storage.tsdb.retention.time=7d', '--storage.tsdb.retention.size=5GB'],
            ['./prometheus.yml:/etc/prometheus/prometheus.yml:ro', './alerts.yml:/etc/prometheus/alerts.yml:ro', 'prometheus_data:/prometheus']),
            loki: service('loki', ['-config.file=/etc/loki/config.yml'], ['./loki.yml:/etc/loki/config.yml:ro', 'loki_data:/loki']),
            tempo: service('tempo', ['-target=all', '-config.file=/etc/tempo/config.yml'], ['./tempo.yml:/etc/tempo/config.yml:ro', 'tempo_data:/var/tempo']),
            grafana: {...service('grafana', null, ['grafana_data:/var/lib/grafana',
                './datasources.yml:/etc/grafana/provisioning/datasources/reference.yml:ro',
                './dashboards.yml:/etc/grafana/provisioning/dashboards/reference.yml:ro',
                './overview.json:/var/lib/grafana/dashboards/overview.json:ro']),
                ports: ['127.0.0.1:${GRAFANA_PORT:-13000}:3000'],
                environment: {GF_AUTH_ANONYMOUS_ENABLED: 'false', GF_USERS_ALLOW_SIGN_UP: 'false',
                    GF_SECURITY_ADMIN_USER: '${GRAFANA_ADMIN_USER:-admin}',
                    GF_SECURITY_ADMIN_PASSWORD: '${GRAFANA_ADMIN_PASSWORD:?Set GRAFANA_ADMIN_PASSWORD}',
                    GF_ANALYTICS_REPORTING_ENABLED: 'false'}}
        },
        volumes: {prometheus_data: {}, loki_data: {}, tempo_data: {}, grafana_data: {}}
    };
    const collector = {
        receivers: {otlp: {protocols: {http: {endpoint: '0.0.0.0:4318'}, grpc: {endpoint: '0.0.0.0:4317'}}}},
        processors: {memory_limiter: {check_interval: '1s', limit_mib: 384, spike_limit_mib: 64}, batch: {timeout: '5s'}},
        exporters: {
            prometheus: {endpoint: '0.0.0.0:8889', enable_open_metrics: true},
            'otlp_http/loki': {endpoint: 'http://loki:3100/otlp', retry_on_failure: {enabled: true, max_elapsed_time: '60s'},
                sending_queue: {enabled: true, queue_size: 1000}},
            'otlp_grpc/tempo': {endpoint: 'tempo:4317', tls: {insecure: true},
                retry_on_failure: {enabled: true, max_elapsed_time: '60s'}, sending_queue: {enabled: true, queue_size: 1000}}
        },
        extensions: {health_check: {endpoint: '0.0.0.0:13133'}},
        service: {extensions: ['health_check'], pipelines: Object.fromEntries(
            [['metrics', 'prometheus'], ['logs', 'otlp_http/loki'], ['traces', 'otlp_grpc/tempo']].map(([signal, exporter]) =>
                [signal, {receivers: ['otlp'], processors: ['memory_limiter', 'batch'], exporters: [exporter]}]))}
    };
    const prometheus = {global: {scrape_interval: '15s', evaluation_interval: '15s'}, rule_files: ['/etc/prometheus/alerts.yml'],
        scrape_configs: [
            {job_name: 'otel-applications', honor_labels: true, static_configs: [{targets: ['collector:8889']}]},
            {job_name: 'prometheus', static_configs: [{targets: ['localhost:9090']}]}
        ]};
    const loki = {auth_enabled: false, server: {http_listen_port: 3100},
        common: {instance_addr: '127.0.0.1', path_prefix: '/loki', replication_factor: 1,
            ring: {kvstore: {store: 'inmemory'}}, storage: {filesystem: {chunks_directory: '/loki/chunks', rules_directory: '/loki/rules'}}},
        schema_config: {configs: [{from: '2024-01-01', store: 'tsdb', object_store: 'filesystem', schema: 'v13',
            index: {prefix: 'index_', period: '24h'}}]},
        limits_config: {allow_structured_metadata: true, retention_period: '168h'},
        compactor: {working_directory: '/loki/compactor', retention_enabled: true, delete_request_store: 'filesystem'},
        analytics: {reporting_enabled: false}};
    const tempo = {server: {http_listen_port: 3200},
        distributor: {receivers: {otlp: {protocols: {grpc: {endpoint: '0.0.0.0:4317'}}}}},
        storage: {trace: {backend: 'local', wal: {path: '/var/tempo/wal'}, local: {path: '/var/tempo/blocks'}}},
        usage_report: {reporting_enabled: false}};
    const datasources = {apiVersion: 1, datasources: [
        {name: 'Prometheus', uid: 'prometheus', type: 'prometheus', access: 'proxy', url: 'http://prometheus:9090', isDefault: true},
        {name: 'Loki', uid: 'loki', type: 'loki', access: 'proxy', url: 'http://loki:3100'},
        {name: 'Tempo', uid: 'tempo', type: 'tempo', access: 'proxy', url: 'http://tempo:3200'}
    ]};
    const panel = (id, title, expression, x) => ({id, title, type: 'timeseries', gridPos: {x, y: 0, w: 12, h: 8},
        datasource: {type: 'prometheus', uid: 'prometheus'}, targets: [{refId: 'A', expr: expression}], fieldConfig: {defaults: {}, overrides: []}, options: {}});
    const dashboard = {uid: 'medol-reference', title: 'Telemetry Reference', schemaVersion: 39, version: 1, refresh: '30s',
        time: {from: 'now-1h', to: 'now'}, panels: [
            panel(1, 'Collector metric endpoint availability', 'up{job="otel-applications"}', 0),
            panel(2, 'Ingested samples per second', 'rate(prometheus_tsdb_head_samples_appended_total[5m])', 12)
        ]};
    const files = {
        'docker-compose.yml': renderYaml(compose), 'collector.yml': renderYaml(collector),
        'prometheus.yml': renderYaml(prometheus), 'loki.yml': renderYaml(loki), 'tempo.yml': renderYaml(tempo),
        'datasources.yml': renderYaml(datasources),
        'alerts.yml': renderYaml({groups: [{name: 'telemetry-reference', rules: [{alert: 'CollectorMetricsUnavailable',
            expr: 'up{job="otel-applications"} == 0', for: '2m', labels: {severity: 'warning'},
            annotations: {summary: 'Prometheus cannot scrape the Collector metric endpoint'}}]}]}),
        'dashboards.yml': renderYaml({apiVersion: 1, providers: [{name: 'reference', type: 'file',
            options: {path: '/var/lib/grafana/dashboards'}}]}),
        'overview.json': JSON.stringify(dashboard, null, 2) + '\n',
        'images.json': JSON.stringify(images, null, 2) + '\n',
        '.gitignore': '.env\n.env.*\n',
        '.env-example': 'GRAFANA_ADMIN_USER=admin\nGRAFANA_ADMIN_PASSWORD=\nGRAFANA_PORT=13000\nOTLP_HTTP_PORT=14318\n',
        'README.md': referenceReadme()
    };
    return Object.fromEntries(Object.entries(files).map(([name, content]) => [`${root}/reference/${name}`, content]));
}

function referenceReadme() {
    return `# OpenTelemetry + Grafana Reference

Independent, single-host development/test stack: Collector -> Prometheus (metrics), Loki (logs), Tempo (traces) -> Grafana. No Mimir, Kafka or application-specific logic. This reference does not replace managed LGTM automatically, and is not a production HA installation.

## Start manually

Run from this directory. Copy .env-example to .env and set a private GRAFANA_ADMIN_PASSWORD. Never commit .env. Then:

~~~sh
docker compose -p medol-telemetry-reference config --quiet
docker compose -p medol-telemetry-reference up -d
docker compose -p medol-telemetry-reference ps
~~~

Open http://127.0.0.1:13000 and sign in with your configured account. Prometheus, Loki, Tempo and the Telemetry Reference dashboard are provisioned automatically. Password environment variables initialize a new Grafana database only; changing them does not rotate an existing account password.

## Application connection

For native JVM applications on this host:

~~~sh
export MEDOL_OBSERVABILITY_ENABLED=true
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:14318
export MEDOL_OBSERVABILITY_ENVIRONMENT=local
export MEDOL_TRACING_SAMPLE_PROBABILITY=1.0
~~~

Generated applications share service.instance.id across metrics, logs and traces. Its fallback combines HOSTNAME (or local), application name and server port. Set OTEL_SERVICE_INSTANCE_ID to a unique deployment instance identifier (for example, a Pod UID) in multi-host deployments, especially when HOSTNAME is unset. Never reuse one identifier for multiple running replicas.

Restart the application. The generated Spring configuration appends /v1/logs, /v1/metrics and /v1/traces. Use 1.0 sampling only for verification; reduce it for normal operation. Never enable a second Java instrumentation agent blindly.

For generated operations choose observability.mode: external and set endpoint to the address reachable FROM the application. This avoids automatically deploying the managed LGTM stack. Container localhost is not the host: join the reference Compose network and use http://collector:4318, or explicitly provide a protected routable Collector. The default network is medol-telemetry-reference_default. An example operations config for containers sharing that network:

~~~yaml
environments:
  local:
    observability:
      mode: external
      endpoint: http://collector:4318
      samplingProbability: 0.1
~~~

Network attachment is a separate deployment action; setting the URL does not attach a container. Kubernetes and remote machines cannot reach these loopback bindings. Deploy a reachable Collector with TLS/authentication or provide an authenticated tunnel. Do not publish this unauthenticated OTLP receiver, Prometheus, Loki or Tempo to untrusted networks. Operations supplies artifacts; deployment remains manual or performed by simulation, not by generation.

## Verify

1. Send a real HTTP request to an instrumented service, then wait at least 45 seconds for export and scraping.
2. Grafana Explore / Prometheus: inspect target_info and search JVM/HTTP metrics. The reference dashboard checks ingestion infrastructure, not business workflow correctness.
3. Explore / Loki: select service_name; check the request's log timestamp and correlation ID.
4. Explore / Tempo: search resource.service.name and inspect HTTP spans. Axon asynchronous causation IDs are not automatically a distributed trace; full Axon propagation is separate work.
5. Stop collector and confirm business requests still succeed; restart it and confirm new telemetry arrives. In-memory queues are bounded and not lossless across restart.

~~~sh
docker compose -p medol-telemetry-reference logs --tail=100 collector
docker compose -p medol-telemetry-reference run --rm --no-deps collector validate --config=/etc/otelcol/config.yml
docker compose -p medol-telemetry-reference run --rm --no-deps --entrypoint promtool prometheus check config /etc/prometheus/prometheus.yml
~~~

CollectorMetricsUnavailable is evaluated in Prometheus; no Alertmanager or external notification receiver is configured. It detects a failed scrape, not individual application failure. No host/GPU agent or runtime-engine Python instrumentation is included.

## Storage and operations

Named volumes persist data. Prometheus is limited to seven days / 5GB; Loki compacts with seven-day retention. Tempo uses its version's default block retention; configure and capacity-test it before long-running use. Grafana dashboards/settings persist separately. Stop using docker compose -p medol-telemetry-reference down; add -v ONLY when intentionally deleting all monitoring data.

Images are pinned in docker-compose.yml and images.json. Use docker compose pull to fetch for the host architecture, or pull/save the listed images explicitly for your offline target architecture. This standalone reference is not part of the managed LGTM image bundle or simulation service selection. Copy the entire reference directory when deploying; mounting only docker-compose.yml is insufficient.

Before production: TLS/authentication, network policy, secrets, backups, storage capacity, explicit retention, HA, notification routing and sensitive-data filtering must be designed. Logs are not an audit store. Payload logging remains disabled by default; avoid sensitive attributes and high-cardinality metric labels.

References:
- https://opentelemetry.io/docs/collector/configuration/
- https://grafana.com/docs/loki/latest/send-data/otel/
- https://grafana.com/docs/tempo/latest/set-up-for-tracing/setup-tempo/plan/deployment-modes/
- https://prometheus.io/docs/prometheus/latest/configuration/configuration/
`;
}

module.exports = {observabilityReferenceFiles};
