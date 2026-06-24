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

Health endpoint: `http://localhost:8080/actuator/health`

OpenAPI endpoints:

- Swagger UI: `http://localhost:8080/swagger-ui.html`
- OpenAPI JSON: `http://localhost:8080/v3/api-docs`

## Build

```bash
./mvnw clean verify
```

Root package: `<%= rootPackage %>`

Generated command-side slices use Axon 5 event-sourced entities, explicit event tags, and composite event criteria derived from Medol slice tags. Projection tables should be added under `src/main/resources/db/migration`.
