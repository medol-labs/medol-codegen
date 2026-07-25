import type { BaseRecord, HttpError } from "@refinedev/core";
import type { UseTableReturnType } from "@refinedev/react-table";

import { DataTable } from "@/components/data-table/data-table";
import { DataTableAdvancedToolbar } from "@/components/data-table/data-table-advanced-toolbar";
import { DataTableSortList } from "@/components/data-table/data-table-sort-list";
import { useDataTable } from "@/hooks/use-data-table";

interface RefineDataTableProps<TData extends BaseRecord> {
  table: UseTableReturnType<TData, HttpError>;
  actionBar?: React.ReactNode;
  children?: React.ReactNode;
}

const getTotal = <TData extends BaseRecord>(table: UseTableReturnType<TData, HttpError>) => {
  const refineCore = table.refineCore as Record<string, unknown>;
  const tableQuery = refineCore.tableQuery as Record<string, unknown> | undefined;
  const queryData = tableQuery?.data as Record<string, unknown> | undefined;
  const result = refineCore.result as Record<string, unknown> | undefined;

  const candidates = [
    queryData?.total,
    queryData?.rowCount,
    queryData?.data && typeof queryData.data === "object"
      ? (queryData.data as Record<string, unknown>).total
      : undefined,
    result?.total,
    refineCore.total,
  ];

  return candidates.find((value): value is number => typeof value === "number");
};

export function RefineDataTable<TData extends BaseRecord>({
  table,
  actionBar,
  children,
}: RefineDataTableProps<TData>) {
  const {
    reactTable,
    refineCore: { tableQuery },
  } = table;

  // loading / empty 由 refine adapter 决定
  if (tableQuery.isLoading) {
    return <div className="flex h-48 items-center justify-center">Loading…</div>;
  }

  return (
    <DataTable table={reactTable} actionBar={actionBar} total={getTotal(table)}>
      {children}
    </DataTable >
  );
}

RefineDataTable.displayName = "RefineDataTable";
