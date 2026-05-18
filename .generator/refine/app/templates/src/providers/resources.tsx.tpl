// Generated from config.json by the refine generator.
import { IResourceItem } from "@refinedev/core";
import { LayoutDashboard, Package } from "lucide-react";

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
<% resources.forEach((resource) => { -%>
  {
    name: "<%= resource.name %>",
    list: "/<%= resource.route %>",
<% if (resource.createCommand) { -%>
    create: "/<%= resource.route %>/create",
<% } -%>
<% if (resource.editCommand) { -%>
    edit: "/<%= resource.route %>/edit/:id",
<% } -%>
    show: "/<%= resource.route %>/show/:id",
    meta: {
      label: "<%= resource.label %>",
      icon: <Package />,
<% if (resource.routedCommands.length > 0) { -%>
      commandRoute: "/<%= resource.route %>/:id/command/:command",
      commands: {
<% resource.routedCommands.forEach((command) => { -%>
        <%= command.name %>: { label: "<%= command.label %>" },
<% }) -%>
      },
<% } -%>
      canDelete: <%= resource.deleteCommand ? "true" : "false" %>,
      dataProviderName: COMMAND_DATA_PROVIDER_NAME,
    },
  },
<% }) -%>
];
