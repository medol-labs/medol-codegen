// Generated from config.json by the refine generator.
import type { FrontendCompositionGenerated } from "@/platform/composition";

export const frontendCompositionGenerated: FrontendCompositionGenerated = {
  targets: [
<% resources.forEach((resource) => { -%>
    {
      id: "resource:<%= resource.route %>",
      kind: "resource",
      resource: "<%= resource.route %>",
      slots: ["resource.metadata", "navigation.menuIcon"],
    },
<% resource.pageOverrides.forEach((page) => { -%>
    {
      id: "page:<%= resource.route %>:<%= page.view %>",
      kind: "page",
      resource: "<%= resource.route %>",
      view: "<%= page.view %>",
      fallback: "<%= page.path %>",
      slots: ["header.before", "header.after", "content.before", "content.after", "footer"],
    },
<% }) -%>
    {
      id: "toolbar:<%= resource.route %>:list",
      kind: "action",
      resource: "<%= resource.route %>",
      view: "list",
      slots: ["toolbar.before", "toolbar.actions", "toolbar.after"],
    },
    {
      id: "row-actions:<%= resource.route %>:list",
      kind: "action",
      resource: "<%= resource.route %>",
      view: "list",
      slots: ["rowActions.before", "rowActions.after"],
    },
<% resource.fieldOverrides.forEach((field) => { -%>
    {
      id: "field:<%= resource.route %>:display:<%= field.name %>",
      kind: "field",
      resource: "<%= resource.route %>",
      field: "<%= field.name %>",
      slots: ["field.before", "field.after", "field.renderer"],
    },
<% }) -%>
<% resource.commandOverrides.forEach((command) => { -%>
    {
      id: "behavior:<%= resource.route %>:<%= command.name %>",
      kind: "behavior",
      resource: "<%= resource.route %>",
      view: "<%= command.name %>",
      slots: ["form.beforeSubmit", "form.afterSubmit", "form.validate", "form.mapCommandPayload"],
    },
<% }) -%>
<% }) -%>
  ],
  blueprints: [],
  extensions: [],
  overrides: [],
};
