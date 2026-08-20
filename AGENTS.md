# es-code-generator — AGENTS.md

`es-code-generator` contains Dockerized Yeoman generators used by the MEDOL pipeline. It reads a `codegen-model.json` from `/workspace` and generates Axon/Axon5 backend code and Refine frontend code.

## Project Rules

- Fix repeatable generated-code problems here, not by hand-patching generated projects.
- When a generated project is patched for framework-level behavior, mirror the same change in this generator before finishing the task. Framework-level means reusable generated scaffolding such as Refine data-table/filter behavior, generated providers/resources/forms, Spring/Axon skeletons, read model query support, logging, Docker compose, config templates, and other non-business-specific generated code.
- Keep generator logic generic. Do not add any concrete business system's rules directly to templates or writers.
- Do not encode concrete business-system behavior here, such as domain-specific commands, runtime rules, governance rules, adapter decisions, or resource names from the current example project. Put those in that system's MEDOL model or generated-project extension points; templates and writers should only consume generic model metadata.
- When a behavior is business-specific, express it in the relevant `.medol` model or a generated project's hand-written extension point.
- Axon 5 generated `context/...` code is overwriteable generated code. The generator should create stable hand-written extension points under `domain/...` and `infrastructure/...`.
- Prefer adding templates or writer helpers over scattering string literals across generator files.
- Do not commit generated scratch outputs under `example/generated-*` unless explicitly requested.

## Axon 5 Backend Generation

- Main generator code lives under `.generator/axon5/app/`.
- Skeleton/resources are written by `.generator/axon5/app/application-writer.js`.
- Command, decision, state, processor, readmodel, and test generation are split across the corresponding `*-writer.js` files.
- Shared cross-module code is generated under `shared-kernel`.
- Infrastructure port placeholders are generated under `src/main/kotlin/.../infrastructure/...`; they are intended for hand-written adapters.
- Domain decision override components are generated under `src/main/kotlin/.../domain/...`; they are intended for manual Spring components when default decision logic is not enough.
- If a field cannot be semantically derived, generate a clear TODO rather than inventing business data such as random IDs.

## Refine Frontend Generation

- Refine templates live under `.generator/refine/app/templates/`.
- Generated forms should honor MEDOL field semantics:
  - `uploadFile` means upload binary content first and send the returned file reference.
  - `file` means an existing file reference string.
- Avoid hard-coded resource or command names in templates. Use codegen model metadata and generated capabilities.
- UI changes that should survive regeneration belong in templates or stable extension points.

## Validation

Rebuild the generator image after generator changes:

```bash
docker build -f Dockerfile.codegen -t es-codegen .
```

Run generation checks from `example/`:

```bash
cd example
CODEGEN_MODEL_PATH=/Users/bryce/codes/medo/event-modeling/medol/examples/fl/codegen-model.json \
CODEGEN_OUTPUT_ROOT=generated-check \
CODEGEN_CONTAINER_NAME=codegen-check \
./test-codegen-model.sh axon5
```

For frontend generation:

```bash
cd example
CODEGEN_MODEL_PATH=/Users/bryce/codes/medo/event-modeling/medol/examples/fl/codegen-model.json \
CODEGEN_OUTPUT_ROOT=generated-refine-check \
CODEGEN_CONTAINER_NAME=codegen-refine-check \
./test-codegen-model.sh refine
```
