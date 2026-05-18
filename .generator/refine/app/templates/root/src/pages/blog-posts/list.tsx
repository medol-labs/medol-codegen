import { useGo, useList, useParsed } from "@refinedev/core";
import { useTable } from "@refinedev/react-table";
import { createColumnHelper } from "@tanstack/react-table";
import React from "react";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { CommandButton } from "@/components/refine-ui/buttons/command";
import { DeleteButton } from "@/components/refine-ui/buttons/delete";
import { EditButton } from "@/components/refine-ui/buttons/edit";
import { ShowButton } from "@/components/refine-ui/buttons/show";
import { RefineDataTable } from "@/components/refine-ui/data-table/refine-data-table";
import {
  ListToolbar,
  ListView,
  ListViewHeader
} from "@/components/refine-ui/views/list-view";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal } from "lucide-react";
import { CreateButton } from "@/components/refine-ui/buttons/create";

type BlogPost = {
  id: string;
  title: string;
  content: string;
  status: string;
  createdAt: string;
  categories: { id: string; title: string };
};

export const BlogPostList = () => {
  const { resource } = useParsed();
  // fetch all categories to use in the combobox filter
  const {
    result: { data: categories },
    query: { isLoading: categoryIsLoading },
  } = useList({
    resource: "categories",
    pagination: {
      currentPage: 1,
      pageSize: 999,
    },
  });

  const columns = React.useMemo(() => {
    const columnHelper = createColumnHelper<BlogPost>();
    return [
      columnHelper.display({
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        ),
        size: 32,
        enableSorting: false,
        enableHiding: false,
      }),
      columnHelper.accessor("id", {
        id: "id",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} label="ID"></DataTableColumnHeader>
        },
        enableSorting: true,
      }),
      columnHelper.accessor("title", {
        id: "title",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} label="Title"></DataTableColumnHeader>
        },
        enableSorting: true,
        enableColumnFilter: true,
      }),
      columnHelper.accessor("content", {
        id: "content",
        header: "Content",
        enableSorting: false,
        cell: ({ getValue }) => {
          const content = getValue();
          if (!content) return "-";
          return (
            <div className="max-w-xs truncate">{content.slice(0, 80)}...</div>
          );
        },
      }),
      columnHelper.accessor("categories.title", {
        id: "category",
        header: "Category",
        enableSorting: false,
        cell: ({ row }) => {
          const categoryId = row.original.categories?.id;
          const category = categories?.find((item) => item.id === categoryId);
          return categoryIsLoading ? "Loading..." : category?.title || "-";
        },
      }),
      columnHelper.accessor("status", {
        id: "status",
        header: "Status",
        enableSorting: true,
        cell: ({ getValue }) => {
          const status = getValue();
          return (
            <Badge variant={status === "published" ? "default" : "secondary"}>
              {status}
            </Badge>
          );
        },
      }),
      columnHelper.accessor("createdAt", {
        id: "createdAt",
        header: "Created At",
        enableSorting: true,
        cell: ({ getValue }) => {
          const date = getValue();
          return date ? new Date(date).toLocaleDateString() : "-";
        },
      }),
      columnHelper.display({
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex gap-2">
            <DeleteButton recordItemId={row.original.id} size="sm" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem><EditButton variant="ghost" recordItemId={row.original.id} size="sm" /></DropdownMenuItem>
                <DropdownMenuItem><CommandButton variant="ghost" command="approve" recordItemId={row.original.id} size="sm" /></DropdownMenuItem>
                <DropdownMenuItem>
                  <ShowButton variant="ghost" recordItemId={row.original.id} size="sm" />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
        enableSorting: false,
        size: 32,
      }),
    ];
  }, [categories, categoryIsLoading]);

  const table = useTable({
    columns,
    initialState: {
      sorting: [{ id: "title", desc: true }],
      columnPinning: { right: ["actions"], left: ["select"] },
    },
    getRowId: (row) => row.id,
    refineCoreProps: {
      syncWithLocation: true,
      dataProviderName: "command",
      meta: {
        select: "*, categories(id,title)",
      },
    },
  });

  return (
    <ListView>
      <ListViewHeader canCreate={false} />
      <RefineDataTable table={table} actionBar={
        <div className="flex items-center justify-center gap-2">
          <DeleteButton size="sm" />
        </div>
      }>
        <ListToolbar table={table.reactTable} />
      </RefineDataTable>
    </ListView>
  );
};
