# ES Code Generator

Custom Yeoman code generator for generating Axon-based Kotlin/Spring Boot and Refine code from Medol's `CodegenModel`.

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

The top-level generator supports four targets:

- `axon` for the Kotlin/Spring Boot backend
- `axon5` for the Axon Framework 5 backend generated directly from CodegenModel
- `refine` for the React refine frontend foundation
- `deploy` for Docker Compose, APISIX, Kubernetes, and K3s deployment artifacts

When `codegen-model.json` contains lifecycle `transitions`, the Axon 5 generator
uses them to generate command state guards for transitions with an inferred
`from` state. Read-model fields such as `canSubmit`, `canPause`,
`availableActions`, and `blockedReason` are preserved by the Refine generator as
resource action-control metadata and row command buttons are disabled when a
matching `canXxx` field is false.

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

You can invoke the bundled generator explicitly:

```bash
gen /opt/codegen/.generator/app/ --generator refine --generator-type all
```

## Generate Deploy Artifacts

The `deploy` generator reads the same `codegen-model.json` and derives an intermediate `DeploymentModel` before rendering platform files. The model keeps application topology, infrastructure, gateway routes, images, ports, health checks, environment defaults, and per-environment overrides separate from renderer-specific details.

Create a deployment workspace yourself, put `codegen-model.json` there, then run the generator from that directory. The generator creates one directory for the selected environment under the current directory.

```bash
mkdir -p deployment
cp /path/to/codegen-model.json deployment/codegen-model.json
cd deployment
gen /opt/codegen/.generator/app/ --generator deploy --generator-type all --environment dev
```

Supported deploy targets are:

- `all`: deployment model, APISIX, Docker Compose, Kubernetes, and K3s
- `model`: only `<environment>/deployment-model.json`
- `apisix`: APISIX standalone/declarative configuration
- `docker-compose`: Docker Compose deployment files
- `kubernetes`: Kubernetes base manifests plus the selected environment kustomization
- `k3s`: K3s-flavored manifests rendered from the same Kubernetes renderer

Generated deployment files are written under the selected environment directory:

```text
deployment/
  codegen-model.json
  deploy.config.json
  dev/
    deployment-model.json
    README.md
    .env.example
    docker-compose/docker-compose.yml
    infrastructure/apisix/config.yaml
    infrastructure/apisix/apisix.yaml
    infrastructure/postgres/init/01-create-databases.sql
    kubernetes/base/
    kubernetes/environments/dev/
    k3s/base/
    k3s/environments/dev/
```

APISIX is generated in standalone mode with declarative YAML and Admin API disabled. Docker Compose is the primary runnable target and includes generated backend services, the generated frontend console, runtime dependencies such as PostgreSQL and UMA DB, optional/profiled Axon Server, optional Redis, volumes, networks, environment placeholders, health checks, and service startup dependencies.

Deployment overrides can be supplied with `deploy.config.json` or `deployment.config.json` in the deployment workspace:

```json
{
  "deployment": {
    "imagePrefix": "registry.example.com/team",
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

The generated files use placeholder environment references only. Real passwords, tokens, certificates, and Kubernetes Secret objects must be supplied by the deployment environment.

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
`src/i18n/messages.ts`. The generator does not load
`model-translations.zh-CN.json` directly.

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

This generates Axon 4, Axon 5, Refine, and Deploy projects without opening generator prompts.

Generated files are separated by target:

```text
example/generated/axon
example/generated/axon5
example/generated/refine
example/generated/deploy/dev
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
./test-codegen-model.sh deploy
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
codegen-model.json -> common/core CodegenModel -> axon/refine/deploy generators
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

Axon currently consumes the backward-compatible config emitted by the core layer, so existing templates continue to work. Refine consumes the normalized `CodegenModel` directly for resource generation.

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
