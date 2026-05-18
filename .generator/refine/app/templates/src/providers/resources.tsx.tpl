// Generated from config.json by the refine generator.
import { IResourceItem } from "@refinedev/core";
import { FlaskConical, LayoutDashboard, Package } from "lucide-react";

import { COMMAND_DATA_PROVIDER_NAME } from "./constants";

export const resources: IResourceItem[] = [
  {
    name: "dashboard",
    list: "/dashboard",
    meta: {
      label: "Dashboard",
      icon: <LayoutDashboard />,
    },
  },
<% chapters.forEach((chapter) => { -%>
  {
    name: "<%= chapter.name %>",
    meta: {
      label: "<%= chapter.label %>",
      icon: <FlaskConical />,
    },
  },
<% }) -%>
<% resources.forEach((resource) => { -%>
  {
    name: "<%= resource.name %>",
    list: "/<%= resource.route %>",
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
      icon: <Package />,
      tableName: "<%= resource.tableName %>",
<% if (resource.commands.length > 0) { -%>
      commandRoute: "/<%= resource.route %>/:id/command/:command",
      commands: {
<% if (resource.createCommand) { -%>
        <%= resource.createCommand.name %>: { label: "<%= resource.createCommand.label %>", route: "/<%= resource.route %>/command/<%= resource.createCommand.route %>" },
<% } -%>
<% resource.routedCommands.forEach((command) => { -%>
        <%= command.name %>: { label: "<%= command.label %>", route: "/<%= resource.route %>/:id/command/<%= command.route %>" },
<% }) -%>
      },
<% } -%>
      canDelete: <%= resource.deleteCommand ? "true" : "false" %>,
      dataProviderName: COMMAND_DATA_PROVIDER_NAME,
    },
  },
<% }) -%>
];
