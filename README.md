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
- `aggregates` to generate Axon aggregate code

The top-level generator supports three targets:

- `axon` for the Kotlin/Spring Boot backend
- `axon5` for the Axon Framework 5 backend generated directly from CodegenModel
- `refine` for the React refine frontend foundation

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

To jump directly into a target:

```bash
./test-codegen-model.sh axon
./test-codegen-model.sh axon5
./test-codegen-model.sh refine
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

- `config-loader.js`: reads `/workspace/codegen-model.json` first, falls back to `/workspace/config.json`, and returns the normalized `CodegenModel`.
- `codegen-model.js`: normalizes Event Modeling Toolkit `CodegenModel` input and can convert Martin-style `config.json` into the same shape for compatibility.

The `CodegenModel` keeps the domain model shape stable for code generation:

- `domain`: business domain from the toolkit model
- `rootPackage`: package root from the toolkit model
- `contexts`: bounded contexts from the toolkit model
- `aggregates`: aggregate identity, context, fields, and states
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

It generates Axon Framework 5.1.1 code using event-sourced entities, `EventAppender`, explicit event tags, composite `EventCriteria` derived from Medol slice tags, and JPA read-model projectors updated by inbound events. Concept states generate Kotlin enums, and fields such as `TrainingJob.State` are mapped to `TrainingJobState` with assignments derived from `stateChange`. Medol expressions such as `normalize(code)` become computed tag values on commands and events.

```bash
cd example
./test-codegen-model.sh axon5
```

Generated code is written to `example/generated/axon5` and uses Axon Framework 5 entity, command, event-tagging, and `EventAppender` APIs.

The Axon 5 skeleton includes Maven Wrapper, Docker Compose PostgreSQL, Flyway, Actuator, application configuration, a baseline migration, and a Spring context test.
