// Generated from config.json by the refine generator.
import { Route } from "react-router";

import { resolvePageOverride } from "@/domain/page-overrides";
<% resources.forEach((resource) => { -%>
import {
<% if (resource.canList) { -%>
  <%= resource.component %>List,
<% } -%>
  <%= resource.component %>Show,
<% if (resource.createCommand?.requiresPage) { -%>
  <%= resource.createCommand.pageComponent %>,
<% } -%>
<% if (resource.editCommand) { -%>
  <%= resource.editCommand.pageComponent %>,
<% } -%>
<% resource.routedCommands.forEach((command) => { -%>
  <%= command.pageComponent %>,
<% }) -%>
} from "./<%= resource.pagePath %>";
<% }) -%>

export const contextRoutes = (
  <>
<% resources.forEach((resource) => { -%>
    <Route path="/<%= resource.route %>">
<% if (resource.canList) { -%>
      <Route index element={resolvePageOverride("<%= resource.route %>", "list", <<%= resource.component %>List />)} />
<% } -%>
<% if (resource.createCommand?.requiresPage) { -%>
      <Route path="command/<%= resource.createCommand.route %>" element={resolvePageOverride("<%= resource.route %>", "<%= resource.createCommand.name %>", <<%= resource.createCommand.pageComponent %> />)} />
<% } -%>
<% if (resource.editCommand) { -%>
      <Route path="edit/:id" element={resolvePageOverride("<%= resource.route %>", "edit", <<%= resource.editCommand.pageComponent %> />)} />
<% } -%>
      <Route path="show/:id" element={resolvePageOverride("<%= resource.route %>", "show", <<%= resource.component %>Show />)} />
<% resource.routedCommands.forEach((command) => { -%>
      <Route path=":id/command/<%= command.route %>" element={resolvePageOverride("<%= resource.route %>", "<%= command.name %>", <<%= command.pageComponent %> />)} />
<% }) -%>
    </Route>
<% }) -%>
  </>
);
