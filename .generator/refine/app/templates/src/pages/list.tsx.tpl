// Generated from config.json by the refine generator.
import { useTable } from "@refinedev/react-table";
import { useTranslate } from "@refinedev/core";
import { createColumnHelper } from "@tanstack/react-table";
import React from "react";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { CommandButton } from "@/components/refine-ui/buttons/command";
import { EditButton } from "@/components/refine-ui/buttons/edit";
import { ShowButton } from "@/components/refine-ui/buttons/show";
import { RefineDataTable } from "@/components/refine-ui/data-table/refine-data-table";
import {
  ListToolbar,
  ListView,
  ListViewHeader
} from "@/components/refine-ui/views/list-view";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
<% if (resource.valueTypeImports.length) { -%>
import type { <%= resource.valueTypeImports.join(', ') %> } from "@/domain/value-types";
<% } -%>

type <%= resource.component %>Record = {
<% resource.fields.forEach((field) => { -%>
  <%= field.name %><%= field.optional ? "?" : "" %>: <%= field.tsType %>;
<% }) -%>
};

export const <%= resource.component %>List = () => {
  const t = useTranslate();
  const columns = React.useMemo(() => {
    const columnHelper = createColumnHelper<<%= resource.component %>Record>();
    return [
      columnHelper.display({
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label={t("table.selectAll", "Select all")}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={t("table.selectRow", "Select row")}
          />
        ),
        size: 32,
        enableSorting: false,
        enableHiding: false,
      }),
<% resource.fields.forEach((field) => { -%>
      columnHelper.accessor("<%= field.name %>", {
        id: "<%= field.name %>",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} label={t("<%= field.i18nKey %>", "<%= field.label %>")} />
        ),
        enableSorting: true,
        enableColumnFilter: <%= field.filterable ? "true" : "false" %>,
        cell: ({ getValue }) => <%- field.cellValue %>,
      }),
<% }) -%>
      columnHelper.display({
        id: "actions",
        header: t("table.actions", "Actions"),
        cell: ({ row }) => (
          <div className="flex gap-2">
<% if (resource.deleteCommand) { -%>
            <CommandButton
              variant="ghost"
              command="<%= resource.deleteCommand.name %>"
              recordItemId={row.original.<%= resource.idField %>}
              size="sm"
<% if (resource.deleteCommand.enabledField) { -%>
              disabled={row.original.<%= resource.deleteCommand.enabledField %> === false}
<% } -%>
<% if (resource.deleteCommand.prefillFields.length > 0) { -%>
              query={{
<% resource.deleteCommand.prefillFields.forEach((field) => { -%>
                <%= field.name %>: row.original.<%= field.name %>,
<% }) -%>
              }}
<% } -%>
            />
<% } -%>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
<% if (resource.editCommand) { -%>
                <DropdownMenuItem>
                  <EditButton variant="ghost" recordItemId={row.original.<%= resource.idField %>} size="sm" />
                </DropdownMenuItem>
<% } -%>
<% resource.itemCommands.forEach((command) => { -%>
                <DropdownMenuItem>
                  <CommandButton
                    variant="ghost"
                    command="<%= command.name %>"
                    recordItemId={row.original.<%= resource.idField %>}
                    size="sm"
<% if (command.enabledField) { -%>
                    disabled={row.original.<%= command.enabledField %> === false}
<% } -%>
<% if (command.prefillFields.length > 0) { -%>
                    query={{
<% command.prefillFields.forEach((field) => { -%>
                      <%= field.name %>: row.original.<%= field.name %>,
<% }) -%>
                    }}
<% } -%>
                  />
                </DropdownMenuItem>
<% }) -%>
                <DropdownMenuItem>
                  <ShowButton variant="ghost" recordItemId={row.original.<%= resource.idField %>} size="sm" />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
        enableSorting: false,
        size: 32,
      }),
    ];
  }, [t]);

  const table = useTable({
    columns,
    initialState: {
      columnPinning: { right: ["actions"], left: ["select"] },
    },
    getRowId: (row) => <%- resource.rowIdExpression %>,
    refineCoreProps: {
      syncWithLocation: true,
      meta: {
        tableName: "<%= resource.tableName %>",
        idField: "<%= resource.idField %>",
        idFields: <%- JSON.stringify(resource.idFields) %>,
        label: t("<%= resource.i18nKey %>", "<%= resource.label %>"),
        aggregateRoute: "<%= resource.aggregateRoute %>",
        queryRoute: "<%= resource.queryRoute %>",
      },
    },
  });

  return (
    <ListView>
      <ListViewHeader canCreate={false}>
<% if (resource.createCommand) { -%>
        <CommandButton variant="ghost" command="<%= resource.createCommand.name %>" size="sm" />
<% } -%>
      </ListViewHeader>
      <RefineDataTable table={table} actionBar={
<% if (resource.deleteCommand) { -%>
        <CommandButton variant="ghost" command="<%= resource.deleteCommand.name %>" size="sm" />
<% } else { -%>
        null
<% } -%>
      }>
        <ListToolbar table={table.reactTable} />
      </RefineDataTable>
    </ListView>
  );
};
