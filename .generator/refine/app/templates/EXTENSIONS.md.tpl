<!-- Generated from config.json by the refine generator. -->

# Frontend Extension Manifest

This document is generated for **<%= appTitle %>** (`<%= appName %>`). It is the
contract between MEDOL/codegen output and hand-written frontend customizations.

Generated files under `src/contexts/**`, `src/contexts/resources.tsx`, and
`src/contexts/routes.tsx` are fallback implementations and may be
overwritten by regeneration. Business customizations should live under
`src/domain/**`.

## Composition Model

```text
           MEDOL / Codegen Model
                    |
          Generator / Build time
                    |
      +-------------+-------------+
      |             |             |
  Blueprint     Extension      Override
      |             |             |
      +-------------+-------------+
                    |
            Static Composition
                    |
                 React App
```

- **Blueprint** describes planned typed composition units such as a resource page
  blueprint, toolbar blueprint, row-action blueprint, or field-renderer
  blueprint.
- **Extension** changes application behavior around generated defaults, such as
  filtering backend modules, selecting resources, resolving backend base URLs,
  adding route guards, and adding header actions.
- **Override** replaces a specific generated fallback, such as a resource page,
  menu icon, resource metadata entry, row action, or field renderer.

## Stable Hand-Written Locations

| Area | Stable path | Notes |
| --- | --- | --- |
| App extensions | `src/domain/app-extensions.tsx` | Provider, route guard, backend/module/resource filtering, header actions, access decisions |
| Page overrides | `src/domain/page-overrides.tsx` | Replace generated list/show/command pages by override key |
| Resource metadata overrides | `src/domain/resource-overrides.tsx` | Refine resource metadata overrides |
| Menu icons | `src/domain/menu-icons.tsx` | Dashboard/chapter/resource icon resolver |
| Custom composition | `src/app/composition/composition.custom.ts` | Typed extension, override, and blueprint registrations |
| Resolved composition | `src/app/composition/composition.resolved.ts` | Final generated + custom composition consumed by runtime code |
| Domain extensions | `src/domain/extensions/**` | Business-owned additive UI and behavior extensions |
| Domain overrides | `src/domain/overrides/**` | Business-owned replacement components and pages |
| Future blueprints | `src/domain/blueprints/**` | Planned typed resource/page/toolbar/field composition |
| Future override registry | `src/domain/overrides/**` | Planned typed override registry for static composition |

## Application Extension Points

| ID | Layer | Type signature | Default | Override path |
| --- | --- | --- | --- | --- |
<% extensionPoints.forEach((point) => { -%>
| `<%= point.id %>` | <%= point.area %> | `<%- point.typeSignature.replaceAll('|', '\\|') %>` | `<%= point.defaultImplementation %>` | `<%= point.overridePath %>` |
<% }) -%>

## Backend Modules

| Module | Label | Data provider | Home route |
| --- | --- | --- | --- |
<% backendModules.forEach((module) => { -%>
| `<%= module.name %>` | <%= module.label %> | `<%= module.dataProviderName %>` | `<%= module.homeRoute %>` |
<% }) -%>

## Resource Extension Points

<% resources.forEach((resource) => { -%>
### <%= resource.label %>

| Property | Value |
| --- | --- |
| Resource name | `<%= resource.name %>` |
| Route | `/<%= resource.route %>` |
| Backend module | `<%= resource.moduleName %>` |
| Data provider | `<%= resource.dataProviderName %>` |
| Generated list page | `<%= resource.canList ? `src/contexts/${resource.listPagePath}/${resource.listFile}.tsx` : '(not generated)' %>` |
| Generated show page | `src/contexts/<%= resource.showPagePath %>/<%= resource.showFile %>.tsx` |
| Resource metadata override | `resourceOverrides[{ name: "<%= resource.name %>" }]` |
| Menu icon request | `resolveMenuIcon({ type: "resource", name: "<%= resource.name %>", parent: "<%= resource.chapter?.name ?? '' %>" })` |

#### Page Overrides

| View | Override key | Generated fallback |
| --- | --- | --- |
<% resource.pageOverrides.forEach((page) => { -%>
| `<%= page.view %>` | `<%= page.key %>` | `<%= page.path %>` |
<% }) -%>

Example:

```tsx
// src/domain/page-overrides.tsx
import { My<%= resource.component %>List } from "./pages/my-<%= resource.route %>-list";

export const pageOverrides = {
  "<%= resource.route %>:list": <My<%= resource.component %>List />,
};
```

#### Commands And Row Actions

| Command | Override key | Generated fallback | Fields |
| --- | --- | --- | --- |
<% if (resource.commandOverrides.length === 0) { -%>
| _(none)_ | | | |
<% } -%>
<% resource.commandOverrides.forEach((command) => { -%>
| `<%= command.name %>` | `<%= command.overrideKey %>` | `<%= command.pagePath %>` | <%= command.fields.map((field) => `\`${field.name}\``).join(', ') || '_(none)_' %> |
<% }) -%>

#### Field Renderers

| Field | Type | Renderer override id | Default renderer |
| --- | --- | --- | --- |
<% if (resource.fieldOverrides.length === 0) { -%>
| _(none)_ | | | |
<% } -%>
<% resource.fieldOverrides.forEach((field) => { -%>
| `<%= field.name %>` | `<%= field.tsType %>` | `<%= resource.route %>:field:<%= field.name %>` | `<%= field.defaultRenderer %>` |
<% }) -%>

<% }) -%>

## Development Rules

- Keep generated fallback files under `src/contexts/**` reproducible.
- Put business-specific UI behavior in `src/domain/**`.
- If a customization should apply to every generated frontend, change the
  generator template instead of editing a generated project.
- Prefer typed extension points and explicit override keys over path-based
  imports from generated pages.
- Treat this manifest as the local checklist for what can be safely customized.
