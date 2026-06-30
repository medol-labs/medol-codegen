// Generated from config.json by the refine generator.
import { IResourceItem } from "@refinedev/core";
import { FlaskConical, LayoutDashboard, Package } from "lucide-react";

export const resources: IResourceItem[] = [
  {
    name: "dashboard",
    list: "/dashboard",
    meta: {
      label: "Dashboard",
      i18nKey: "resources.dashboard.label",
      icon: <LayoutDashboard />,
    },
  },
<% chapters.forEach((chapter) => { -%>
  {
    name: "<%= chapter.name %>",
    meta: {
      label: "<%= chapter.label %>",
      i18nKey: "<%= chapter.i18nKey %>",
      icon: <FlaskConical />,
    },
  },
<% }) -%>
<% resources.forEach((resource) => { -%>
  {
    name: "<%= resource.name %>",
<% if (resource.canList) { -%>
    list: "/<%= resource.route %>",
<% } -%>
<% if (resource.createCommand) { -%>
    create: "/<%= resource.route %>/command/<%= resource.createCommand.route %>",
<% } -%>
<% if (resource.editCommand) { -%>
    edit: "/<%= resource.route %>/edit/:id",
<% } -%>
    show: "/<%= resource.route %>/show/:id",
    meta: {
<% if (resource.chapter) { -%>
      parent: "<%= resource.chapter.name %>",
<% } -%>
      label: "<%= resource.label %>",
      i18nKey: "<%= resource.i18nKey %>",
      icon: <Package />,
      tableName: "<%= resource.tableName %>",
      idField: "<%= resource.idField %>",
      idFields: <%- JSON.stringify(resource.idFields) %>,
      actionControls: <%- JSON.stringify(resource.actionControls) %>,
      aggregateRoute: "<%= resource.aggregateRoute %>",
      queryRoute: "<%= resource.queryRoute %>",
<% if (resource.commands.length > 0) { -%>
      commandRoute: "/<%= resource.route %>/:id/command/:command",
      commands: {
<% if (resource.createCommand) { -%>
        <%= resource.createCommand.name %>: { label: "<%= resource.createCommand.label %>", i18nKey: "<%= resource.createCommand.i18nKey %>", route: "/<%= resource.route %>/command/<%= resource.createCommand.route %>"<% if (resource.createCommand.enabledField) { %>, enabledField: "<%= resource.createCommand.enabledField %>"<% } %> },
<% } -%>
<% resource.routedCommands.forEach((command) => { -%>
        <%= command.name %>: { label: "<%= command.label %>", i18nKey: "<%= command.i18nKey %>", route: "/<%= resource.route %>/:id/command/<%= command.route %>"<% if (command.enabledField) { %>, enabledField: "<%= command.enabledField %>"<% } %> },
<% }) -%>
      },
<% } -%>
      canDelete: <%= resource.deleteCommand ? "true" : "false" %>,
    },
  },
<% }) -%>
];
