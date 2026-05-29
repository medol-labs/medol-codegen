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
  {
    name: "posts",
    meta: {
      label: "Posts",
      icon: <FlaskConical />,
    },
  },
  {
    name: "blog_posts",
    list: "/blog-posts",
    create: "/blog-posts/create",
    edit: "/blog-posts/edit/:id",
    show: "/blog-posts/show/:id",
    meta: {
      parent: "posts",
      commandRoute: "/blog-posts/:id/command/:command",
      commands: {
        approve: {
          label: "Approve",
        },
        cancel: {
          label: "Cancel",
        },
      },
      canDelete: true,
      dataProviderName: COMMAND_DATA_PROVIDER_NAME,
    },
  },
  {
    name: "categories",
    list: "/categories",
    create: "/categories/create",
    edit: "/categories/edit/:id",
    show: "/categories/show/:id",
    meta: {
      parent: "posts",
      commandRoute: "/:resource/:id/command/:command",
      commands: {
        approve: {
          label: "Approve Order",
        },
        cancel: {
          label: "Cancel Order",
        },
      },
      canDelete: true,
    },
  },
];
