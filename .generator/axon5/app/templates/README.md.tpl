# <%= domain %>

Generated from Medol CodegenModel for Axon Framework 5.1.1.

## Requirements

- Java 21
- Docker with Compose support

## Run

<% if (modulePrefix) { -%>
Run this module from the generated multi-module root so Maven can include the sibling `shared-kernel` and `axon-event-storage-umadb` modules in the reactor. Spring Boot uses this module's own `docker-compose.yml`:

```bash
cd ..
cp <%= modulePrefix %>/.env-example <%= modulePrefix %>/.env
./mvnw -pl <%= modulePrefix %> -am spring-boot:run
```
<% } else if (hasInfra) { -%>
Run a backend module from this generated multi-module root. Each deployment module owns its own `docker-compose.yml`:

```bash
cp <module-name>/.env-example <module-name>/.env
./mvnw -pl <module-name> -am spring-boot:run
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
- PostgreSQL host port: `<%= dbPort %>`; override with `DB_PORT` in this module's `.env`
- PostgreSQL database: `<%= dbName %>`; override the full connection with `DB_URL`
- UmaDB host port: `<%= umadbPort %>`; override with `UMADB_PORT` in this module's `.env`
- Axon Server UI: `http://localhost:8024`; override with `AXON_SERVER_HTTP_PORT`
- Axon Server gRPC: `localhost:8124`; override with `AXON_SERVER_SERVERS`

## Auth

Generated services support two regular authentication providers:

- `MEDOL_SECURITY_PROVIDER=local` uses generated local login and system JWTs.
- `MEDOL_SECURITY_PROVIDER=supabase` validates Supabase JWTs.

When the generated model includes `IdentityAccessManagement`, auth identity and permission checks are resolved through the generated IAM read models by the built-in `AuthIdentityRepository` adapter. The security layer does not read IAM tables directly; it depends on the repository boundary so generated projects can replace or extend the adapter when their IAM model changes.

### User Source

`RegisterUserAccount.userSource` is an optional technical field used to record where an account came from. It is written to the user registration event and projected to `UserAccountCatalog.userSource` for audit, filtering, and operations visibility.

Normal generated user-maintenance forms leave `userSource` empty and do not require an operator to fill it. Fixed auth flows set it explicitly:

- Local admin setup writes `LOCAL`.
- Supabase admin setup writes `SUPABASE`.
- Portal SSO writes `MEDOL_SECURITY_PORTAL_SSO_USER_SOURCE`, defaulting to `PORTAL_SSO`.

Authorization decisions should still be based on roles and permissions, not on `userSource` alone.

### Portal SSO Exchange

Portal SSO is implemented as a fixed auth endpoint, not as a Medol-modeled command page:

```http
POST /api/auth/exchange-portal-jwt
```

Request body:

```json
{
  "portalJwt": "<portal-issued-jwt>",
  "requestedPath": "/target-page",
  "systemSource": "PORTAL"
}
```

Enable and configure it with:

```bash
MEDOL_SECURITY_PORTAL_SSO_ENABLED=true
MEDOL_SECURITY_PORTAL_SSO_JWT_SECRET=<portal-hs256-secret>
MEDOL_SECURITY_PORTAL_SSO_ISSUER=<optional-issuer>
MEDOL_SECURITY_PORTAL_SSO_AUDIENCE=<optional-audience>
MEDOL_SECURITY_PORTAL_SSO_DEFAULT_REDIRECT_PATH=/
MEDOL_SECURITY_PORTAL_SSO_USER_SOURCE=PORTAL_SSO
```

The endpoint validates the portal JWT signature, expiration, and optional issuer/audience. It maps the portal subject to `providerSubject=portal|<sub>`.

If the user already exists, the service returns a normal system JWT and does not change the existing account source. If the user does not exist, the service registers the account through the generated `RegisterUserAccount` command with `passwordHash=null` and `userSource` from request `systemSource`; when `systemSource` is omitted, it falls back to `MEDOL_SECURITY_PORTAL_SSO_USER_SOURCE`. The response then returns a system JWT with no permissions so the frontend can show an "awaiting permission assignment" state. An administrator must assign roles before the user can access protected menus and commands.

When `MEDOL_SECURITY_PROVIDER=supabase` and Portal SSO is enabled, the backend accepts both Supabase JWTs and generated system JWTs for subsequent API calls. This allows a portal login handoff to coexist with Supabase mode.

## Event Storage Mode

The default event storage is Axon Server, which supports multiple Axon event tags per event.

```bash
<% if (modulePrefix) { -%>
cd ..
./mvnw -pl <%= modulePrefix %> -am spring-boot:run
<% } else if (hasInfra) { -%>
./mvnw -pl <module-name> -am spring-boot:run
<% } else { -%>
./mvnw spring-boot:run
<% } -%>
```

Use the in-memory event store for local experiments or tests that should not connect to Axon Server:

```bash
<% if (modulePrefix) { -%>
cd ..
MEDOL_AXON_EVENT_STORAGE=inmemory AXON_SERVER_ENABLED=false ./mvnw -pl <%= modulePrefix %> -am spring-boot:run
<% } else if (hasInfra) { -%>
MEDOL_AXON_EVENT_STORAGE=inmemory AXON_SERVER_ENABLED=false ./mvnw -pl <module-name> -am spring-boot:run
<% } else { -%>
MEDOL_AXON_EVENT_STORAGE=inmemory AXON_SERVER_ENABLED=false ./mvnw spring-boot:run
<% } -%>
```

<% if (hasInfra) { -%>
Use the generated UmaDB DCB event store adapter from the `axon-event-storage-umadb` module with this deployment module's `.env` file:

```bash
<% if (modulePrefix) { -%>
cd ..
cp <%= modulePrefix %>/.env-example <%= modulePrefix %>/.env
docker compose -f <%= modulePrefix %>/docker-compose.yml up -d postgres umadb
./mvnw -pl <%= modulePrefix %> -am spring-boot:run
<% } else if (hasInfra) { -%>
cp <module-name>/.env-example <module-name>/.env
docker compose -f <module-name>/docker-compose.yml up -d postgres umadb
./mvnw -pl <module-name> -am spring-boot:run
<% } else { -%>
cp .env-example .env
docker compose up -d postgres umadb
./mvnw spring-boot:run
<% } -%>
```

To run the generated application as a container instead of `spring-boot:run`:

```bash
<% if (modulePrefix) { -%>
cd ..
docker compose -f <%= modulePrefix %>/docker-compose.yml up -d <%= appName %>
<% } else if (hasInfra) { -%>
docker compose -f <module-name>/docker-compose.yml up -d <module-name>
<% } else { -%>
docker compose up -d <%= appName %>
<% } -%>
```

The UmaDB adapter implements Axon Framework's `EventStorageEngine` boundary over UmaDB's official `umadb.v1.DCB` gRPC service: events are stored with DCB tags, Axon event criteria are mapped to UmaDB queries, conditional append uses UmaDB's DCB conflict condition, and source/stream tokens use Axon's global next-position semantics. Axon processor checkpoints still use the generated `token_entry` table; UmaDB's optional `TrackingInfo` API is not used as an Axon token store.

<% } -%>
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

## Clean Development Docker Data

To reset local Docker Compose databases and event-store volumes for generated deployment modules:

```bash
node scripts/clean-docker-compose-data.mjs --yes
```

The script discovers `docker-compose.yml` files under the generated backend root and module directories, then runs `docker compose -f <file> down -v --remove-orphans`. Preview the affected compose files without deleting data:

```bash
node scripts/clean-docker-compose-data.mjs --dry-run
```

## Build

```bash
<% if (modulePrefix) { -%>
cd ..
./mvnw -pl <%= modulePrefix %> -am clean verify
<% } else if (hasInfra) { -%>
./mvnw -pl <module-name> -am clean verify
<% } else { -%>
./mvnw clean verify
<% } -%>
```

## Container Image

Build all generated deployment images:

```bash
<% if (modulePrefix) { -%>
cd ..
node scripts/build-images.mjs --module <%= modulePrefix %>
<% } else if (hasInfra) { -%>
node scripts/build-images.mjs
<% } else { -%>
node scripts/build-images.mjs
<% } -%>
```

Images default to `linux/amd64`. Override the target CPU architecture when needed:

```bash
node scripts/build-images.mjs --platform linux/arm64
```

Export the generated images to a Docker archive for offline transfer:

```bash
<% if (modulePrefix) { -%>
cd ..
node scripts/export-images.mjs --module <%= modulePrefix %>
<% } else { -%>
node scripts/export-images.mjs
<% } -%>
```

Pull and export Docker Compose dependency images, such as databases and event stores, for the same target platform:

```bash
node scripts/export-dependency-images.mjs --platform linux/amd64 --output dependency-images.tar
```

Preview the discovered dependency images:

```bash
node scripts/dependency-images.mjs list
```

Collect deployment Docker Compose files and matching `.env-example` files into one folder:

```bash
node scripts/collect-deployment-compose-files.mjs --clean
```

Import the archive on another machine:

```bash
node scripts/import-images.mjs --file <%= imageTarName %>
docker load -i dependency-images.tar
```

Build and export in one command:

```bash
<% if (modulePrefix) { -%>
cd ..
node scripts/image-bundle.mjs all --module <%= modulePrefix %>
<% } else { -%>
node scripts/image-bundle.mjs all
<% } -%>
```

The build script uses Maven/Jib under the hood:

```bash
<% if (modulePrefix) { -%>
cd ..
./mvnw -pl <%= modulePrefix %> -am -DskipTests install
./mvnw -pl <%= modulePrefix %> -DskipTests -Djib.container.platform.os=linux -Djib.container.platform.architecture=amd64 com.google.cloud.tools:jib-maven-plugin:3.4.5:dockerBuild
<% } else if (hasInfra) { -%>
./mvnw -pl <module-name> -am -DskipTests install
./mvnw -pl <module-name> -DskipTests -Djib.container.platform.os=linux -Djib.container.platform.architecture=amd64 com.google.cloud.tools:jib-maven-plugin:3.4.5:dockerBuild
<% } else { -%>
./mvnw -DskipTests -Djib.container.platform.os=linux -Djib.container.platform.architecture=amd64 com.google.cloud.tools:jib-maven-plugin:3.4.5:dockerBuild
<% } -%>
```

<% if (modulePrefix) { -%>
The generated image is `<%= "medol/" + appName %>:0.0.1-SNAPSHOT` and exposes port `<%= appPort %>`.
<% } else { -%>
The generated images are `medol/<module-name>:0.0.1-SNAPSHOT`.
<% } -%>
The container disables Spring Boot docker-compose integration; pass `DB_URL`, `DB_USERNAME`, and `DB_PASSWORD` for the runtime database.

Root package: `<%= rootPackage %>`

Generated command-side slices use Axon 5 event-sourced entities, explicit event tags, and composite event criteria derived from Medol slice tags. Concept states generate Kotlin enums, and `Concept.State` fields are updated from matching `stateChange` definitions. Read models generate JPA entities, repositories, REST resources, and event-handling projectors. Add production projection-table definitions under `src/main/resources/db/migration` when replacing Hibernate's generated schema.
