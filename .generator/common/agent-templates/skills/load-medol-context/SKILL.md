---
name: load-medol-context
description: Load generated project context from MEDOL artifacts before implementing a slice or fixing generated code.
---

# Load MEDOL Context

Use this skill before changing generated or generated-adjacent code. It turns a
user request into a concrete MEDOL slice, concept, command, read model, value
object, and file set.

## Inputs To Locate

- `codegen-model.json`: normalized model used by generators.
- `translations.json`: optional standalone i18n bundle used by frontend generation.
- `.agent/tasks.json`: current Ralph tasks and status notes.
- `README.md`: generated project commands and stack notes.
- Backend files under `src/main/kotlin` for Axon 5 projects.
- Frontend files under `src` for Refine projects.

## Procedure

1. Read `codegen-model.json` first when present.
2. Identify the bounded context, slice, concept, command, event, read model, and
   value types named by the task.
3. Check the generated file naming convention before creating new files.
4. For backend work, find command classes, event classes, state classes,
   handlers, projections, and tests for the same context.
5. For frontend work, find resources, command forms, value-type helpers,
   providers, and i18n messages.
6. If behavior is absent from the model, call out the MEDOL modeling gap. Do not
   hide missing domain behavior in ad hoc generated code.
7. Prefer changes to MEDOL or generator templates when the same fix must survive
   regeneration.

## Output Checklist

- Relevant bounded context and slice.
- Commands and events involved.
- Aggregate or consistency boundary tags.
- Read models and projections involved.
- Value objects and nested fields involved.
- Files to edit.
- Smallest useful verification command.

## Pitfalls

- Do not infer a foreign key from a display field such as `name`.
- Do not flatten a value object into a textarea when the model contains fields.
- Do not treat `domain` metadata as a dropdown source unless a real option
  source exists in the generated project.
- Do not add manual translations to generated messages when
  `translations.json` is the intended source.
