# ES Code Generator

Custom Yeoman code generator for generating Axon-based Kotlin/Spring Boot, Refine frontend, operations, and simulation artifacts from Medol's `CodegenModel`.

The project ships a standalone Docker image built from the official Node slim base image. The image bakes `.generator` into `/opt/codegen/.generator` and exposes a small local `gen` runner that executes the bundled generator directly.

## Image Layout

Inside the container:

```text
/opt/codegen/.generator    custom generator bundled in the image
/workspace                 mounted project workspace
```

Running `gen` with no arguments is equivalent to:

```bash
gen /opt/codegen/.generator/app/
```

The container default command is `/bin/bash`; enter the container first, then run `gen` manually. Running `gen` with a generator path executes that generator through the local Yeoman runner:

```bash
gen /opt/codegen/.generator/app/ --generator axon5 --generator-type Skeleton
```

## Build Image

Build the custom image from this repository:

```bash
docker build -f Dockerfile.codegen -t es-codegen .
```

The image build:

- starts from `node:22-bookworm-slim`
- sets `HOME=/tmp/yo-home`
- copies `.generator` to `/opt/codegen/.generator`
- runs `npm ci --omit=dev` inside `/opt/codegen/.generator`
- installs the local `gen` runner at `/usr/local/bin/gen`
- starts an interactive bash shell by default

## Run Container

From the project directory that contains `codegen-model.json`:

```bash
docker run -it \
  -p 3001:3000 \
  -v $PWD:/workspace \
  --name codegen \
  --rm \
  es-codegen
```

This opens a bash shell in the container. The mounted `/workspace` is where generated files are written.

## Generate Code

Inside the container:

```bash
gen
```

Then select:

- `Skeleton` to generate the base Kotlin/Spring Boot project structure
- `slices` to generate slice-level commands, events, read models, REST resources, processors, and specifications
- concept-root state generation is derived from Medol `concept` references and slice identity fields

For Axon 5 slice generation, choosing `slices` opens a context filter, a keyword
filter, and then a multi-select slice list. The same selection can be scripted:

```bash
gen /opt/codegen/.generator/app/ --generator axon5 --generator-type slices --slice-filter RuntimeAgent
gen /opt/codegen/.generator/app/ --generator axon5 --generator-type slices --context RuntimeOnboarding --slices VerifyRuntimeInfrastructure,DeployRuntimeAgent
gen /opt/codegen/.generator/app/ --generator axon5 --generator-type slices --all-slices
```

The top-level generator supports five targets:

- `axon` for the Kotlin/Spring Boot backend
- `axon5` for the Axon Framework 5 backend generated directly from CodegenModel
- `refine` for the React refine frontend foundation
- `operations` for Docker Compose, APISIX, Kubernetes, K3s, and Harbor operations artifacts
- `simulation` for deterministic business-flow simulation artifacts

## Initialize A Generated System Workspace

Run `init` from a system root to create the standard `.medol` workspace, fetch
the latest CodegenModel, and create root `README.md`, `AGENTS.md`, and
`.gitignore` templates:

```bash
cd federation-learning
init --workspace-id <medol-workspace-id> --language zh-CN
```

`init` writes the fetched model to `.medol/codegen-model.json` and creates
`.medol/medol.yml` when it is missing. It keeps existing template files unless
`--force` is passed. The default language is `zh-CN`, so this is equivalent:

```bash
init <medol-workspace-id>
```

To refresh only the model later:

```bash
update --workspace-id <medol-workspace-id>
```

`update` also defaults to `.medol/codegen-model.json`; use `--output` only when
you intentionally want a different path.

When `codegen-model.json` contains lifecycle `transitions`, the Axon 5 generator
uses them to generate command state guards for transitions with an inferred
`from` state. Read-model fields such as `canSubmit`, `canPause`,
`availableActions`, and `blockedReason` are preserved by the Refine generator as
resource action-control metadata and row command buttons are disabled when a
matching `canXxx` field is false.

MEDOL provides a built-in Identity Access Management (IAM) model. Business
models normally only define actors; import the built-in IAM model from MEDOL
when the generated system should include IAM command/read-model slices. The
Axon 5 generator consumes the resulting `codegen-model.json` and derives actor
roles plus command/read-model permissions from the combined model.

Import IAM at the top of the MEDOL source and choose the deployment module:

```medol
import identity-access-management as Iam deploy FederationLearningSupport
```

Then export the CodegenModel normally:

```bash
cd ../medol
npm --silent run medol:to-codegen-model -- examples/fl/federation-learning.medol > examples/fl/codegen-model.json
```

Embedded IAM writes its login resource and authorization bootstrap into the
selected deployment module while shared JWT/current-user runtime code remains in
`shared-kernel`. If the IAM import is omitted, the generator does not add the
IAM domain model.

Generated services can switch authentication with `MEDOL_SECURITY_PROVIDER`.
`local` validates tokens issued by the generated `/api/auth/login` resource.
`supabase` validates Supabase JWTs through the configured issuer or JWK set.
When embedded IAM is present, the generated login and current-user resolver use
the `AuthIdentityRepository` port. The default
`BuiltinReadModelAuthIdentityRepository` maps that port to the IAM read model
repositories generated from the embedded IAM model, and is guarded with
`@ConditionalOnMissingBean` so projects can provide their own repository
implementation for an existing account store, read model, or external identity
service without renaming MEDOL fields or adopting the default storage tables.

Admin bootstrap is explicit and disabled by default:

```bash
MEDOL_SECURITY_ADMIN_BOOTSTRAP_ENABLED=true
MEDOL_SECURITY_ADMIN_BOOTSTRAP_SETUP_TOKEN=change-me
```

For `local`, initialize the first administrator with
`POST /api/auth/setup-admin` using `setupToken`, `username`, and `password`.
For `supabase`, create or invite the user in Supabase first, then call
`POST /api/auth/setup-supabase-admin` with the Supabase bearer token and the
same `setupToken`. Both endpoints first initialize the permissions, roles, and
role grants derived from the combined model, then emit IAM commands to register
and bind the administrator. They do not write storage tables directly, and both
reject the request after an `ADMIN` user exists.

For the frontend target, run `gen`, choose `refine`, then choose:

- `Skeleton` to copy the React refine/shadcn frontend foundation into the current workspace
- `all` to generate these config-driven files:
- `src/providers/resources.tsx`
- `src/providers/app-router.tsx`
- `src/pages/<screen>/list.tsx`
- `src/pages/<screen>/create.tsx`
- `src/pages/<screen>/edit.tsx`
- `src/pages/<screen>/show.tsx`
- command pages for outbound screen commands

The refine generator derives navigation resources from `slices[].readmodels` where `listElement` is `true`. Commands never create menu resources; event dependencies attach selected commands to the matching list as create, edit, delete, or row actions.

The refine generator is template-based, mirroring the Axon generator layout:

- `templates/src/providers/resources.tsx.tpl`
- `templates/src/providers/app-router.tsx.tpl`
- `templates/src/pages/list.tsx.tpl`
- `templates/src/pages/form.tsx.tpl`
- `templates/src/pages/command-form.tsx.tpl`
- `templates/src/pages/show.tsx.tpl`
- `templates/src/pages/index.ts.tpl`

Create/edit/delete capabilities are generated only when matching event-modeling commands exist. Commands marked with `startsLifecycle` generate the resource create form with `useCommandForm`; item commands generate command routes and `CommandButton` actions.

When generating `all`, `resources`, `router`, or `pages`, the refine generator prompts for the commands to generate. Unselected commands are omitted from resource metadata, routes, list action buttons, and command form pages.

Constrained values should be modeled explicitly in Medol with `enum` or scalar `oneOf` value types. The Refine generator renders those static fields as `Select` controls and emits matching Zod schemas. For runtime-maintained option sets, mark a string field with `dictionary "DICTIONARY_CODE"` and provide a standard `DictionaryValueCatalog` read model with `dictionaryCode`, `valueCode`, `displayName`, optional `displayOrder`, and either `state` or `active`. The generated form submits the selected `valueCode` and queries the catalog by `dictionaryCode`. `.generator/common/core/field-options.js` only preserves compatibility with explicit option metadata in the codegen model; it no longer carries business-specific field-name dictionaries.

Command forms also understand Medol derived lookup fields as display snapshots. When a command has an id field plus a derived field such as `selectedCustomerName: String? display derived from CustomerCatalog.customerName by customerId`, the generated form renders only the `customerId` selector. Selecting a customer submits both `customerId` and the hidden `selectedCustomerName` snapshot, copied from `CustomerCatalog.customerName`. Multiple snapshot fields may point at the same selector key with the same `by customerId` lookup; the form copies each snapshot from the selected read-model record. These snapshot values are for display/audit payloads only and should not be used for authorization or business invariants.

You can invoke the bundled generator explicitly:

```bash
gen /opt/codegen/.generator/app/ --generator refine --generator-type all
```

## Generate operations artifacts

The `operations` generator reads the same `codegen-model.json` and derives an intermediate `OperationsModel` before rendering platform files. The model keeps application topology, infrastructure, gateway routes, images, ports, health checks, environment defaults, and per-environment overrides separate from renderer-specific details.

Run generators from the generated system root. By default the generator reads
`.medol/codegen-model.json` and `.medol/medol.yml` from the current directory.
Legacy `codegen-model.json` at the current directory root is still accepted for
compatibility.

Example system workspace:

```text
federation-learning/
  .medol/
    codegen-model.json
    medol.yml
  federation-learning-platform/
  federation-learning-console/
  federation-learning-runtime-engine/  # hand-written business runtime, not generated by the simulation generator
  operations/
```

Use `.medol/medol.yml` to route generator output:

```yaml
name: Federation Learning
generators:
  axon5:
    output: federation-learning-platform
  refine:
    output: federation-learning-console
  operations:
    output: .
operations:
  registry:
    host: registry.internal:5000
    scheme: http
    namespace: team
    insecure: true
```

With this layout, run from the system root:

```bash
cd federation-learning
gen /opt/codegen/.generator/app/ --generator operations --generator-type all --environment dev
```

`simulation` is a separate generator target. Configure it only when the system
needs generated simulation artifacts, for example `output: simulation-service`.
Do not point it at a hand-written runtime or engine project.

The top-level generator also creates system-level `README.md`, `AGENTS.md`,
and `.gitignore` in the current directory when they do not already exist. Use
`--skip-workspace-files` to skip those files, or `workspaceFiles.overwrite:
true` in `.medol/medol.yml` when you intentionally want to regenerate them.

Supported operations targets are:

- `all`: operations model, APISIX, Docker Compose, Kubernetes, K3s, Harbor, and zot
- `model`: only `<environment>/operations-model.json`
- `apisix`: APISIX standalone/declarative configuration
- `docker-compose`: Docker Compose operations files
- `kubernetes`: Kubernetes base manifests plus the selected environment kustomization
- `k3s`: K3s-flavored manifests rendered from the same Kubernetes renderer
- `harbor`: optional Harbor registry operations assets
- `zot`: optional lightweight OCI registry operations assets with ARM64-friendly container deployment

Generated operations files are written under `operations/<environment>`:

```text
federation-learning/
  .medol/codegen-model.json
  .medol/medol.yml
  operations/
    dev/
      operations-model.json
      README.md
      .env-example
      docker-compose/docker-compose.yml
      infrastructure/apisix/config.yaml
      infrastructure/apisix/apisix.yaml
      infrastructure/postgres/init/01-create-databases.sql
      kubernetes/base/
      kubernetes/environments/dev/
      k3s/base/
      k3s/environments/dev/
      harbor/
      zot/
```

APISIX is generated in standalone mode with declarative YAML and Admin API disabled. Docker Compose is the primary runnable target and includes generated backend services, the generated frontend console, runtime dependencies such as PostgreSQL and UMA DB, optional/profiled Axon Server, optional Redis, volumes, networks, environment placeholders, health checks, and service startup dependencies.

Operations overrides can be supplied in `.medol/medol.yml` under the
`operations` key. Legacy `operations.config.json` at the current directory root
is still accepted for compatibility:

```json
{
  "operations": {
    "registry": {
      "host": "registry.internal:5000",
      "scheme": "http",
      "namespace": "team",
      "insecure": true
    },
    "imageTag": "2026.08.25",
    "eventStorage": "umadb",
    "gateway": {
      "routes": {
        "federation-service": {
          "path": "/api/federations"
        }
      }
    },
    "infrastructure": {
      "redis": { "enabled": true },
      "axonServer": { "enabled": false }
    },
    "environments": {
      "prod": {
        "variables": { "GATEWAY_PORT": "80" },
        "applicationOverrides": {
          "federation-service": { "replicas": 3 }
        }
      }
    }
  }
}
```

When `operations.registry` is omitted, generated image names keep the default
`medol/<service>:<tag>` format. When it is present, the generator derives
`imagePrefix` as `<host>/<namespace>`, emits a Kubernetes/K3s
`environments/<environment>-registry` overlay for application and runtime-engine
image overrides, and emits a K3s `cluster/registries.yaml` file for
HTTP/insecure registry access. The default `environments/<environment>` overlay
continues to use `medol/<service>:<tag>` so deployments can still run without a
registry by importing local images.

The generated files use placeholder environment references only. Real passwords, tokens, certificates, and Kubernetes Secret objects must be supplied by the operations environment.

## Generate Simulation Service

The `simulation` generator reads the same `codegen-model.json` and derives a renderer-neutral `SimulationModel` before writing an executable service. The service calls a running business system through its public command APIs and executes DSL-derived business flows in order.

Create a simulation service directory yourself, put `codegen-model.json` there, then run the generator from that directory. Files are generated directly into the current directory.

```bash
mkdir -p generated/simulation-service
cp /path/to/codegen-model.json generated/simulation-service/codegen-model.json
cd generated/simulation-service
gen /opt/codegen/.generator/app/ --generator simulation --generator-type all
```

Supported simulation targets are:

- `all`: service project, simulation model, runtime, deterministic data generator, and scenario JSON files
- `model`: only `simulation-model.json`
- `service`: runnable HTTP service and CLI
- `runtime`: compatibility alias for `service`
- `scenarios`: one JSON file per discovered scenario

Generated files are written under the current directory:

```text
package.json
Dockerfile
.env-example
README.md
simulation-model.json
scenarios/<scenario-id>.json
src/
  server.js
  cli.js
  runtime/
    business-client.js
    context.js
    data-generator.js
    event-observer.js
    model-loader.js
    runner.js
```

Pass `--output-root <relative-path>` when you explicitly want this structure rendered into a subdirectory.

Start the service and point it at the business system:

```bash
BUSINESS_BASE_URL=http://localhost:8080 npm start
```

Run a scenario through HTTP:

```bash
curl -sS -X POST http://localhost:3199/simulations/<scenario-id>/run \
  -H 'content-type: application/json' \
  -d '{"seed":1001}'
```

Or run it directly as a CLI:

```bash
npm run simulate -- <scenario-id> --seed 1001
```

For Axon 5 generated backends, command endpoints are derived from the generated resources:

```text
/<concept-route>/<command-route>
```

For example, `Register Organization` on concept `Organization` becomes:

```text
POST /organization/registerorganization
```

If contexts are hosted by different backend services, configure per-context base URLs:

```bash
CONTEXT_BASE_URLS='{"OrganizationManagement":"http://localhost:8081","TrainingOrchestration":"http://localhost:8082"}' npm start
```

Automatic steps are not called directly. They wait for the events that the business system should produce. The generated service can receive events via webhook:

```bash
curl -sS -X POST http://localhost:3199/events \
  -H 'content-type: application/json' \
  -d '{"eventName":"OrganizationRegistered","payload":{"organizationId":"..."}}'
```

Set `STRICT_EVENTS=true` when missing expected events should fail the simulation. Set `WAIT_FOR_EVENTS=true` when a non-strict run should still wait for webhook or observer events before moving on. Without either flag, the service executes command steps against the business system and records event observation as skipped immediately when no observer is connected.

Simulation behavior can be tuned with `simulation.config.json` or `simulation/simulation.config.json` in the workspace:

```json
{
  "simulation": {
    "seed": 1001,
    "maxDepth": 8,
    "maxScenarios": 80
  }
}
```

Scenario discovery starts from lifecycle-starting commands and walks the graph from command to expected event, then event to downstream command through automations, policies, processors, and direct dependencies. `COMMAND` steps call the business system; `AUTOMATIC` steps do not resend the command and instead wait for the automation/policy/processor-produced target event.

The first phase records specification `given` state as unsupported preparation metadata. It does not insert historical events, seed databases, run Playwright, or call an LLM.

## Configuration

The preferred generator input is the `CodegenModel` exported by Event Modeling Toolkit:

```text
/workspace/codegen-model.json
```

When the Medol app is running, it exposes the current workspace as CodegenModel JSON:

```bash
GET /api/modeling/codegen-model?workspaceId=<workspace-id>
```

If `workspaceId` is omitted, Medol exports the current workspace. The endpoint also accepts `locale` or `language` to include stored model translations.

Inside the code generator container, update that JSON in the mounted workspace:

```bash
update
update <workspace-id>
update --workspace-id <workspace-id>
```

To include stored MEDOL model translations in the exported CodegenModel, pass a locale:

```bash
update --locale zh-CN
update --language zh-CN
CODEGEN_MODEL_LOCALE=zh-CN update
MEDOL_LOCALE=zh-CN update
```

This calls the MEDOL endpoint with `locale=zh-CN` and writes a single
`codegen-model.json` containing `locales`, `defaultLocale`, and `translations`.
The Refine generator reads those fields and emits the generated
`src/i18n/messages.ts`. The `update` command prints the number of merged
translations for the requested locale. If that number is `0`, the generated
locale will intentionally fall back to English labels.

When a local translation export is available, `update` and the generator also
merge these files from the workspace as fallback translations. Translations
already returned by Medol's `codegen-model` endpoint stay authoritative:

```text
translations.json
model-translations.json
model-translations.<locale>.json
```

You can also provide an explicit bundle:

```bash
update --language zh-CN --translations ./model-translations.zh-CN.json
```

An explicit bundle is treated as an intentional override.

The default Medol base URL from the container is `http://host.docker.internal:5172`. Override it when needed:

```bash
MEDOL_BASE_URL=http://host.docker.internal:5187 update <workspace-id>
```

To inspect available workspace ids from inside the container:

```bash
update --list-workspaces
```

The example test script exposes the same Docker-based update step:

```bash
cd example
./test-codegen-model.sh update
./test-codegen-model.sh update <workspace-id>
```

Set `CODEGEN_MODEL_LOCALE` or `MEDOL_WORKSPACE_ID` for translated or environment-driven exports:

```bash
CODEGEN_MODEL_LOCALE=zh-CN ./test-codegen-model.sh update
MEDOL_WORKSPACE_ID=<workspace-id> ./test-codegen-model.sh update
```

As a compatibility fallback, model translations may also be provided as a
separate optional input next to the model:

```text
/workspace/translations.json
```

The expected shape matches the MEDOL translation download:

```json
{
  "locales": ["zh-CN"],
  "defaultLocale": "zh-CN",
  "translations": {
    "zh-CN": {
      "Submit": "提交"
    }
  }
}
```

For compatibility, the generator still falls back to:

```text
/workspace/config.json
```

To test non-interactive Docker generation with `example/codegen-model.json`:

```bash
docker build -f Dockerfile.codegen -t es-codegen .
cd example
./test-codegen-model.sh
```

This generates Axon 4, Axon 5, Refine, operations, and Simulation artifacts without opening generator prompts.

Generated files are separated by target:

```text
example/generated/axon
example/generated/axon5
example/generated/refine
example/generated/operations/dev
example/generated/simulation-service
```

Skeleton generation also writes a runtime-neutral agent kit into the generated
project:

```text
.agent/
  README.md
  ralph.sh
  ralph-codex.js
  ralph-claude.js
  ralph-opencode.js
  sync-planned-slices.js
  tasks.json
  lib/
    ralph-runtime.js
  skills/
    medol-generated-code/
    load-medol-context/
    sync-planned-slices/
    run-codegen/
    build-slice/
    axon5-backend/
      build-state-change/
      build-read-model/
      build-automation/
    refine-frontend/
    build-refine-resource/
    fix-generation-error/
    update-task-status/
```

These files are modeled after the Eventmodelers build-kit pattern of shipping
project-local agent guidance plus a small Ralph task loop, but they are not tied
to Claude Code. Codex, Claude Code, OpenCode, or another programming agent can
read `.agent/skills` before extending the generated code.

Add queued tasks to `.agent/tasks.json`, then run one iteration:

```bash
node .agent/ralph-codex.js
```

Or run the local loop:

```bash
bash .agent/ralph.sh
```

Set `RALPH_RUNTIME=claude` or `RALPH_RUNTIME=opencode`, or provide
`AGENT_COMMAND` to connect a different local programming agent. For OpenCode,
use `AGENT_COMMAND` because command-line flags vary by installation. If no
runtime is available, Ralph writes the prepared prompt into `.agent/out/` and
marks the task as `needs-runtime`.

To consume slice implementation status stored by MEDOL, sync planned slices into
Ralph tasks:

```bash
MEDOL_WORKSPACE_ID=<workspace-id> node .agent/sync-planned-slices.js
```

Or sync before each Ralph loop iteration:

```bash
RALPH_SYNC_PLANNED=1 MEDOL_WORKSPACE_ID=<workspace-id> bash .agent/ralph.sh
```

To jump directly into a target:

```bash
./test-codegen-model.sh axon
./test-codegen-model.sh axon5
./test-codegen-model.sh refine
./test-codegen-model.sh operations
./test-codegen-model.sh simulation
```

To test Refine generation with a separate translation bundle:

```bash
CODEGEN_TRANSLATIONS_PATH=/path/to/model-translations.zh-CN.json ./test-codegen-model.sh refine
```

To open an interactive generator container shell:

```bash
./test-codegen-model.sh shell
```

Expected `codeGen` fields include:

```json
{
  "codeGen": {
    "application": "Quiz",
    "rootPackage": "tech.medo.quiz"
  }
}
```

If only `config.json` exists and these fields are present, the generator uses them as defaults and only asks what should be generated.

## Core Codegen Model

The generator now uses the Event Modeling Toolkit `CodegenModel` as its core input:

```text
codegen-model.json -> common/core CodegenModel -> axon/refine/operations/simulation generators
```

Legacy `config.json` is converted into the same core model only as a fallback.

The core layer lives in:

```text
.generator/common/core/
```

It covers:

- `config-loader.js`: reads `/workspace/codegen-model.json` first, falls back to `/workspace/config.json`, optionally overlays `/workspace/translations.json`, and returns the normalized `CodegenModel`.
- `codegen-model.js`: normalizes Event Modeling Toolkit `CodegenModel` input and can convert Martin-style `config.json` into the same shape for compatibility.

The `CodegenModel` keeps the domain model shape stable for code generation:

- `domain`: business domain from the toolkit model
- `rootPackage`: package root from the toolkit model
- `contexts`: bounded contexts from the toolkit model
- `aggregates`: legacy compatibility field; new Medol models use context-level slices and `concept` references instead
- `slices`: commands, events, read models, screens, processors, specifications, actors, hotspots, and state changes
- `dependencies`: normalized inbound/outbound element links while preserving the legacy `type` field for compatibility
- `fields`: normalized field metadata, including id/generated/technical/query flags and source mapping metadata

Axon currently consumes the backward-compatible config emitted by the core layer, so existing templates continue to work. Refine, Deploy, and Simulation consume the normalized `CodegenModel` directly for generation.

## Updating The Generator

Because `.generator` is copied into the image, changes to generator code require rebuilding the image:

```bash
docker build -f Dockerfile.codegen -t es-codegen .
```

You do not need to run `npm install` manually on the host. Generator dependencies are installed during image build.
# Axon Framework 5 generator

The `axon5` generator consumes Medol's `codegen-model.json` directly. It does not read or create the legacy `config.json` compatibility model.

It generates Axon Framework 5.1.1 code using event-sourced entities, `EventAppender`, explicit event tags, composite `EventCriteria` derived from Medol slice tags, and JPA read-model projectors updated by inbound events. Concept states and Medol enum value types generate Kotlin enums, and fields such as `TrainingJob.State` are mapped to `TrainingJobState` with assignments derived from `stateChange`. Medol expressions such as `normalize(code)` become computed tag values on commands and events.

```bash
cd example
./test-codegen-model.sh axon5
```

Generated code is written to `example/generated/axon5` and uses Axon Framework 5 entity, command, event-tagging, and `EventAppender` APIs.

Within each generated backend module, the Spring Boot `Application.kt` entrypoint stays in the root package while generated bounded-context code is written under `src/main/kotlin/<root-package>/context` and context tests under `src/test/kotlin/<root-package>/context`. The skeleton also creates sibling `src/main/kotlin/<root-package>/infrastructure` and `src/test/kotlin/<root-package>/infrastructure` directories for hand-written adapters. For every modeled command with `port`, it creates matching adapter placeholder directories such as `infrastructure/secondary/<context>/<concept>/<port>` using package-safe lowercase names without a trailing `service` suffix. The generator only creates directories there, so adapter implementations can be maintained without being overwritten by subsequent slice generation.

The Axon 5 skeleton includes Maven Wrapper, Docker Compose PostgreSQL, Flyway, Actuator, application configuration, a baseline migration, and a Spring context test. Generated read-model list endpoints use Spring Data `Pageable` and return `Page<T>` by default; the Refine command data provider sends `page`, `size`, and `sort` query parameters and unwraps Spring Page responses.

### Axon 5 identity modeling

The generator supports two Axon 5 identity styles:

- Independent event-sourced entity: model the relationship or entity as its own `concept`, mark every identity field with `id`, and use explicit `tags` when the identity is composite.
- Concept-root state: place slices at context level and reference them from the same `concept` block. Slices in the same concept share one generated Axon selection and state class, so command handlers load the same concept-root state.

The federation-learning sample currently uses the concept-root style for membership management. This keeps all participant commands on the `Federation` concept and generates a `FederationState` that tracks child membership status by organization:

```medol
slice InviteParticipant {
  command InviteParticipant {
    federationId: UUID id technical
    organizationId: UUID
    invitationNote: String
  }

  event ParticipantInvited {
    federationId: UUID id technical
    organizationId: UUID
    invitationNote: String
  }

  state Invited
}

slice ApproveParticipant {
  command ApproveParticipant {
    federationId: UUID id technical
    organizationId: UUID
    approvalNote: String?
  }

  event ParticipantJoined {
    federationId: UUID id technical
    organizationId: UUID
    approvalNote: String?
  }

  state Active
}

concept Federation {
  state Draft
  state Active

  slice InviteParticipant
  slice ApproveParticipant
}
```

This generates `FederationSelection` and `FederationState`, with all concept slices resolving criteria from the concept identity. When concept events include `organizationId` and the slice declares `state`, the concept state maintains membership status in a generated `members: MutableMap<UUID, String>`.

Use this style when the concept state is expected to hold and validate the child collection in memory. For large collections or high write concurrency, prefer the independent entity style plus read models, policies, or quota/counter concepts for cross-membership constraints.

For the independent entity style, model the relationship as its own concept and use composite tags:

```medol
slice InviteParticipant {
  tags {
    federationId
    organizationId
  }

  command InviteParticipant {
    federationId: UUID id technical
    organizationId: UUID id technical
    invitationNote: String
  }

  event ParticipantInvited {
    federationId: UUID id technical
    organizationId: UUID id technical
    invitationNote: String
  }
}

concept FederationMembership {
  state Invited
  state Active

  slice InviteParticipant
  slice ApproveParticipant
}
```

This generates a composite Axon entity selection and matching event tags. If a slice does not declare `tags`, the Axon 5 generator now falls back to all command fields marked `id`; if there are no `id` fields, it falls back to the first command field.
