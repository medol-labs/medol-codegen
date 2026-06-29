---
name: fix-generation-error
description: Diagnose and fix generated backend/frontend compile errors by tracing them to model or template causes.
---

# Fix Generation Error

Use this skill when generated code fails to compile, typecheck, or render.

## Classify The Failure

- Model conversion error: `codegen-model.json` lacks fields, tags, value type
  members, translations, or resources that MEDOL declares.
- Generator template error: every generated project with the same shape would
  produce invalid code.
- Generated project patch: only the current project needs a local workaround.
- Dependency/environment error: toolchain, node architecture, package install, or
  local runtime issue blocks verification.

## Procedure

1. Read the exact error and the generated file around the line number.
2. Find the model element that produced the broken symbol.
3. Check whether the symbol exists in `codegen-model.json`.
4. If missing from the model, fix MEDOL conversion.
5. If present but emitted incorrectly, fix the generator template.
6. Regenerate or patch the generated output only as needed to verify.
7. Run the smallest command that reproduces the original failure.

## Common Cases

- Command constructor uses a field name that is not in the generated command.
- State references display fields instead of identifiers.
- Value object forms flatten nested fields.
- Frontend treats a metadata field such as `domain` as a select option source.
- i18n bundle is merged into the model even though it should be standalone.
