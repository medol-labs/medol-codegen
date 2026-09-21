# Generated Refine Frontend

This repository is a MEDOL-generated Refine / React frontend.

## Source Of Truth

- MEDOL and the codegen model define resources, routes, command forms, schemas,
  backend modules, and default pages.
- Generated fallback code lives under `src/contexts/**`,
  `src/contexts/resources.tsx`, `src/contexts/routes.tsx`, and
  `src/app/composition/composition.generated.ts`.
- Stable hand-written extension points live under `src/domain/**` and
  `src/app/composition/composition.custom.ts`.
- `EXTENSIONS.md` is generated and documents the extension/override contract for
  the selected frontend application.

## Extension Rules

- Do not edit generated `src/contexts/**` pages for business customization.
- Do not put business-owned files under `src/contexts/**`; that tree is
  generator-owned and may be deleted and regenerated.
- Use `src/domain/page-overrides.tsx` to replace generated list/show/command
  pages.
- Use `src/domain/resource-overrides.tsx` to adjust Refine resource metadata.
- Use `src/domain/menu-icons.tsx` to customize menu icons.
- Use `src/domain/app-extensions.tsx` for app providers, backend URL
  resolution, resource/module filtering, header actions, route guards, and extra
  access checks.
- Use `src/app/composition/composition.custom.ts` for typed static extension,
  override, and blueprint registrations.
- Runtime code should consume `src/app/composition/composition.resolved.ts`;
  custom code should not import generated composition inputs directly.
- If a UI change should apply to every generated frontend, change the generator
  template instead of only changing this generated project.

## Blueprint / Extension / Override

- Blueprint: typed composition units planned for resource pages, toolbars, row
  actions, field renderers, and static composition.
- Extension: app-level behavior that wraps or filters generated defaults.
- Override: specific replacement for a generated fallback.

Keep custom implementation in stable hand-written paths so regeneration can
update generated fallback pages without overwriting business code.

## Validation

```bash
pnpm run build
```
