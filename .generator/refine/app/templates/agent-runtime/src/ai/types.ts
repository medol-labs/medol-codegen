import type {Capability} from './policy.mjs';
export type RuntimeCapability = Capability & {
  description?: string;
  fields: Array<{name:string;type:string;optional:boolean}>;
  binding?: {
    resource: string;
    command?: string;
    route: string;
    dataProviderName: string;
    writableFields?: string[];
    meta?: {aggregateRoute:string;queryRoute:string;idField:string;queryFields:string[]};
  };
};
