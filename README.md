# ES Code Generator

Custom Nebulit/Yeoman code generator for generating Axon-based Kotlin/Spring Boot and Refine code from Medol's `CodegenModel`.

The project wraps `nebulit/codegen` with a custom Docker image. The custom image bakes `.generator` and its `node_modules` into the image, then overrides `gen` so the default command runs the local generator.

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

Running `gen` with arguments delegates to the original `nebulit/codegen` command:

```bash
gen <args>
```

## Build Image

Build the custom image from this repository:

```bash
docker build -f Dockerfile.codegen -t es-codegen .
```

The image build:

- starts from `nebulit/codegen`
- installs `yo@5.1.0`
- sets `HOME=/tmp/yo-home`
- copies `.generator` to `/opt/codegen/.generator`
- runs `npm install` inside `/opt/codegen/.generator`
- wraps the original `gen` command as `gen-original`

## Run Container

From the project directory that contains `config.json`:

```bash
docker run -it \
  -p 3001:3000 \
  -v $PWD:/workspace \
  --name codegen \
  --rm \
  es-codegen
```

The mounted `/workspace` is where generated files are written.

## Generate Code

Inside the container:

```bash
gen
```

Then select:

- `Skeleton` to generate the base Kotlin/Spring Boot project structure
- `slices` to generate slice-level commands, events, read models, REST resources, processors, and specifications
- concept-root state generation is derived from Medol `concept` references and slice identity fields

The top-level generator supports three targets:

- `axon` for the Kotlin/Spring Boot backend
- `axon5` for the Axon Framework 5 backend generated directly from CodegenModel
- `refine` for the React refine frontend foundation

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

Some common string fields are treated as generated dictionaries before Medol has first-class enum syntax. The hardcoded dictionary lives in `.generator/common/core/field-options.js`. Matching fields generate Kotlin enum classes under `support.enums`, Zod `z.enum(...)` schemas, and Refine `Select` controls in command forms.

You can still invoke other generators explicitly:

```bash
gen @dilgerma/nebulit
gen /some/other/generator
```

## Configuration

The preferred generator input is the `CodegenModel` exported by Event Modeling Toolkit:

```text
/workspace/codegen-model.json
```

Model translations are a separate optional input. Put the exported translation
bundle next to the model as:

```text
/workspace/translations.json
```

The translation file is not merged into `codegen-model.json`; the generator only
loads it at generation time. The expected shape matches the MEDOL translation
download:

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

This generates Axon 4, Axon 5, and Refine projects without opening generator prompts.

Generated files are separated by target:

```text
example/generated/axon
example/generated/axon5
example/generated/refine
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
```

To test Refine generation with a separate translation bundle:

```bash
CODEGEN_TRANSLATIONS_PATH=/path/to/model-translations.zh-CN.json ./test-codegen-model.sh refine
```

To open the original interactive container shell:

```bash
./test-codegen-model.sh shell
```

Expected `codeGen` fields include:

```json
{
  "codeGen": {
    "application": "Quiz",
    "rootPackage": "de.nebulit.quiz"
  }
}
```

If only `config.json` exists and these fields are present, the generator uses them as defaults and only asks what should be generated.

## Core Codegen Model

The generator now uses the Event Modeling Toolkit `CodegenModel` as its core input:

```text
codegen-model.json -> common/core CodegenModel -> axon/refine generators
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

It generates Axon Framework 5.1.1 code using event-sourced entities, `EventAppender`, explicit event tags, composite `EventCriteria` derived from Medol slice tags, and JPA read-model projectors updated by inbound events. Concept states generate Kotlin enums, hardcoded dictionary fields generate Kotlin enums under `support.enums`, and fields such as `TrainingJob.State` are mapped to `TrainingJobState` with assignments derived from `stateChange`. Medol expressions such as `normalize(code)` become computed tag values on commands and events.

```bash
cd example
./test-codegen-model.sh axon5
```

Generated code is written to `example/generated/axon5` and uses Axon Framework 5 entity, command, event-tagging, and `EventAppender` APIs.

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
