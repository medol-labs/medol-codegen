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
    <DataTable table={reactTable} actionBar={actionBar}>
      {children}
    </DataTable >
  );
}

RefineDataTable.displayName = "RefineDataTable";
