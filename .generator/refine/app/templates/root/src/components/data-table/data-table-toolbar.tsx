"use client";

import type { Table } from "@tanstack/react-table";
import { X } from "lucide-react";
import * as React from "react";

import { DataTableViewOptions } from "@/components/data-table/data-table-view-options";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DATA_TABLE_RESET_FILTERS_EVENT = "medol:data-table:reset-filters";

interface DataTableToolbarProps<TData> extends React.ComponentProps<"div"> {
  table: Table<TData>;
}

export function DataTableToolbar<TData>({
  table,
  children,
  className,
  ...props
}: DataTableToolbarProps<TData>) {
  const columnFilters = table.getState().columnFilters;
  const isFiltered = columnFilters.length > 0;

  const filteredColumnIds = React.useMemo(
    () => new Set(columnFilters.map((filter) => filter.id)),
    [columnFilters],
  );

  const activeFilters = React.useMemo(
    () =>
      table
        .getAllColumns()
        .filter(
          (column) => column.getCanFilter() && filteredColumnIds.has(column.id),
        )
        .map((column) => ({
          id: column.id,
          label: labelForColumn(column.id, column.columnDef.meta?.label),
          value: formatFilterValue(
            column.getFilterValue(),
            column.columnDef.meta?.options,
          ),
        }))
        .filter((filter) => filter.value.length > 0),
    [filteredColumnIds, table],
  );

  const onReset = React.useCallback(() => {
    table.resetColumnFilters();
    window.dispatchEvent(new CustomEvent(DATA_TABLE_RESET_FILTERS_EVENT));
  }, [table]);

  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      className={cn(
        "flex w-full min-w-0 items-center justify-between gap-2 p-1",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {activeFilters.map((filter) => (
          <Badge
            key={filter.id}
            variant="outline"
            className="h-8 max-w-[260px] shrink-0 justify-start gap-1.5 rounded-md border-dashed bg-background px-2.5 font-normal"
            title={`${filter.label}: ${filter.value}`}
          >
            <span className="max-w-[120px] truncate text-muted-foreground">
              {filter.label}
            </span>
            <span className="text-muted-foreground">:</span>
            <span className="max-w-[120px] truncate font-medium text-foreground">
              {filter.value}
            </span>
          </Badge>
        ))}
        {isFiltered && (
          <Button
            aria-label="Reset filters"
            variant="outline"
            size="sm"
            className="shrink-0 border-dashed"
            onClick={onReset}
          >
            <X />
            Reset
          </Button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <DataTableViewOptions table={table} align="end" />
        {children}
      </div>
    </div>
  );
}

function labelForColumn(columnId: string, label?: string) {
  return (
    label ??
    columnId
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

function formatFilterValue(
  value: unknown,
  options?: { label: string; value: string }[],
) {
  if (Array.isArray(value)) {
    return value
      .filter(Boolean)
      .map((item) => optionLabel(String(item), options))
      .join(", ");
  }

  if (value === true) {
    return "Yes";
  }

  if (value === false) {
    return "No";
  }

  if (value === null || value === undefined) {
    return "";
  }

  return optionLabel(String(value), options);
}

function optionLabel(value: string, options?: { label: string; value: string }[]) {
  return options?.find((option) => option.value === value)?.label ?? value;
}
