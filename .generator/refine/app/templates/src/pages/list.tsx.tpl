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
  <%= field.name %><%= field.optional ? "?" : "" %>: <%- field.tsType %>;
<% }) -%>
};

const normalizeWorkflowState = (value: unknown) =>
  String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();

const isCommandVisible = (
  record: <%= resource.component %>Record,
  enabledField?: string,
  stateField?: string,
  allowedStates: string[] = [],
) => {
  const row = record as Record<string, unknown>;
  if (enabledField && row[enabledField] === false) return false;
  if (allowedStates.length === 0) return true;
  if (!stateField) return false;
  const currentState = normalizeWorkflowState(row[stateField]);
  return allowedStates.map(normalizeWorkflowState).includes(currentState);
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
            {isCommandVisible(row.original, <%- JSON.stringify(resource.deleteCommand.enabledField ?? '') %>, <%- JSON.stringify(resource.deleteCommand.stateField ?? '') %>, <%- JSON.stringify(resource.deleteCommand.allowedStates ?? []) %>) && (
            <CommandButton
              variant="outline"
              command="<%= resource.deleteCommand.name %>"
              recordItemId={row.original.<%= resource.idField %>}
              size="sm"
<% if (resource.deleteCommand.rowPrefillFields.length > 0) { -%>
              query={{
<% resource.deleteCommand.rowPrefillFields.forEach((field) => { -%>
                <%= field.name %>: row.original.<%= field.name %>,
<% }) -%>
              }}
<% } -%>
            />
            )}
<% } -%>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
<% if (resource.editCommand) { -%>
                {isCommandVisible(row.original, <%- JSON.stringify(resource.editCommand.enabledField ?? '') %>, <%- JSON.stringify(resource.editCommand.stateField ?? '') %>, <%- JSON.stringify(resource.editCommand.allowedStates ?? []) %>) && (
                <DropdownMenuItem>
                  <EditButton variant="ghost" recordItemId={row.original.<%= resource.idField %>} size="sm" />
                </DropdownMenuItem>
                )}
<% } -%>
<% resource.itemCommands.forEach((command) => { -%>
                {isCommandVisible(row.original, <%- JSON.stringify(command.enabledField ?? '') %>, <%- JSON.stringify(command.stateField ?? '') %>, <%- JSON.stringify(command.allowedStates ?? []) %>) && (
                <DropdownMenuItem>
                  <CommandButton
                    variant="ghost"
                    command="<%= command.name %>"
                    recordItemId={row.original.<%= resource.idField %>}
                    size="sm"
<% if (command.rowPrefillFields.length > 0) { -%>
                    query={{
<% command.rowPrefillFields.forEach((field) => { -%>
                      <%= field.name %>: row.original.<%= field.name %>,
<% }) -%>
                    }}
<% } -%>
                  />
                </DropdownMenuItem>
                )}
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
      dataProviderName: "<%= resource.dataProviderName %>",
      syncWithLocation: true,
      meta: {
        tableName: "<%= resource.tableName %>",
        idField: "<%= resource.idField %>",
        idFields: <%- JSON.stringify(resource.idFields) %>,
        label: t("<%= resource.i18nKey %>", "<%= resource.label %>"),
        aggregateRoute: "<%= resource.aggregateRoute %>",
        queryRoute: "<%= resource.queryRoute %>",
        dataProviderName: "<%= resource.dataProviderName %>",
      },
    },
  });

  return (
    <ListView>
      <ListViewHeader canCreate={false}>
<% if (resource.createCommand) { -%>
        <CommandButton variant="default" command="<%= resource.createCommand.name %>" />
<% } -%>
      </ListViewHeader>
      <RefineDataTable table={table} actionBar={
<% if (resource.deleteCommand) { -%>
        <CommandButton variant="destructive" command="<%= resource.deleteCommand.name %>" size="sm" />
<% } else { -%>
        null
<% } -%>
      }>
        <ListToolbar table={table.reactTable} />
      </RefineDataTable>
    </ListView>
  );
};
