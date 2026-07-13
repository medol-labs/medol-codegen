# <%= domain %>

Generated from Medol CodegenModel for Axon Framework 5.1.1.

## Requirements

- Java 21
- Docker with Compose support

## Run

```bash
./mvnw spring-boot:run
```

<% if (modulePrefix) { -%>
Start PostgreSQL and Axon Server from the shared `../docker-compose.yml`, then run the module:

```bash
docker compose -f ../docker-compose.yml --profile axon-server up -d
./mvnw spring-boot:run
```
<% } else { -%>
Spring Boot starts PostgreSQL and Axon Server from `docker-compose.yml` automatically in the default Axon Server mode. To manage them manually:

```bash
docker compose --profile axon-server up -d
./mvnw spring-boot:run
```
<% } -%>

Health endpoint: `http://localhost:<%= appPort %>/actuator/health`

OpenAPI endpoints:

- Swagger UI: `http://localhost:<%= appPort %>/swagger-ui.html`
- OpenAPI JSON: `http://localhost:<%= appPort %>/v3/api-docs`

Default ports:

- Application: `<%= appPort %>`; override with `SERVER_PORT`
- PostgreSQL host port: `<%= dbPort %>`; override with `DB_PORT`
- PostgreSQL database: `<%= dbName %>`; override the full connection with `DB_URL`
- Axon Server UI: `http://localhost:8024`; override with `AXON_SERVER_HTTP_PORT`
- Axon Server gRPC: `localhost:8124`; override with `AXON_SERVER_SERVERS`

## Event Storage Mode

The default event storage is Axon Server, which supports multiple Axon event tags per event.

```bash
./mvnw spring-boot:run
```

Use the in-memory event store for local experiments or tests that should not connect to Axon Server:

```bash
<% if (modulePrefix) { -%>
docker compose -f ../docker-compose.yml up -d
<% } else { -%>
docker compose up -d
<% } -%>
SPRING_PROFILES_ACTIVE=inmemory ./mvnw spring-boot:run
```

Equivalent explicit properties:

```bash
MEDOL_AXON_EVENT_STORAGE=inmemory AXON_SERVER_ENABLED=false ./mvnw spring-boot:run
```

Use the experimental UmaDB event store adapter after installing the adapter jar from its source directory:

```bash
cd /path/to/axon-umadb-event-store
mvn install
```

Then run this application with the `umadb` profile:

```bash
SPRING_PROFILES_ACTIVE=umadb \
UMADB_ENDPOINT=http://localhost:8529 \
UMADB_DATABASE=<%= appName %>_events \
UMADB_APPEND_PATH=/api/v1/events/append \
./mvnw spring-boot:run
```

The UmaDB adapter is an experimental EventStorageEngine boundary. It includes HTTP append wiring, but production use still requires completing and validating source, stream, tracking token, and DCB consistency behavior against the selected UmaDB protocol.

## Seed Development Data

After the backend modules are running, seed demo data from the generated backend root:

```bash
node scripts/seed-dev-data.mjs
```

The seed tool reads `codegen-model.json`, calls generated command REST endpoints, and uses module-specific base URLs when deployments are present. Override URLs with environment variables named after deployment ids, for example `MY_BACKEND_URL=http://localhost:8080`.

Useful options:

```bash
node scripts/seed-dev-data.mjs --count 3
node scripts/seed-dev-data.mjs --mode workflow
node scripts/seed-dev-data.mjs --deployment MyBackend
node scripts/seed-dev-data.mjs --dry-run
```

## Build

```bash
./mvnw clean verify
```

## Container Image

Build a Docker image directly from Maven:

```bash
<% if (modulePrefix) { -%>
./mvnw -pl <%= modulePrefix || '.' %> jib:dockerBuild
<% } else { -%>
./mvnw -pl <module-name> jib:dockerBuild
<% } -%>
```

<% if (modulePrefix) { -%>
The generated image is `<%= "medol/" + appName %>:0.0.1-SNAPSHOT` and exposes port `<%= appPort %>`.
<% } else { -%>
The generated image is `medol/<module-name>:0.0.1-SNAPSHOT`.
<% } -%>
The container disables Spring Boot docker-compose integration; pass `DB_URL`, `DB_USERNAME`, and `DB_PASSWORD` for the runtime database.

Root package: `<%= rootPackage %>`

Generated command-side slices use Axon 5 event-sourced entities, explicit event tags, and composite event criteria derived from Medol slice tags. Concept states generate Kotlin enums, and `Concept.State` fields are updated from matching `stateChange` definitions. Read models generate JPA entities, repositories, REST resources, and event-handling projectors. Add production projection-table definitions under `src/main/resources/db/migration` when replacing Hibernate's generated schema.
