import { useTable } from "@refinedev/react-table";
import { useTable as refineUseTable } from "@refinedev/core";
import { createColumnHelper } from "@tanstack/react-table";
import React from "react";

import { CommandButton } from "@/components/refine-ui/buttons/command";
import { DeleteButton } from "@/components/refine-ui/buttons/delete";
import { EditButton } from "@/components/refine-ui/buttons/edit";
import { ListButton } from "@/components/refine-ui/buttons/list";
import { RefreshButton } from "@/components/refine-ui/buttons/refresh";
import { ShowButton } from "@/components/refine-ui/buttons/show";
import { RefineDataTable } from "@/components/refine-ui/data-table/refine-data-table";
import {
  ListView,
  ListViewHeader,
} from "@/components/refine-ui/views/list-view";
import { useDataGrid } from "@/hooks/use-data-grid";
import { RefineDataGridAdapter } from "@/components/refine-ui/data-table/refine-data-grid";

type Category = {
  id: string;
  title: string;
};

export const CategoryList = () => {
  const columns = React.useMemo(() => {
    const columnHelper = createColumnHelper<Category>();

    return [
      columnHelper.accessor("id", {
        id: "id",
        header: "ID",
        enableSorting: false,
      }),
      columnHelper.accessor("title", {
        id: "title",
        header: "Title",
        enableSorting: true,
      }),
      columnHelper.display({
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex gap-2">
            <EditButton recordItemId={row.original.id} size="sm" />
            <ShowButton recordItemId={row.original.id} size="sm" />
            <DeleteButton recordItemId={row.original.id} size="sm" />
          </div>
        ),
        enableSorting: false,
        size: 290,
      }),
    ];
  }, []);

  const table = useTable({
    columns,
    refineCoreProps: {
      syncWithLocation: true,
    },
  });
  const tableResult = refineUseTable<Category>({

  });

  const dataGrid = useDataGrid({
    data: tableResult.tableQuery.data?.data ?? [],
    columns,
    getRowId: (row) => row.id,
    meta: {
      // ★ 把 refine 的能力塞进 tableMeta

    },
  });

  return (
    <ListView>
      <ListViewHeader>
        <ListButton variant="outline">
          <RefreshButton></RefreshButton>
          <RefreshButton></RefreshButton>
          <RefreshButton></RefreshButton>
        </ListButton>
      </ListViewHeader>
      <RefineDataGridAdapter dataGrid={dataGrid}></RefineDataGridAdapter>
    </ListView>
  );
};
