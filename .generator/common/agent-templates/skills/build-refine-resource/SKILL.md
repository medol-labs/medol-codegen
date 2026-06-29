---
name: build-refine-resource
description: Implement a generated Refine resource, command form, value-object form, or i18n surface.
---

# Build Refine Resource

Use this skill for frontend work generated from MEDOL read models and commands.

## Read First

- Resource definitions in `src/providers/resources.tsx`.
- Data and command providers.
- Generated page templates for list, show, form, and command form.
- `src/domain/value-types.ts` and `src/domain/schemas.ts`.
- Translation provider and `translations.json` when present.

## Resource Rules

- List/show pages are driven by read models.
- Create/edit-like interactions that send commands should use command forms.
- Use `commandProvider` for command submission when the project defines it.
- Keep resource names stable so routes, breadcrumbs, and menu items translate.
- Empty table text, pagination labels, breadcrumbs, button text, and validation
  messages should flow through i18n.

## Value Object Rules

- Render value objects as nested fields using their declared properties.
- Render arrays of value objects with add/remove controls.
- Preserve booleans, numbers, arrays, and optional fields as typed controls.
- A plain textarea is only acceptable for a scalar string field, not a structured
  value object.

## Verification

- Run TypeScript typecheck or frontend build.
- Open the generated form when practical and confirm fields are populated from
  schema metadata.
