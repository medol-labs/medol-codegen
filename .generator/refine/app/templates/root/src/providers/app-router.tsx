
import { Authenticated } from "@refinedev/core";
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';

import {
  CatchAllNavigate,
  NavigateToResource
} from "@refinedev/react-router";
import { Outlet, Route, Routes } from "react-router";
import { ErrorComponent } from "../components/refine-ui/layout/error-component";
import { Layout } from "../components/refine-ui/layout/layout";
import {
  BlogPostCreate,
  BlogPostEdit,
  BlogPostList,
  BlogPostShow,
} from "../pages/blog-posts";
import { BlogPostApprove } from "../pages/blog-posts/approve";
import {
  CategoryCreate,
  CategoryEdit,
  CategoryList,
  CategoryShow,
} from "../pages/categories";
import { Dashboard } from "../pages/dashboard";
import { ForgotPassword } from "../pages/forgot-password";
import { Login } from "../pages/login";
import { Register } from "../pages/register";

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
        <Route
          index
          element={<NavigateToResource resource="dashboard" />}
        />
        <Route
          index
          path="/dashboard"
          element={<Dashboard />}
        ></Route>
        <Route path="/blog-posts">
          <Route index element={<BlogPostList />} />
          <Route path="create" element={<BlogPostCreate />} />
          <Route path="edit/:id" element={<BlogPostEdit />} />
          <Route path="show/:id" element={<BlogPostShow />} />
          <Route path=":id/command/approve" element={<BlogPostApprove />} />
          <Route path=":id/command/cancel" element={<BlogPostApprove />} />
        </Route>
        <Route path="/categories">
          <Route index element={<CategoryList />} />
          <Route path="create" element={<CategoryCreate />} />
          <Route path="edit/:id" element={<CategoryEdit />} />
          <Route path="show/:id" element={<CategoryShow />} />
        </Route>
        <Route path="*" element={<ErrorComponent />} />
      </Route>
      <Route
        element={
          <Authenticated
            key="authenticated-outer"
            fallback={<Outlet />}
          >
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
