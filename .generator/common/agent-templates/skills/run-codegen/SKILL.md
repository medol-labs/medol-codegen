---
name: run-codegen
description: Regenerate backend or frontend projects from MEDOL codegen artifacts without losing intentional manual work.
---

# Run Codegen

Use this skill when the task requires regeneration or verification of generator
templates.

## Inputs

- `codegen-model.json` or a path supplied by `CODEGEN_MODEL_PATH`.
- `translations.json` or a path supplied by `CODEGEN_TRANSLATIONS_PATH`.
- Output root supplied by the generator command or project script.

## Procedure

1. Check git status before generation.
2. Identify whether the target is Axon 5, Refine, or both.
3. Prefer existing project scripts over ad hoc commands.
4. Pass standalone translations separately from the model when the generator
   supports it.
5. After generation, inspect diffs before running formatters or tests.
6. Do not overwrite unrelated user changes.

## Verification

- Backend: run Maven compile/tests.
- Frontend: run TypeScript build/typecheck.
- Generator: run syntax checks and focused generator tests.

## Ralph Note

When running from `.agent/ralph.sh`, include the exact generation command in the
task prompt so the agent does not guess.
