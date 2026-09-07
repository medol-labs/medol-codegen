// Generated from config.json by the refine generator.
import { type IResourceItem } from "@refinedev/core";
import { LayoutDashboard } from "lucide-react";

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

export const fileUploadCapability = null;

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
];
