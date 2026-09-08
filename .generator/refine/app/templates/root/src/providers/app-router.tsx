import { Authenticated } from "@refinedev/core";
import {
  CatchAllNavigate,
  NavigateToResource,
} from "@refinedev/react-router";
import { NuqsAdapter } from "nuqs/adapters/react-router/v7";
import { Outlet, Route, Routes } from "react-router";

import { contextRoutes } from "@/contexts/routes";
import { ErrorComponent } from "@/components/refine-ui/layout/error-component";
import { Layout } from "@/components/refine-ui/layout/layout";
import { Dashboard } from "@/pages/dashboard";
import { ForgotPassword } from "@/pages/forgot-password";
import { Login } from "@/pages/login";
import { Register } from "@/pages/register";
import { PortalSso } from "@/pages/sso/portal";
import { AuthenticatedRouteExtension } from "@/domain/app-extensions";

export const AppRouter = () => {
  return (
    <Routes>
      <Route path="/sso/portal" element={<PortalSso />} />
      <Route
        element={
          <Authenticated
            key="authenticated-inner"
            fallback={<CatchAllNavigate to="/login" />}
          >
            <AuthenticatedRouteExtension>
              <Layout>
                <NuqsAdapter>
                  <Outlet />
                </NuqsAdapter>
              </Layout>
            </AuthenticatedRouteExtension>
          </Authenticated>
        }
      >
        <Route index element={<NavigateToResource resource="dashboard" />} />
        <Route path="/dashboard" element={<Dashboard />} />
        {contextRoutes}
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
