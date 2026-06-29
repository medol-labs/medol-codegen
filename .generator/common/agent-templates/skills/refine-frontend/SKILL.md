---
name: refine-frontend
description: Implement or repair generated Refine frontend resources and forms.
---

# Refine Frontend

Use this skill when changing generated Refine resource, command form, provider,
or i18n code. Pair it with `build-refine-resource` for resource-level work.

## Rules

- Read generated resource metadata before editing pages.
- Use command forms for commands and resource pages for read models.
- Render value objects as structured nested form fields, not opaque textareas.
- Arrays of value objects need add/remove controls and stable nested paths.
- Use standalone translation bundles when present.
- Keep generated routes and resource names stable.
- Do not invent dropdown options from a `domain` string unless the model provides an option source.
- Use the generated command provider for commands and the default data provider
  configured by the project.
- Keep empty table, pagination, breadcrumb, and action labels inside the i18n
  provider instead of hardcoded English.

## Verification

Run the frontend build or typecheck after changes.
