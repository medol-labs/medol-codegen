import type { IResourceItem } from "@refinedev/core";

import {
  authBackendModule,
  backendModules,
  fileUploadCapability,
  resources as contextResources,
} from "@/contexts/resources";
import { resourceOverrides } from "@/domain/resource-overrides";

const mergeResource = (
  resource: IResourceItem,
  override: Partial<IResourceItem>,
): IResourceItem => ({
  ...resource,
  ...override,
  meta: {
    ...(resource.meta ?? {}),
    ...(override.meta ?? {}),
  },
});

export const resources: IResourceItem[] = contextResources.map((resource) => {
  const override = resourceOverrides.find((item) => item.name === resource.name);
  return override ? mergeResource(resource, override) : resource;
});

export { authBackendModule, backendModules, fileUploadCapability };
