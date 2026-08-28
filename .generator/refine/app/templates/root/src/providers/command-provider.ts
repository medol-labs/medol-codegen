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
import {
  appendSpringCriteriaFilters,
  canUseSpringCriteriaFilters,
} from "../lib/query-filters";
import { authFetch } from "./api-auth";
import { getAppConfig } from "./app-config";
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
  queryFields?: string[];
};

type SpringPagePayload = {
  content?: unknown[];
  last?: boolean;
  number?: number;
  size?: number;
  totalElements?: number;
  totalPages?: number;
  page?: {
    number?: number;
    size?: number;
    totalElements?: number;
    totalPages?: number;
  };
};

type ListPayload<TData extends BaseRecord> = {
  data: TData[];
  page?: SpringPagePayload;
  total: number;
};

const axonSegment = (value: string): string =>
  value.replace(/[-_]/g, "").toLowerCase();

const routeSegment = (value: string): string =>
  value.replace(/[\s_-]+/g, "").toLowerCase();

const commandErrorMessage = async (
  response: Response,
  fallback: string,
): Promise<string> => {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json") || contentType.includes("+json")) {
    const payload = await response.json().catch(() => null);
    if (payload && typeof payload === "object") {
      const error = payload as Record<string, unknown>;
      const message = error.detail ?? error.message ?? error.title;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
  }

  const text = await response.text().catch(() => "");
  return text.trim() || fallback;
};

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

const isSpringPagePayload = (payload: unknown): payload is SpringPagePayload =>
  Boolean(
    payload &&
      typeof payload === "object" &&
      Array.isArray((payload as SpringPagePayload).content),
  );

const normalizeSpringPage = (payload: SpringPagePayload): SpringPagePayload => ({
  ...payload,
  number: payload.number ?? payload.page?.number,
  size: payload.size ?? payload.page?.size,
  totalElements: payload.totalElements ?? payload.page?.totalElements,
  totalPages: payload.totalPages ?? payload.page?.totalPages,
});

const withQuery = (path: string, params?: URLSearchParams): string => {
  const query = params?.toString();

  if (!query) {
    return path;
  }

  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
};

const toRecords = <TData extends BaseRecord = BaseRecord>(
  payload: unknown,
): TData[] => {
  const data = unwrapAxonReadModel(payload);
  const recordsPayload = isSpringPagePayload(data) ? data.content : data;
  const records = Array.isArray(recordsPayload)
    ? recordsPayload
    : recordsPayload
      ? [recordsPayload]
      : [];

  return camelcaseKeys(records as Record<string, unknown>[], {
    deep: true,
  }) as TData[];
};

const toListPayload = <TData extends BaseRecord = BaseRecord>(
  payload: unknown,
): ListPayload<TData> => {
  const data = unwrapAxonReadModel(payload);
  const page = isSpringPagePayload(data) ? normalizeSpringPage(data) : undefined;
  const records = toRecords<TData>(payload);

  return {
    data: records,
    page,
    total:
      typeof page?.totalElements === "number"
        ? page.totalElements
        : records.length,
  };
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

const appendSorters = (
  params: URLSearchParams,
  sorters?: CrudSorting,
): URLSearchParams => {
  sorters?.forEach((sorter) => {
    params.append("sort", `${sorter.field},${sorter.order ?? "asc"}`);
  });

  return params;
};

const pageQuery = (
  current: number,
  pageSize: number,
  sorters?: CrudSorting,
): URLSearchParams => {
  const params = new URLSearchParams();
  params.set("page", String(Math.max(current - 1, 0)));
  params.set("size", String(Math.max(pageSize, 1)));

  return appendSorters(params, sorters);
};

const currentPage = (pagination: GetListParams["pagination"]): number =>
  Number(
    (pagination as { current?: number } | undefined)?.current ??
      (pagination as { currentPage?: number } | undefined)?.currentPage ??
      1,
  );

const pageSize = (pagination: GetListParams["pagination"]): number =>
  Number(pagination?.pageSize ?? 10);

const serverFilterFields = (meta?: AxonMeta): Set<string> =>
  new Set(Array.isArray(meta?.queryFields) ? meta.queryFields : []);

const canUseServerFilters = (
  meta?: AxonMeta,
  filters?: CrudFilter[],
): boolean => {
  const fields = serverFilterFields(meta);
  return canUseSpringCriteriaFilters(filters, fields);
};

const appendFilters = (
  params: URLSearchParams,
  filters?: CrudFilter[],
): URLSearchParams => {
  return appendSpringCriteriaFilters(params, filters);
};

export const commandDataProvider = (
  supabaseClient: SupabaseClient<any, any, any>,
  options: { baseUrl?: string } = {},
): Required<DataProvider> => {
  void supabaseClient;

  const baseUrl = options.baseUrl ?? getAppConfig("VITE_AXON_API_URL", "http://localhost:8080");

  const getJson = async (path: string, allowNotFound = false) => {
    const res = await authFetch(`${baseUrl}${path}`);

    if (allowNotFound && res.status === 404) {
      return undefined;
    }

    if (!res.ok) {
      throw new Error(`Axon query failed: GET ${path}`);
    }

    return res.json();
  };

  const getCatalogPage = async <TData extends BaseRecord = BaseRecord>(
    resource: string,
    meta?: AxonMeta,
    query?: URLSearchParams,
  ): Promise<ListPayload<TData>> =>
    toListPayload<TData>(
      await getJson(withQuery(catalogPath(resource, meta), query)),
    );

  const getCatalogRecords = async <TData extends BaseRecord = BaseRecord>(
    resource: string,
    meta?: AxonMeta,
    sorters?: CrudSorting,
  ): Promise<TData[]> => {
    const pageSize = 200;
    const firstPage = await getCatalogPage<TData>(
      resource,
      meta,
      pageQuery(1, pageSize, sorters),
    );

    if (!firstPage.page) {
      return firstPage.data;
    }

    const records = [...firstPage.data];
    let nextPage = (firstPage.page.number ?? 0) + 2;
    let reachedLastPage = firstPage.page.last === true;
    const totalPages =
      typeof firstPage.page.totalPages === "number"
        ? firstPage.page.totalPages
        : Math.ceil(firstPage.total / pageSize);

    while (nextPage <= totalPages && !reachedLastPage) {
      const page = await getCatalogPage<TData>(
        resource,
        meta,
        pageQuery(nextPage, pageSize, sorters),
      );
      records.push(...page.data);
      reachedLastPage = page.page?.last === true;

      if (!page.page || reachedLastPage) {
        break;
      }

      nextPage = (page.page.number ?? nextPage - 1) + 2;
    }

    return records;
  };

  return {
    ...supabaseDataProvider,
    getList: async <TData extends BaseRecord = BaseRecord>({
      resource,
      pagination,
      filters,
      sorters,
      meta,
    }: GetListParams): Promise<GetListResponse<TData>> => {
      const useServerFilters = canUseServerFilters(meta, filters);
      if (pagination?.mode !== "off" && (!filters?.length || useServerFilters)) {
        const current = currentPage(pagination);
        const size = pageSize(pagination);
        const query = pageQuery(current, size, sorters);
        if (useServerFilters) {
          appendFilters(query, filters);
        }
        const page = await getCatalogPage<TData>(
          resource,
          meta,
          query,
        );

        if (page.page) {
          return {
            data: page.data,
            total: page.total,
          };
        }

        const sorted = applySorting(page.data, sorters);
        const start = (current - 1) * size;

        return {
          data: sorted.slice(start, start + size),
          total: sorted.length,
        };
      }

      const allRecords = await getCatalogRecords<TData>(
        resource,
        meta,
        sorters,
      );
      const filtered = applyFilters(allRecords, filters);
      const sorted = applySorting(filtered, sorters);
      const current = currentPage(pagination);
      const size = pagination?.mode === "off" ? sorted.length : pageSize(pagination);
      const start = (current - 1) * size;

      return {
        data:
          pagination?.mode === "off"
            ? sorted
            : sorted.slice(start, start + size),
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
      const res = await authFetch(
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
        const error = new Error(
          await commandErrorMessage(
            res,
            `Command failed: ${resource}.${command}`,
          ),
        ) as Error & { statusCode?: number };
        error.statusCode = res.status;
        throw error;
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
