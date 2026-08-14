// Generated from config.json by the refine generator.
import { IResourceItem } from "@refinedev/core";
import { FlaskConical, LayoutDashboard, Package } from "lucide-react";

export const backendModules = [
<% backendModules.forEach((module) => { -%>
  {
    name: "<%= module.name %>",
    label: "<%= module.label %>",
    dataProviderName: "<%= module.dataProviderName %>",
    apiUrl: import.meta.env.<%= module.envName %> ?? "<%= module.defaultApiUrl %>",
    homeRoute: "<%= module.homeRoute %>",
    resources: <%- JSON.stringify(module.resourceRoutes) %>,
  },
<% }) -%>
];

export const fileUploadCapability = <%- fileUploadCapability ? JSON.stringify(fileUploadCapability, null, 2) : 'null' %> as const;

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
      dataProviderName: "<%= resource.dataProviderName %>",
      moduleName: "<%= resource.moduleName %>",
      moduleLabel: "<%= resource.moduleLabel %>",
<% if (resource.commands.length > 0) { -%>
      commandRoute: "/<%= resource.route %>/:id/command/:command",
      commands: {
<% if (resource.createCommand) { -%>
        <%= resource.createCommand.name %>: { label: "<%= resource.createCommand.label %>", i18nKey: "<%= resource.createCommand.i18nKey %>", route: "/<%= resource.route %>/command/<%= resource.createCommand.route %>", dataProviderName: "<%= resource.createCommand.dataProviderName %>"<% if (resource.createCommand.enabledField) { %>, enabledField: "<%= resource.createCommand.enabledField %>"<% } %><% if (resource.createCommand.stateField) { %>, stateField: "<%= resource.createCommand.stateField %>"<% } %><% if (resource.createCommand.allowedStates?.length) { %>, allowedStates: <%- JSON.stringify(resource.createCommand.allowedStates) %><% } %> },
<% } -%>
<% resource.routedCommands.forEach((command) => { -%>
        <%= command.name %>: { label: "<%= command.label %>", i18nKey: "<%= command.i18nKey %>", route: "/<%= resource.route %>/:id/command/<%= command.route %>", dataProviderName: "<%= command.dataProviderName %>"<% if (command.enabledField) { %>, enabledField: "<%= command.enabledField %>"<% } %><% if (command.stateField) { %>, stateField: "<%= command.stateField %>"<% } %><% if (command.allowedStates?.length) { %>, allowedStates: <%- JSON.stringify(command.allowedStates) %><% } %> },
<% }) -%>
      },
<% } -%>
      canDelete: <%= resource.deleteCommand ? "true" : "false" %>,
    },
  },
<% }) -%>
];
