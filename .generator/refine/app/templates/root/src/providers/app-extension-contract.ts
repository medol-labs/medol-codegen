import type { IResourceItem } from "@refinedev/core";
import type { CurrentUser } from "./api-auth";

export type BackendModule = {
  name: string;
  label: string;
  dataProviderName: string;
  apiUrl: string;
  homeRoute: string;
  resources: string[];
};

export type AppExtensionState = {
  dataProviderKey: string;
  filterBackendModules: (modules: BackendModule[]) => BackendModule[];
  filterResources: (resources: IResourceItem[]) => IResourceItem[];
  resolveBackendBaseUrl: (module: BackendModule) => string;
};

export type AdditionalAccessParams = {
  user: CurrentUser;
  resource: string;
  action?: string;
  params?: Record<string, unknown>;
};

export type AdditionalAccessDecision = {
  can: boolean;
  reason?: string;
};
