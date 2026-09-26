// Generated from config.json by the refine generator.
import { IResourceItem } from "@refinedev/core";
import { FlaskConical, LayoutDashboard, Package } from "lucide-react";
import { resolveMenuIcon } from "@/domain/menu-icons";
import { getAppConfig } from "@/providers/app-config";

export const backendModules = [
<% backendModules.forEach((module) => { -%>
  {
    name: "<%= module.name %>",
    label: "<%= module.label %>",
    dataProviderName: "<%= module.dataProviderName %>",
    apiUrl: getAppConfig("<%= module.envName %>", "<%= module.defaultApiUrl %>"),
    homeRoute: "<%= module.homeRoute %>",
    resources: <%- JSON.stringify(module.resourceRoutes) %>,
  },
<% }) -%>
];

export const authBackendModule =
  backendModules.find((module) => module.name === "<%= authBackendModule.name %>")
  ?? backendModules[0];

export const fileUploadCapability = <%- fileUploadCapability ? `${JSON.stringify(fileUploadCapability, null, 2)} as const` : 'null' %>;

export const resources: IResourceItem[] = [
  {
    name: "dashboard",
    list: "/dashboard",
    meta: {
      label: "Dashboard",
      i18nKey: "resources.dashboard.label",
      icon: resolveMenuIcon({ type: "dashboard", name: "dashboard", fallback: <LayoutDashboard /> }),
    },
  },
<% chapters.forEach((chapter) => { -%>
  {
    name: "<%= chapter.name %>",
    meta: {
      label: "<%= chapter.label %>",
      i18nKey: "<%= chapter.i18nKey %>",
      icon: resolveMenuIcon({ type: "chapter", name: "<%= chapter.name %>", label: "<%= chapter.label %>", fallback: <FlaskConical /> }),
    },
  },
<% }) -%>
<% resources.forEach((resource) => { -%>
  {
    name: "<%= resource.name %>",
<% if (resource.canList) { -%>
    list: "/<%= resource.route %>",
<% } -%>
<% if (resource.createCommand?.requiresPage) { -%>
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
      icon: resolveMenuIcon({ type: "resource", name: "<%= resource.name %>", label: "<%= resource.label %>", parent: <%- resource.chapter ? `"${resource.chapter.name}"` : 'undefined' %>, fallback: <Package /> }),
      tableName: "<%= resource.tableName %>",
      idField: "<%= resource.idField %>",
      idFields: <%- JSON.stringify(resource.idFields) %>,
      queryFields: <%- JSON.stringify(resource.queryFields) %>,
      actionControls: <%- JSON.stringify(resource.actionControls) %>,
      aggregateRoute: "<%= resource.aggregateRoute %>",
      queryRoute: "<%= resource.queryRoute %>",
      dataProviderName: "<%= resource.dataProviderName %>",
      moduleName: "<%= resource.moduleName %>",
      moduleLabel: "<%= resource.moduleLabel %>",
<% if (resource.commands.length > 0) { -%>
      commandRoute: "/<%= resource.route %>/:id/command/:command",
      commands: {
<% resource.commands.forEach((command) => { -%>
        <%= command.name %>: { label: <%- JSON.stringify(command.label) %>, i18nKey: <%- JSON.stringify(command.i18nKey) %>, route: <%- JSON.stringify(command.startsLifecycle ? `/${resource.route}/command/${command.route}` : `/${resource.route}/:id/command/${command.route}`) %>, dataProviderName: <%- JSON.stringify(command.dataProviderName) %>, uiPattern: <%- JSON.stringify(command.uiPattern) %>, interactionMode: <%- JSON.stringify(command.interactionMode) %>, requiresPage: <%= command.requiresPage ? "true" : "false" %>, confirmTitle: <%- JSON.stringify(command.confirmTitle) %>, confirmDescription: <%- JSON.stringify(command.confirmDescription) %>, confirmVariant: <%- JSON.stringify(command.confirmVariant) %><% if (command.enabledField) { %>, enabledField: <%- JSON.stringify(command.enabledField) %><% } %><% if (command.stateField) { %>, stateField: <%- JSON.stringify(command.stateField) %><% } %><% if (command.allowedStates?.length) { %>, allowedStates: <%- JSON.stringify(command.allowedStates) %><% } %> },
<% }) -%>
      },
<% } -%>
      canDelete: <%= resource.deleteCommand ? "true" : "false" %>,
    },
  },
<% }) -%>
];
