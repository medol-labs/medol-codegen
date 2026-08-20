"use client";

import type {
  Column,
  ColumnFiltersState,
  ColumnMeta,
  Table,
} from "@tanstack/react-table";
import {
  CalendarIcon,
  Check,
  ChevronsUpDown,
  GripVertical,
  ListFilter,
  Trash2,
} from "lucide-react";
import * as React from "react";

import { DataTableRangeFilter } from "@/components/data-table/data-table-range-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Faceted,
  FacetedBadgeList,
  FacetedContent,
  FacetedEmpty,
  FacetedGroup,
  FacetedInput,
  FacetedItem,
  FacetedList,
  FacetedTrigger,
} from "@/components/ui/faceted";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
  SortableOverlay,
} from "@/components/ui/sortable";
import { dataTableConfig } from "@/config/data-table";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import { getDefaultFilterOperator, getFilterOperators } from "@/lib/data-table";
import { formatDate } from "@/lib/format";
import { generateId } from "@/lib/id";
import { cn } from "@/lib/utils";
import type {
  ExtendedColumnFilter,
  FilterOperator,
  JoinOperator,
} from "@/types/data-table";

const DEBOUNCE_MS = 300;
const THROTTLE_MS = 50;
const FILTER_SHORTCUT_KEY = "f";
const DATA_TABLE_RESET_FILTERS_EVENT = "medol:data-table:reset-filters";
const REMOVE_FILTER_SHORTCUTS = ["backspace", "delete"];
const STORAGE_PREFIX = "medol:data-table";
const LEGACY_FILTER_QUERY_PREFIX = "filters[";
const LEGACY_TABLE_FILTERS_QUERY_KEY = "tableFilters";
const LEGACY_TABLE_JOIN_OPERATOR_QUERY_KEY = "tableJoinOperator";

type RefineColumnFilter = ColumnFiltersState[number] & {
  operator?:
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
};

const labelForColumn = <TData,>(column: Column<TData>) =>
  column.columnDef.meta?.label ??
  column.id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const uiToCriteriaOperator: Partial<Record<FilterOperator, string>> = {
  iLike: "contains",
  notILike: "doesNotContain",
  eq: "equals",
  ne: "notEquals",
  inArray: "in",
  notInArray: "notIn",
  isEmpty: "specified",
  isNotEmpty: "specified",
  lt: "lessThan",
  lte: "lessThanOrEqual",
  gt: "greaterThan",
  gte: "greaterThanOrEqual",
};

const criteriaToUiOperator: Record<string, FilterOperator> = {
  contains: "iLike",
  doesNotContain: "notILike",
  equals: "eq",
  notEquals: "ne",
  in: "inArray",
  notIn: "notInArray",
  specified: "isNotEmpty",
  lessThan: "lt",
  lessThanOrEqual: "lte",
  greaterThan: "gt",
  greaterThanOrEqual: "gte",
};

const criteriaOperators = new Set(Object.keys(criteriaToUiOperator));

const toRefineColumnFilters = <TData,>(
  filters: ExtendedColumnFilter<TData>[],
): ColumnFiltersState => {
  const columnFilters: RefineColumnFilter[] = [];

  filters.forEach((filter) => {
    const value = filter.value;
    const hasValue = Array.isArray(value)
      ? value.length > 0
      : value !== "" && value !== null && value !== undefined;

    switch (filter.operator) {
      case "iLike":
        if (hasValue) columnFilters.push({ id: filter.id, operator: "contains", value });
        break;
      case "notILike":
        if (hasValue) columnFilters.push({ id: filter.id, operator: "ncontains", value });
        break;
      case "inArray":
        if (hasValue) columnFilters.push({ id: filter.id, operator: "in", value });
        break;
      case "notInArray":
        if (hasValue) columnFilters.push({ id: filter.id, operator: "nin", value });
        break;
      case "isEmpty":
        columnFilters.push({ id: filter.id, operator: "null", value: true });
        break;
      case "isNotEmpty":
        columnFilters.push({ id: filter.id, operator: "nnull", value: true });
        break;
      case "isBetween":
        if (Array.isArray(value)) {
          const [start, end] = value;
          if (start !== "" && start !== undefined) {
            columnFilters.push({ id: filter.id, operator: "gte", value: start });
          }
          if (end !== "" && end !== undefined) {
            columnFilters.push({ id: filter.id, operator: "lte", value: end });
          }
        }
        break;
      case "isRelativeToToday":
        break;
      default:
        if (hasValue) columnFilters.push({ id: filter.id, operator: filter.operator, value });
        break;
    }
  });

  return columnFilters;
};

const isCriteriaQueryKey = (key: string, validColumnIds: Set<string>) => {
  const dotIndex = key.lastIndexOf(".");
  if (dotIndex <= 0) {
    return false;
  }

  return (
    validColumnIds.has(key.slice(0, dotIndex)) &&
    criteriaOperators.has(key.slice(dotIndex + 1))
  );
};

const readCriteriaFiltersFromUrl = <TData,>(
  columns: Column<TData>[],
): ExtendedColumnFilter<TData>[] => {
  if (typeof window === "undefined") {
    return [];
  }

  const columnById = new Map(columns.map((column) => [column.id, column]));
  const filters: ExtendedColumnFilter<TData>[] = [];
  const params = new URLSearchParams(window.location.search);

  params.forEach((rawValue, key) => {
    const dotIndex = key.lastIndexOf(".");
    if (dotIndex <= 0) {
      return;
    }

    const id = key.slice(0, dotIndex);
    const criteriaOperator = key.slice(dotIndex + 1);
    const column = columnById.get(id);
    if (!column || !criteriaOperators.has(criteriaOperator)) {
      return;
    }

    const operator = criteriaToUiOperator[criteriaOperator];
    const value =
      criteriaOperator === "specified"
        ? ""
        : criteriaOperator === "in" || criteriaOperator === "notIn"
          ? rawValue.split(",").filter(Boolean)
          : rawValue;

    filters.push({
      id: id as Extract<keyof TData, string>,
      value,
      variant: column.columnDef.meta?.variant ?? "text",
      operator:
        criteriaOperator === "specified"
          ? rawValue === "false"
            ? "isEmpty"
            : "isNotEmpty"
          : operator,
      filterId: generateId({ length: 8 }),
    });
  });

  return filters;
};

const toCriteriaFilterEntries = <TData,>(
  filters: ExtendedColumnFilter<TData>[],
): { key: string; value: string }[] => {
  const entries: { key: string; value: string }[] = [];

  filters.forEach((filter) => {
    const value = filter.value;
    const hasValue = Array.isArray(value)
      ? value.length > 0
      : value !== "" && value !== null && value !== undefined;
    const criteriaOperator = uiToCriteriaOperator[filter.operator];

    if (!criteriaOperator) {
      return;
    }

    if (filter.operator === "isEmpty" || filter.operator === "isNotEmpty") {
      entries.push({
        key: `${filter.id}.specified`,
        value: filter.operator === "isNotEmpty" ? "true" : "false",
      });
      return;
    }

    if (!hasValue) {
      return;
    }

    entries.push({
      key: `${filter.id}.${criteriaOperator}`,
      value: criteriaFilterValue(filter),
    });
  });

  return entries;
};

const criteriaFilterValue = <TData,>(filter: ExtendedColumnFilter<TData>) => {
  const value = filter.value;

  if (Array.isArray(value)) {
    return value
      .map((item) =>
        filter.variant === "date" || filter.variant === "dateRange"
          ? normalizeDateFilterValue(String(item), filter.operator)
          : String(item),
      )
      .join(",");
  }

  return filter.variant === "date" || filter.variant === "dateRange"
    ? normalizeDateFilterValue(String(value), filter.operator)
    : String(value);
};

const normalizeDateFilterValue = (value: string, operator: FilterOperator) => {
  const date = parseFilterDate(value);

  if (!date) {
    return value;
  }

  return formatLocalDateTimeForOperator(date, operator);
};

const writeCriteriaFiltersToUrl = <TData,>(
  filters: ExtendedColumnFilter<TData>[],
  validColumnIds: Set<string>,
) => {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  Array.from(url.searchParams.keys()).forEach((key) => {
    if (
      key.startsWith(LEGACY_FILTER_QUERY_PREFIX) ||
      key === LEGACY_TABLE_FILTERS_QUERY_KEY ||
      key === LEGACY_TABLE_JOIN_OPERATOR_QUERY_KEY ||
      isCriteriaQueryKey(key, validColumnIds)
    ) {
      url.searchParams.delete(key);
    }
  });

  toCriteriaFilterEntries(filters).forEach((filter) => {
    url.searchParams.append(filter.key, filter.value);
  });

  if (filters.length > 0) {
    url.searchParams.set("currentPage", "1");
  }

  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
};

const storageKey = (kind: "filters" | "joinOperator") => {
  if (typeof window === "undefined") {
    return "";
  }
  return `${STORAGE_PREFIX}:${window.location.pathname}:${kind}`;
};

const readStoredFilters = <TData,>(
  key: string,
  validColumnIds: Set<string>,
): ExtendedColumnFilter<TData>[] => {
  if (!key || typeof window === "undefined") {
    return [];
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((filter) =>
      filter &&
      typeof filter.id === "string" &&
      typeof filter.filterId === "string" &&
      validColumnIds.has(filter.id)
    ) as ExtendedColumnFilter<TData>[];
  } catch {
    return [];
  }
};

const readStoredJoinOperator = (key: string): JoinOperator => {
  if (!key || typeof window === "undefined") {
    return "and";
  }
  return window.localStorage.getItem(key) === "or" ? "or" : "and";
};

const writeStoredValue = (key: string, value: unknown) => {
  if (!key || typeof window === "undefined") {
    return;
  }

  if (
    value === null ||
    (Array.isArray(value) && value.length === 0)
  ) {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(
    key,
    typeof value === "string" ? value : JSON.stringify(value),
  );
};

interface DataTableFilterListProps<TData>
  extends React.ComponentProps<typeof PopoverContent> {
  table: Table<TData>;
  debounceMs?: number;
  throttleMs?: number;
  shallow?: boolean;
  disabled?: boolean;
}

export function DataTableFilterList<TData>({
  table,
  debounceMs = DEBOUNCE_MS,
  throttleMs = THROTTLE_MS,
  shallow = true,
  disabled,
  ...props
}: DataTableFilterListProps<TData>) {
  const id = React.useId();
  const labelId = React.useId();
  const descriptionId = React.useId();
  void throttleMs;
  void shallow;
  const [open, setOpen] = React.useState(false);
  const addButtonRef = React.useRef<HTMLButtonElement>(null);

  const columns = React.useMemo(() => {
    return table
      .getAllColumns()
      .filter((column) => column.columnDef.enableColumnFilter);
  }, [table]);
  const columnIds = React.useMemo(
    () => new Set(columns.map((field) => field.id)),
    [columns],
  );
  const filtersStorageKey = React.useMemo(() => storageKey("filters"), []);
  const joinOperatorStorageKey = React.useMemo(
    () => storageKey("joinOperator"),
    [],
  );

  const debouncedWriteCriteriaFilters = useDebouncedCallback(
    (nextFilters: ExtendedColumnFilter<TData>[]) =>
      writeCriteriaFiltersToUrl(nextFilters, columnIds),
    debounceMs,
  );

  const [filters, setFiltersState] = React.useState<
    ExtendedColumnFilter<TData>[]
  >(() => {
    const urlFilters = readCriteriaFiltersFromUrl(columns);
    return urlFilters.length > 0
      ? urlFilters
      : readStoredFilters<TData>(filtersStorageKey, columnIds);
  });
  const [joinOperator, setJoinOperatorState] = React.useState<JoinOperator>(
    () => readStoredJoinOperator(joinOperatorStorageKey),
  );

  const setPersistedFilters = React.useCallback(
    (
      value:
        | ExtendedColumnFilter<TData>[]
        | ((
            prevFilters: ExtendedColumnFilter<TData>[],
          ) => ExtendedColumnFilter<TData>[]),
    ) => {
      setFiltersState((prevFilters) => {
        const nextFilters =
          typeof value === "function" ? value(prevFilters) : value;
        writeStoredValue(filtersStorageKey, nextFilters);
        debouncedWriteCriteriaFilters(nextFilters);
        return nextFilters;
      });
    },
    [debouncedWriteCriteriaFilters, filtersStorageKey],
  );

  const setPersistedJoinOperator = React.useCallback(
    (value: JoinOperator) => {
      setJoinOperatorState(value);
      writeStoredValue(joinOperatorStorageKey, value === "and" ? null : value);
    },
    [joinOperatorStorageKey],
  );

  const onFilterAdd = React.useCallback(() => {
    const column = columns[0];

    if (!column) return;

    setPersistedFilters([
      ...filters,
      {
        id: column.id as Extract<keyof TData, string>,
        value: defaultFilterValueForColumn(column),
        variant: column.columnDef.meta?.variant ?? "text",
        operator: defaultFilterOperatorForColumn(column),
        filterId: generateId({ length: 8 }),
      },
    ]);
  }, [columns, filters, setPersistedFilters]);

  const onFilterUpdate = React.useCallback(
    (
      filterId: string,
      updates: Partial<Omit<ExtendedColumnFilter<TData>, "filterId">>,
    ) => {
      setPersistedFilters((prevFilters) => {
        const updatedFilters = prevFilters.map((filter) => {
          if (filter.filterId === filterId) {
            return { ...filter, ...updates } as ExtendedColumnFilter<TData>;
          }
          return filter;
        });
        return updatedFilters;
      });
    },
    [setPersistedFilters],
  );

  const onFilterRemove = React.useCallback(
    (filterId: string) => {
      const updatedFilters = filters.filter(
        (filter) => filter.filterId !== filterId,
      );
      setPersistedFilters(updatedFilters);
      requestAnimationFrame(() => {
        addButtonRef.current?.focus();
      });
    },
    [filters, setPersistedFilters],
  );

  const onFiltersReset = React.useCallback(() => {
    setPersistedFilters([]);
    setPersistedJoinOperator("and");
    table.resetColumnFilters();
  }, [setPersistedFilters, setPersistedJoinOperator, table]);

  React.useEffect(() => {
    const onExternalReset = () => {
      onFiltersReset();
    };

    window.addEventListener(DATA_TABLE_RESET_FILTERS_EVENT, onExternalReset);
    return () =>
      window.removeEventListener(DATA_TABLE_RESET_FILTERS_EVENT, onExternalReset);
  }, [onFiltersReset]);

  React.useEffect(() => {
    table.setColumnFilters(toRefineColumnFilters(filters));
  }, [filters, table]);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement &&
          event.target.contentEditable === "true")
      ) {
        return;
      }

      if (
        event.key.toLowerCase() === FILTER_SHORTCUT_KEY &&
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey
      ) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onTriggerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (
        REMOVE_FILTER_SHORTCUTS.includes(event.key.toLowerCase()) &&
        filters.length > 0
      ) {
        event.preventDefault();
        onFilterRemove(filters[filters.length - 1]?.filterId ?? "");
      }
    },
    [filters, onFilterRemove],
  );

  return (
    <Sortable
      value={filters}
      onValueChange={setPersistedFilters}
      getItemValue={(item) => item.filterId}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="font-normal"
            onKeyDown={onTriggerKeyDown}
            disabled={disabled}
          >
            <ListFilter className="text-muted-foreground" />
            Filter
            {filters.length > 0 && (
              <Badge
                variant="secondary"
                className="h-[18.24px] rounded-[3.2px] px-[5.12px] font-mono font-normal text-[10.4px]"
              >
                {filters.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          aria-describedby={descriptionId}
          aria-labelledby={labelId}
          className="flex w-full max-w-(--radix-popover-content-available-width) flex-col gap-3.5 p-4 sm:min-w-[380px]"
          {...props}
        >
          <div className="flex flex-col gap-1">
            <h4 id={labelId} className="font-medium leading-none">
              {filters.length > 0 ? "Filters" : "No filters applied"}
            </h4>
            <p
              id={descriptionId}
              className={cn(
                "text-muted-foreground text-sm",
                filters.length > 0 && "sr-only",
              )}
            >
              {filters.length > 0
                ? "Modify filters to refine your rows."
                : "Add filters to refine your rows."}
            </p>
          </div>
          {filters.length > 0 ? (
            <SortableContent asChild>
              <div
                role="list"
                className="flex max-h-[300px] flex-col gap-2 overflow-y-auto p-1"
              >
                {filters.map((filter, index) => (
                  <DataTableFilterItem<TData>
                    key={filter.filterId}
                    filter={filter}
                    index={index}
                    filterItemId={`${id}-filter-${filter.filterId}`}
                    joinOperator={joinOperator}
                    setJoinOperator={setPersistedJoinOperator}
                    columns={columns}
                    onFilterUpdate={onFilterUpdate}
                    onFilterRemove={onFilterRemove}
                  />
                ))}
              </div>
            </SortableContent>
          ) : null}
          <div className="flex w-full items-center gap-2">
            <Button
              size="sm"
              className="rounded"
              ref={addButtonRef}
              onClick={onFilterAdd}
            >
              Add filter
            </Button>
            {filters.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="rounded"
                onClick={onFiltersReset}
              >
                Reset filters
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      <SortableOverlay>
        <div className="flex items-center gap-2">
          <div className="h-8 min-w-[72px] rounded-sm bg-primary/10" />
          <div className="h-8 w-56 rounded-sm bg-primary/10" />
          <div className="h-8 w-32 rounded-sm bg-primary/10" />
          <div className="h-8 min-w-36 flex-1 rounded-sm bg-primary/10" />
          <div className="size-8 shrink-0 rounded-sm bg-primary/10" />
          <div className="size-8 shrink-0 rounded-sm bg-primary/10" />
        </div>
      </SortableOverlay>
    </Sortable>
  );
}

interface DataTableFilterItemProps<TData> {
  filter: ExtendedColumnFilter<TData>;
  index: number;
  filterItemId: string;
  joinOperator: JoinOperator;
  setJoinOperator: (value: JoinOperator) => void;
  columns: Column<TData>[];
  onFilterUpdate: (
    filterId: string,
    updates: Partial<Omit<ExtendedColumnFilter<TData>, "filterId">>,
  ) => void;
  onFilterRemove: (filterId: string) => void;
}

function DataTableFilterItem<TData>({
  filter,
  index,
  filterItemId,
  joinOperator,
  setJoinOperator,
  columns,
  onFilterUpdate,
  onFilterRemove,
}: DataTableFilterItemProps<TData>) {
  const [showFieldSelector, setShowFieldSelector] = React.useState(false);
  const [showOperatorSelector, setShowOperatorSelector] = React.useState(false);
  const [showValueSelector, setShowValueSelector] = React.useState(false);

  const column = columns.find((column) => column.id === filter.id);

  const joinOperatorListboxId = `${filterItemId}-join-operator-listbox`;
  const fieldListboxId = `${filterItemId}-field-listbox`;
  const operatorListboxId = `${filterItemId}-operator-listbox`;
  const inputId = `${filterItemId}-input`;

  const columnMeta = column?.columnDef.meta;
  const filterOperators = getFilterOperators(filter.variant);

  const onItemKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (showFieldSelector || showOperatorSelector || showValueSelector) {
        return;
      }

      if (REMOVE_FILTER_SHORTCUTS.includes(event.key.toLowerCase())) {
        event.preventDefault();
        onFilterRemove(filter.filterId);
      }
    },
    [
      filter.filterId,
      showFieldSelector,
      showOperatorSelector,
      showValueSelector,
      onFilterRemove,
    ],
  );

  if (!column) return null;

  return (
    <SortableItem value={filter.filterId} asChild>
      <div
        role="listitem"
        id={filterItemId}
        tabIndex={-1}
        className="flex items-center gap-2"
        onKeyDown={onItemKeyDown}
      >
        <div className="min-w-[72px] text-center">
          {index === 0 ? (
            <span className="text-muted-foreground text-sm">Where</span>
          ) : index === 1 ? (
            <Select
              value={joinOperator}
              onValueChange={(value: JoinOperator) => setJoinOperator(value)}
            >
              <SelectTrigger
                aria-label="Select join operator"
                aria-controls={joinOperatorListboxId}
                size="sm"
                className="rounded lowercase"
              >
                <SelectValue placeholder={joinOperator} />
              </SelectTrigger>
              <SelectContent
                id={joinOperatorListboxId}
                position="popper"
                className="min-w-(--radix-select-trigger-width) lowercase"
              >
                {dataTableConfig.joinOperators.map((joinOperator) => (
                  <SelectItem key={joinOperator} value={joinOperator}>
                    {joinOperator}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-muted-foreground text-sm">
              {joinOperator}
            </span>
          )}
        </div>
        <Popover open={showFieldSelector} onOpenChange={setShowFieldSelector}>
          <PopoverTrigger asChild>
            <Button
              aria-controls={fieldListboxId}
              variant="outline"
              size="sm"
              className="w-56 justify-between rounded font-normal"
              title={
                columns.find((column) => column.id === filter.id)?.columnDef
                  .meta?.label ?? labelForColumn(column)
              }
            >
              <span className="truncate">
                {columns.find((column) => column.id === filter.id)?.columnDef
                  .meta?.label ?? labelForColumn(column)}
              </span>
              <ChevronsUpDown className="opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            id={fieldListboxId}
            align="start"
            className="w-[320px] p-0"
          >
            <Command>
              <CommandInput placeholder="Search fields..." />
              <CommandList>
                <CommandEmpty>No fields found.</CommandEmpty>
                <CommandGroup>
                  {columns.map((column) => (
                    <CommandItem
                      key={column.id}
                      value={column.id}
                      onSelect={(value) => {
                        onFilterUpdate(filter.filterId, {
                          id: value as Extract<keyof TData, string>,
                          variant: column.columnDef.meta?.variant ?? "text",
                          operator: defaultFilterOperatorForColumn(column),
                          value: defaultFilterValueForColumn(column),
                        });

                        setShowFieldSelector(false);
                      }}
                    >
                      <span className="min-w-0 flex-1 whitespace-normal break-words">
                        {labelForColumn(column)}
                      </span>
                      <Check
                        className={cn(
                          "ml-auto",
                          column.id === filter.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Select
          open={showOperatorSelector}
          onOpenChange={setShowOperatorSelector}
          value={filter.operator}
          onValueChange={(value: FilterOperator) =>
            onFilterUpdate(filter.filterId, {
              operator: value,
              value:
                value === "isEmpty" || value === "isNotEmpty"
                  ? ""
                  : filter.value,
            })
          }
        >
          <SelectTrigger
            aria-controls={operatorListboxId}
            size="sm"
            className="w-32 rounded lowercase"
          >
            <div className="truncate">
              <SelectValue placeholder={filter.operator} />
            </div>
          </SelectTrigger>
          <SelectContent id={operatorListboxId}>
            {filterOperators.map((operator) => (
              <SelectItem
                key={operator.value}
                value={operator.value}
                className="lowercase"
              >
                {operator.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="min-w-36 max-w-60 flex-1">
          {onFilterInputRender({
            filter,
            inputId,
            column,
            columnMeta,
            onFilterUpdate,
            showValueSelector,
            setShowValueSelector,
          })}
        </div>
        <Button
          aria-controls={filterItemId}
          variant="outline"
          size="icon"
          className="size-8 rounded"
          onClick={() => onFilterRemove(filter.filterId)}
        >
          <Trash2 />
        </Button>
        <SortableItemHandle asChild>
          <Button variant="outline" size="icon" className="size-8 rounded">
            <GripVertical />
          </Button>
        </SortableItemHandle>
      </div>
    </SortableItem>
  );
}

function defaultFilterOperatorForColumn<TData>(
  column: Column<TData>,
): FilterOperator {
  return (
    (column.columnDef.meta?.filterOperator as FilterOperator | undefined) ??
    getDefaultFilterOperator(column.columnDef.meta?.variant ?? "text")
  );
}

function defaultFilterValueForColumn<TData>(column: Column<TData>) {
  return column.columnDef.meta?.variant === "multiSelect" ? [] : "";
}

function onFilterInputRender<TData>({
  filter,
  inputId,
  column,
  columnMeta,
  onFilterUpdate,
  showValueSelector,
  setShowValueSelector,
}: {
  filter: ExtendedColumnFilter<TData>;
  inputId: string;
  column: Column<TData>;
  columnMeta?: ColumnMeta<TData, unknown>;
  onFilterUpdate: (
    filterId: string,
    updates: Partial<Omit<ExtendedColumnFilter<TData>, "filterId">>,
  ) => void;
  showValueSelector: boolean;
  setShowValueSelector: (value: boolean) => void;
}) {
  if (filter.operator === "isEmpty" || filter.operator === "isNotEmpty") {
    return (
      <div
        id={inputId}
        role="status"
        aria-label={`${columnMeta?.label} filter is ${
          filter.operator === "isEmpty" ? "empty" : "not empty"
        }`}
        aria-live="polite"
        className="h-8 w-full rounded border bg-transparent dark:bg-input/30"
      />
    );
  }

  switch (filter.variant) {
    case "text":
    case "number":
    case "range": {
      if (
        (filter.variant === "range" && filter.operator === "isBetween") ||
        filter.operator === "isBetween"
      ) {
        return (
          <DataTableRangeFilter
            filter={filter}
            column={column}
            inputId={inputId}
            onFilterUpdate={onFilterUpdate}
          />
        );
      }

      const isNumber =
        filter.variant === "number" || filter.variant === "range";

      return (
        <Input
          id={inputId}
          type={isNumber ? "number" : filter.variant}
          aria-label={`${columnMeta?.label} filter value`}
          aria-describedby={`${inputId}-description`}
          inputMode={isNumber ? "numeric" : undefined}
          placeholder={columnMeta?.placeholder ?? "Enter a value..."}
          className="h-8 w-full rounded"
          defaultValue={
            typeof filter.value === "string" ? filter.value : undefined
          }
          onChange={(event) =>
            onFilterUpdate(filter.filterId, {
              value: event.target.value,
            })
          }
        />
      );
    }

    case "boolean": {
      if (Array.isArray(filter.value)) return null;

      const inputListboxId = `${inputId}-listbox`;

      return (
        <Select
          open={showValueSelector}
          onOpenChange={setShowValueSelector}
          value={filter.value}
          onValueChange={(value) =>
            onFilterUpdate(filter.filterId, {
              value,
            })
          }
        >
          <SelectTrigger
            id={inputId}
            aria-controls={inputListboxId}
            aria-label={`${columnMeta?.label} boolean filter`}
            size="sm"
            className="w-full rounded"
          >
            <SelectValue placeholder={filter.value ? "True" : "False"} />
          </SelectTrigger>
          <SelectContent id={inputListboxId}>
            <SelectItem value="true">True</SelectItem>
            <SelectItem value="false">False</SelectItem>
          </SelectContent>
        </Select>
      );
    }

    case "select":
    case "multiSelect": {
      const inputListboxId = `${inputId}-listbox`;

      const multiple = filter.variant === "multiSelect";
      const selectedValues = multiple
        ? Array.isArray(filter.value)
          ? filter.value
          : []
        : typeof filter.value === "string"
          ? filter.value
          : undefined;

      return (
        <Faceted
          open={showValueSelector}
          onOpenChange={setShowValueSelector}
          value={selectedValues}
          onValueChange={(value) => {
            onFilterUpdate(filter.filterId, {
              value,
            });
          }}
          multiple={multiple}
        >
          <FacetedTrigger asChild>
            <Button
              id={inputId}
              aria-controls={inputListboxId}
              aria-label={`${columnMeta?.label} filter value${multiple ? "s" : ""}`}
              variant="outline"
              size="sm"
              className="w-full rounded font-normal"
            >
              <FacetedBadgeList
                options={columnMeta?.options}
                placeholder={
                  columnMeta?.placeholder ??
                  `Select option${multiple ? "s" : ""}...`
                }
              />
            </Button>
          </FacetedTrigger>
          <FacetedContent id={inputListboxId} className="w-[200px]">
            <FacetedInput
              aria-label={`Search ${columnMeta?.label} options`}
              placeholder={columnMeta?.placeholder ?? "Search options..."}
            />
            <FacetedList>
              <FacetedEmpty>No options found.</FacetedEmpty>
              <FacetedGroup>
                {columnMeta?.options?.map((option) => (
                  <FacetedItem key={option.value} value={option.value}>
                    {option.icon && <option.icon />}
                    <span>{option.label}</span>
                    {option.count && (
                      <span className="ml-auto font-mono text-xs">
                        {option.count}
                      </span>
                    )}
                  </FacetedItem>
                ))}
              </FacetedGroup>
            </FacetedList>
          </FacetedContent>
        </Faceted>
      );
    }

    case "date":
    case "dateRange": {
      const inputListboxId = `${inputId}-listbox`;

      const dateValue = Array.isArray(filter.value)
        ? filter.value.filter(Boolean)
        : [filter.value, filter.value].filter(Boolean);

      const startDate = dateValue[0]
        ? parseFilterDate(String(dateValue[0]))
        : undefined;
      const endDate = dateValue[1]
        ? parseFilterDate(String(dateValue[1]))
        : undefined;

      const isSameDate =
        startDate &&
        endDate &&
        startDate.toDateString() === endDate.toDateString();

      const displayValue =
        filter.operator === "isBetween" && dateValue.length === 2 && !isSameDate
          ? `${formatDate(startDate, { month: "short" })} - ${formatDate(endDate, { month: "short" })}`
          : startDate
            ? formatDate(startDate, { month: "short" })
            : "Pick a date";

      return (
        <Popover open={showValueSelector} onOpenChange={setShowValueSelector}>
          <PopoverTrigger asChild>
            <Button
              id={inputId}
              aria-controls={inputListboxId}
              aria-label={`${columnMeta?.label} date filter`}
              variant="outline"
              size="sm"
              className={cn(
                "w-full justify-start rounded text-left font-normal",
                !filter.value && "text-muted-foreground",
              )}
            >
              <CalendarIcon />
              <span className="truncate">{displayValue}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            id={inputListboxId}
            align="start"
            className="w-auto p-0"
          >
            {filter.operator === "isBetween" ? (
              <Calendar
                aria-label={`Select ${columnMeta?.label} date range`}
                autoFocus
                captionLayout="dropdown"
                mode="range"
                selected={
                  dateValue.length === 2
                    ? {
                        from: parseFilterDate(String(dateValue[0])),
                        to: parseFilterDate(String(dateValue[1])),
                      }
                    : {
                        from: new Date(),
                        to: new Date(),
                      }
                }
                onSelect={(date) => {
                  onFilterUpdate(filter.filterId, {
                    value: date
                      ? [
                          date.from
                            ? formatLocalDateTime(date.from, "start")
                            : "",
                          date.to ? formatLocalDateTime(date.to, "end") : "",
                        ]
                      : [],
                  });
                }}
              />
            ) : (
              <Calendar
                aria-label={`Select ${columnMeta?.label} date`}
                autoFocus
                captionLayout="dropdown"
                mode="single"
                selected={
                  dateValue[0] ? parseFilterDate(String(dateValue[0])) : undefined
                }
                onSelect={(date) => {
                  onFilterUpdate(filter.filterId, {
                    value: date
                      ? formatLocalDateTimeForOperator(date, filter.operator)
                      : "",
                  });
                  setShowValueSelector(false);
                }}
              />
            )}
          </PopoverContent>
        </Popover>
      );
    }

    default:
      return null;
  }
}

function parseFilterDate(value: string) {
  if (!value) {
    return undefined;
  }

  const timestamp = Number(value);
  const date = Number.isFinite(timestamp) && /^\d+$/.test(value)
    ? new Date(timestamp)
    : new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatLocalDateTimeForOperator(
  date: Date,
  operator: FilterOperator,
) {
  return formatLocalDateTime(
    date,
    operator === "lt" || operator === "lte" ? "end" : "start",
  );
}

function formatLocalDateTime(date: Date, bound: "start" | "end") {
  const adjusted = new Date(date);
  if (bound === "start") {
    adjusted.setHours(0, 0, 0, 0);
  } else {
    adjusted.setHours(23, 59, 59, 999);
  }

  const pad = (value: number, length = 2) =>
    String(value).padStart(length, "0");

  return `${adjusted.getFullYear()}-${pad(adjusted.getMonth() + 1)}-${pad(
    adjusted.getDate(),
  )}T${pad(adjusted.getHours())}:${pad(adjusted.getMinutes())}:${pad(
    adjusted.getSeconds(),
  )}.${pad(adjusted.getMilliseconds(), 3)}`;
}
