import type { CrudFilter } from "@refinedev/core";

export type QueryOperator =
  | "eq"
  | "ne"
  | "contains"
  | "ncontains"
  | "in"
  | "nin"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "null"
  | "nnull";

export type QueryFilter = {
  field: string;
  operator: QueryOperator;
  value?: unknown;
};

type LogicalCrudFilter = CrudFilter & {
  field: string;
  operator: string;
  value: unknown;
};

const springCriteriaOperators: Record<QueryOperator, string> = {
  eq: "equals",
  ne: "notEquals",
  contains: "contains",
  ncontains: "doesNotContain",
  in: "in",
  nin: "notIn",
  gt: "greaterThan",
  gte: "greaterThanOrEqual",
  lt: "lessThan",
  lte: "lessThanOrEqual",
  null: "specified",
  nnull: "specified",
};

const supportedOperators = new Set<QueryOperator>(
  Object.keys(springCriteriaOperators) as QueryOperator[],
);

const isConditionalFilter = (
  filter: CrudFilter,
): filter is LogicalCrudFilter =>
  "field" in filter &&
  typeof (filter as { field?: unknown }).field === "string" &&
  typeof (filter as { operator?: unknown }).operator === "string";

const isQueryOperator = (operator: string): operator is QueryOperator =>
  supportedOperators.has(operator as QueryOperator);

export const toQueryFilters = (filters?: CrudFilter[]): QueryFilter[] => {
  if (!filters?.length) {
    return [];
  }

  const queryFilters: QueryFilter[] = [];
  filters.forEach((filter) => {
    if ("operator" in filter && filter.operator === "or") {
      return;
    }

    if (!isConditionalFilter(filter) || !isQueryOperator(filter.operator)) {
      return;
    }

    queryFilters.push({
      field: filter.field,
      operator: filter.operator,
      value: filter.value,
    });
  });

  return queryFilters;
};

export const canUseSpringCriteriaFilters = (
  filters?: CrudFilter[],
  allowedFields?: Set<string>,
): boolean => {
  if (!filters?.length) {
    return false;
  }

  return filters.every((filter) => {
    if ("operator" in filter && filter.operator === "or") {
      return false;
    }

    if (!isConditionalFilter(filter) || !isQueryOperator(filter.operator)) {
      return false;
    }

    return !allowedFields || allowedFields.size === 0 || allowedFields.has(filter.field);
  });
};

export const appendSpringCriteriaFilters = (
  params: URLSearchParams,
  filters?: CrudFilter[],
): URLSearchParams => {
  toQueryFilters(filters).forEach((filter) => {
    const operator = springCriteriaOperators[filter.operator];
    const value =
      filter.operator === "null"
        ? "false"
        : filter.operator === "nnull"
          ? "true"
          : Array.isArray(filter.value)
            ? filter.value
                .map((item) => stringifyCriteriaValue(filter.field, item))
                .join(",")
            : stringifyCriteriaValue(filter.field, filter.value);

    params.append(`${filter.field}.${operator}`, value);
  });

  return params;
};

const temporalFieldPattern = /(At|Date|Time)$/;

const stringifyCriteriaValue = (field: string, value: unknown): string => {
  if (!temporalFieldPattern.test(field)) {
    return String(value ?? "");
  }

  const date = parseTemporalValue(value);
  if (!date) {
    return String(value ?? "");
  }

  return formatLocalDateTime(date);
};

const parseTemporalValue = (value: unknown): Date | undefined => {
  if (value instanceof Date) {
    return value;
  }

  const raw = String(value ?? "");
  if (!raw) {
    return undefined;
  }

  const timestamp = Number(raw);
  const date = Number.isFinite(timestamp) && /^\d+$/.test(raw)
    ? new Date(timestamp)
    : new Date(raw);

  return Number.isNaN(date.getTime()) ? undefined : date;
};

const formatLocalDateTime = (date: Date): string => {
  const pad = (value: number, length = 2) =>
    String(value).padStart(length, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}.${pad(date.getMilliseconds(), 3)}`;
};

export const camelToSnake = (value: string): string =>
  value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export const toSupabaseQueryFilters = (
  filters?: CrudFilter[],
): QueryFilter[] =>
  toQueryFilters(filters).map((filter) => ({
    ...filter,
    field: camelToSnake(filter.field),
  }));

export const toSupabaseCrudFilters = (
  filters?: CrudFilter[],
): CrudFilter[] | undefined => {
  if (!filters) {
    return filters;
  }

  return filters.map((filter) => {
    if ("operator" in filter && (filter.operator === "or" || filter.operator === "and")) {
      return {
        ...filter,
        value: toSupabaseCrudFilters(filter.value) ?? [],
      };
    }

    if (!isConditionalFilter(filter)) {
      return filter;
    }

    return {
      ...filter,
      field: camelToSnake(filter.field),
    };
  });
};
