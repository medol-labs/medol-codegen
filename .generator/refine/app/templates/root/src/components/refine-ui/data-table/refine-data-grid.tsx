import { DataGrid } from "@/components/data-grid/data-grid";
import { useDataGrid } from "@/hooks/use-data-grid";
import { BaseRecord, HttpError, useCreate, useUpdate } from "@refinedev/core";
import { UseTableReturnType } from "@refinedev/react-table";
import React from "react";

export function RefineDataGridAdapter<TData extends BaseRecord>({
  dataGrid,
}: {
  dataGrid: ReturnType<typeof useDataGrid<TData>>;
}) {
  return (
    <DataGrid
      {...dataGrid}
      tableMeta={{
        ...dataGrid.tableMeta,
      }}
    />
  );
}
