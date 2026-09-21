import type { IResourceItem } from "@refinedev/core";

export type ResourceOverride = Partial<IResourceItem> & {
  name: string;
};

export const resourceOverrides: ResourceOverride[] = [];
