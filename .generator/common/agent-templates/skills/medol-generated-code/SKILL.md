---
name: medol-generated-code
description: Preserve generated-code boundaries while implementing behavior from a MEDOL model.
---

# MEDOL Generated Code

Use this skill whenever editing a project generated from MEDOL.

## Boundaries

- MEDOL is the source of truth for business structure.
- Generated files may be overwritten. Prefer changing MEDOL or generator
  templates for repeated changes.
- Manual code should be narrow, tested, and clearly tied to business behavior.
- Preserve existing generated package, route, resource, and type naming.
- Business rejection behavior should trace back to a MEDOL specification scenario.
- Read-model behavior should trace back to subscribed events and read model fields.
- UI labels should come from the generated i18n provider or standalone
  translation bundle.

## Decision Rule

- If the model is wrong, fix MEDOL or the model-to-codegen conversion.
- If every generated project would need the change, fix the generator template.
- If only this project needs extra business code, add focused application code.
- If existing generated code is broken, fix the generator and regenerate or
  patch the generated output only as a temporary unblocker.

## Generated Structure Hints

- Axon 5 backend slices are vertical: command, event, state, handler,
  projection, and API code are grouped by context and feature.
- Refine frontend resources are generated from read models and command forms.
- Value objects should remain structured in TypeScript and UI forms.
- Translation bundles should stay standalone when the project has
  `translations.json`.

## Escalation

If the requested behavior cannot be represented by existing MEDOL, propose a
MEDOL modeling change first.
