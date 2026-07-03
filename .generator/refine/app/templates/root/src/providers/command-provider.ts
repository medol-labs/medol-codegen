import type {
  BaseKey,
  BaseRecord,
  CrudFilter,
  CrudSorting,
  DataProvider,
  GetListParams,
  GetListResponse,
  GetManyParams,
  GetManyResponse,
  GetOneParams,
  GetOneResponse,
} from "@refinedev/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import camelcaseKeys from "camelcase-keys";
import { dataProvider as supabaseDataProvider } from "./data";

type AxonMeta = Record<string, unknown> & {
  axonAggregate?: string;
  axonCatalog?: string;
  axonListPath?: string;
  axonOnePath?: string;
  aggregateRoute?: string;
  idField?: string;
  label?: string;
  queryRoute?: string;
};

const axonSegment = (value: string): string =>
  value.replace(/[-_]/g, "").toLowerCase();

const routeSegment = (value: string): string =>
  value.replace(/[\s_-]+/g, "").toLowerCase();

const idField = (meta?: AxonMeta): string =>
  typeof meta?.idField === "string" ? meta.idField : "id";

const camelResourceId = (resource: string): string =>
  `${resource.replace(/[-_]([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  )}Id`;

const recordId = (
  record: BaseRecord,
  preferredField: string,
  resource: string,
): unknown => {
  const candidates = [
    preferredField,
    "id",
    "aggregateId",
    camelResourceId(resource),
    `${axonSegment(resource)}Id`,
  ];
  const field = candidates.find((candidate) => candidate in record);

  return field ? record[field] : undefined;
};

const aggregatePath = (resource: string, meta?: AxonMeta): string =>
  routeSegment(
    typeof meta?.aggregateRoute === "string"
      ? meta.aggregateRoute
      : typeof meta?.axonAggregate === "string"
        ? meta.axonAggregate
        : resource,
  );

const catalogPath = (resource: string, meta?: AxonMeta): string => {
  if (typeof meta?.axonListPath === "string") {
    return meta.axonListPath.startsWith("/")
      ? meta.axonListPath
      : `/${meta.axonListPath}`;
  }

  const aggregate = aggregatePath(resource, meta);
  const queryRoute = routeSegment(
    typeof meta?.queryRoute === "string"
      ? meta.queryRoute
      : typeof meta?.label === "string"
        ? meta.label
        : typeof meta?.axonCatalog === "string"
          ? meta.axonCatalog
          : resource,
  );

  return `/${aggregate}/${queryRoute}`;
};

const onePath = (resource: string, id: BaseKey, meta?: AxonMeta): string => {
  if (typeof meta?.axonOnePath === "string") {
    const path = meta.axonOnePath.replace(
      ":id",
      encodeURIComponent(String(id)),
    );
    return path.startsWith("/") ? path : `/${path}`;
  }

  const aggregate = aggregatePath(resource, meta);
  const queryRoute = routeSegment(
    typeof meta?.queryRoute === "string"
      ? meta.queryRoute
      : typeof meta?.label === "string"
        ? meta.label
        : resource,
  );

  return `/${aggregate}/${queryRoute}/${encodeURIComponent(String(id))}`;
};

const unwrapAxonReadModel = (payload: unknown): unknown => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: unknown }).data;
  }

  return payload;
};

const toRecords = <TData extends BaseRecord = BaseRecord>(
  payload: unknown,
): TData[] => {
  const data = unwrapAxonReadModel(payload);
  const records = Array.isArray(data) ? data : data ? [data] : [];

  return camelcaseKeys(records as Record<string, unknown>[], {
    deep: true,
  }) as TData[];
};

const applyFilters = <TData extends BaseRecord>(
  records: TData[],
  filters?: CrudFilter[],
): TData[] => {
  if (!filters?.length) {
    return records;
  }

  return records.filter((record) =>
    filters.every((filter) => {
      if ("operator" in filter && filter.operator === "or") {
        return applyFilters([record], filter.value).length > 0;
      }

      if (!("field" in filter)) {
        return true;
      }

      const value = record[filter.field];

      switch (filter.operator) {
        case "eq":
          return value === filter.value;
        case "ne":
          return value !== filter.value;
        case "contains":
          return String(value ?? "")
            .toLowerCase()
            .includes(String(filter.value ?? "").toLowerCase());
        case "in":
          return Array.isArray(filter.value) && filter.value.includes(value);
        default:
          return true;
      }
    }),
  );
};

const applySorting = <TData extends BaseRecord>(
  records: TData[],
  sorters?: CrudSorting,
): TData[] => {
  if (!sorters?.length) {
    return records;
  }

  return [...records].sort((left, right) => {
    for (const sorter of sorters) {
      const leftValue = left[sorter.field];
      const rightValue = right[sorter.field];

      if (leftValue === rightValue) {
        continue;
      }

      const result = leftValue > rightValue ? 1 : -1;
      return sorter.order === "desc" ? -result : result;
    }

    return 0;
  });
};

export const commandDataProvider = (
  supabaseClient: SupabaseClient<any, any, any>,
  options: { baseUrl?: string } = {},
): Required<DataProvider> => {
  void supabaseClient;

  const baseUrl = options.baseUrl ?? import.meta.env.VITE_AXON_API_URL ?? "http://localhost:8080";

  const getJson = async (path: string, allowNotFound = false) => {
    const res = await fetch(`${baseUrl}${path}`);

    if (allowNotFound && res.status === 404) {
      return undefined;
    }

    if (!res.ok) {
      throw new Error(`Axon query failed: GET ${path}`);
    }

    return res.json();
  };

  const getCatalogRecords = async <TData extends BaseRecord = BaseRecord>(
    resource: string,
    meta?: AxonMeta,
  ): Promise<TData[]> =>
    toRecords<TData>(await getJson(catalogPath(resource, meta)));

  return {
    ...supabaseDataProvider,
    getList: async <TData extends BaseRecord = BaseRecord>({
      resource,
      pagination,
      filters,
      sorters,
      meta,
    }: GetListParams): Promise<GetListResponse<TData>> => {
      const allRecords = await getCatalogRecords<TData>(resource, meta);
      const filtered = applyFilters(allRecords, filters);
      const sorted = applySorting(filtered, sorters);
      const current = pagination?.current ?? 1;
      const pageSize = pagination?.pageSize ?? sorted.length;
      const start = (current - 1) * pageSize;

      return {
        data:
          pagination?.mode === "off"
            ? sorted
            : sorted.slice(start, start + pageSize),
        total: sorted.length,
      };
    },
    getMany: async <TData extends BaseRecord = BaseRecord>({
      resource,
      ids,
      meta,
    }: GetManyParams): Promise<GetManyResponse<TData>> => {
      const field = idField(meta);
      const idSet = new Set(ids.map((id) => String(id)));
      const records = await getCatalogRecords<TData>(resource, meta);

      return {
        data: records.filter((record) =>
          idSet.has(String(recordId(record, field, resource))),
        ),
      };
    },
    getOne: async <TData extends BaseRecord = BaseRecord>({
      resource,
      id,
      meta,
    }: GetOneParams): Promise<GetOneResponse<TData>> => {
      const itemPayload = await getJson(onePath(resource, id, meta), true);

      if (itemPayload) {
        const [record] = toRecords<TData>(itemPayload);

        if (record) {
          return { data: record };
        }
      }

      const field = idField(meta);
      const records = await getCatalogRecords<TData>(resource, meta);
      const record = records.find(
        (item) => String(recordId(item, field, resource)) === String(id),
      );

      if (!record) {
        throw new Error(
          `Axon query failed: ${resource}.${String(id)} not found`,
        );
      }

      return { data: record };
    },
    create: async ({ resource, variables, meta }) => {
      const command = meta?.command;
      if (!command) {
        throw new Error(
          `[commandProvider] meta.command is required for command create`,
        );
      }

      const commandPath = routeSegment(String(command));
      const res = await fetch(
        `${baseUrl}/${aggregatePath(resource, meta)}/${commandPath}`,
        {
          method: "POST",
          body: JSON.stringify(variables),
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!res.ok) {
        throw new Error(`Command failed: ${resource}.${command}`);
      }

      return {
        data: await res.json(),
      };
    },
    getApiUrl: () => {
      throw Error("Not implemented on refine-supabase data provider.");
    },

    custom: () => {
      throw Error("Not implemented on refine-supabase data provider.");
    },
  };
};

import { supabaseClient } from "./supabase-client";

export const commandProvider = commandDataProvider(supabaseClient);
