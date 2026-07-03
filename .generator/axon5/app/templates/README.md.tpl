# <%= domain %>

Generated from Medol CodegenModel for Axon Framework 5.1.1.

## Requirements

- Java 21
- Docker with Compose support

## Run

```bash
./mvnw spring-boot:run
```

Spring Boot starts PostgreSQL from `docker-compose.yml` automatically. To manage it manually:

```bash
docker compose up -d
./mvnw spring-boot:run
```

Health endpoint: `http://localhost:<%= appPort %>/actuator/health`

OpenAPI endpoints:

- Swagger UI: `http://localhost:<%= appPort %>/swagger-ui.html`
- OpenAPI JSON: `http://localhost:<%= appPort %>/v3/api-docs`

Default ports:

- Application: `<%= appPort %>`; override with `SERVER_PORT`
- PostgreSQL host port: `<%= dbPort %>`; override with `DB_PORT`
- PostgreSQL database: `<%= dbName %>`; override the full connection with `DB_URL`

## Seed Development Data

After the backend modules are running, seed demo data from the generated backend root:

```bash
node scripts/seed-dev-data.mjs
```

The seed tool reads `codegen-model.json`, calls generated command REST endpoints, and uses module-specific base URLs when deployments are present. Override URLs with environment variables such as `FLPLATFORM_BACKEND_URL=http://localhost:8080` or `FLRUNTIME_AGENT_URL=http://localhost:8081`.

Useful options:

```bash
node scripts/seed-dev-data.mjs --count 3
node scripts/seed-dev-data.mjs --mode workflow
node scripts/seed-dev-data.mjs --deployment FLPlatformBackend
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
