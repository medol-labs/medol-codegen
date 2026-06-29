---
name: build-slice
description: Plan implementation of one MEDOL slice across backend, frontend, tests, and translations.
---

# Build Slice

Use this skill when a task names a MEDOL slice or asks for an end-to-end feature.

## Classify The Slice

- State change: command -> event -> event-sourced state.
- Read model: event subscription -> projection -> query endpoint -> resource UI.
- Automation: event subscription -> command dispatch or policy action.
- Frontend command: command form, value object inputs, validation, and i18n.
- Cross-stack: combine the relevant skills in this order:
  `load-medol-context`, `axon5-backend/build-state-change`,
  `axon5-backend/build-read-model`, `build-refine-resource`,
  `fix-generation-error`.

## Implementation Order

1. Load MEDOL context and identify the exact slice.
2. Inspect existing generated conventions in the same context.
3. Implement backend behavior before frontend affordances when both are needed.
4. Add or update focused tests where the existing project has test scaffolding.
5. Run the smallest useful verification command.
6. Record task status in `.agent/tasks.json` when running under Ralph.

## Done Criteria

- Command and event names match MEDOL.
- Tags or aggregate boundaries match MEDOL.
- Read model fields match projected events.
- Refine resources and command forms use generated providers.
- Value objects stay structured.
- Translatable text flows through the project i18n mechanism.
