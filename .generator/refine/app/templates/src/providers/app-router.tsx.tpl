// Generated from config.json by the refine generator.
import { Authenticated } from "@refinedev/core";
import { NuqsAdapter } from "nuqs/adapters/react-router/v7";

import {
  CatchAllNavigate,
  NavigateToResource
} from "@refinedev/react-router";
import { Outlet, Route, Routes } from "react-router";
import { ErrorComponent } from "../components/refine-ui/layout/error-component";
import { Layout } from "../components/refine-ui/layout/layout";
import { Dashboard } from "../pages/dashboard";
import { ForgotPassword } from "../pages/forgot-password";
import { Login } from "../pages/login";
import { Register } from "../pages/register";
<% resources.forEach((resource) => { -%>
import {
<% if (resource.canList) { -%>
  <%= resource.component %>List,
<% } -%>
  <%= resource.component %>Show,
<% if (resource.createCommand) { -%>
  <%= resource.createCommand.pageComponent %>,
<% } -%>
<% if (resource.editCommand) { -%>
  <%= resource.editCommand.pageComponent %>,
<% } -%>
<% resource.routedCommands.forEach((command) => { -%>
  <%= command.pageComponent %>,
<% }) -%>
} from "../pages/<%= resource.route %>";
<% }) -%>

export const AppRouter = () => {
  return (
    <Routes>
      <Route
        element={
          <Authenticated
            key="authenticated-inner"
            fallback={<CatchAllNavigate to="/login" />}
          >
            <Layout>
              <NuqsAdapter>
                <Outlet />
              </NuqsAdapter>
            </Layout>
          </Authenticated>
        }
      >
        <Route index element={<NavigateToResource resource="dashboard" />} />
        <Route path="/dashboard" element={<Dashboard />} />
<% resources.forEach((resource) => { -%>
        <Route path="/<%= resource.route %>">
<% if (resource.canList) { -%>
          <Route index element={<<%= resource.component %>List />} />
<% } -%>
<% if (resource.createCommand) { -%>
          <Route path="command/<%= resource.createCommand.route %>" element={<<%= resource.createCommand.pageComponent %> />} />
<% } -%>
<% if (resource.editCommand) { -%>
          <Route path="edit/:id" element={<<%= resource.editCommand.pageComponent %> />} />
<% } -%>
          <Route path="show/:id" element={<<%= resource.component %>Show />} />
<% resource.routedCommands.forEach((command) => { -%>
          <Route path=":id/command/<%= command.route %>" element={<<%= command.pageComponent %> />} />
<% }) -%>
        </Route>
<% }) -%>
        <Route path="*" element={<ErrorComponent />} />
      </Route>
      <Route
        element={
          <Authenticated key="authenticated-outer" fallback={<Outlet />}>
            <NavigateToResource />
          </Authenticated>
        }
      >
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
      </Route>
    </Routes>
  );
};
