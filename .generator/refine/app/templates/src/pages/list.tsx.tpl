// Generated from config.json by the refine generator.
import { useTable } from "@refinedev/react-table";
import { <% if (resource.exportable) { -%>useNotification, <% } -%>useTranslate<% if (resource.exportable) { -%>, type CrudFilter, type CrudSorting<% } -%> } from "@refinedev/core";
import { createColumnHelper } from "@tanstack/react-table";
<% if (resource.exportable) { -%>
import { Download } from "lucide-react";
<% } -%>
import React from "react";

import { frontendComposition } from "@/app/composition/composition.resolved";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { CommandButton } from "@/components/refine-ui/buttons/command";
import { ShowButton } from "@/components/refine-ui/buttons/show";
import { RefineDataTable } from "@/components/refine-ui/data-table/refine-data-table";
import { RowActionMenu } from "@/components/refine-ui/row-action-menu";
import {
  ListToolbar,
  ListView,
  ListViewHeader
} from "@/components/refine-ui/views/list-view";
import { Checkbox } from "@/components/ui/checkbox";
<% if (resource.exportable) { -%>
import { Button } from "@/components/ui/button";
import { requestDataExport, type DataExportColumn } from "@/lib/data-export";
<% } -%>
import { useDictionaryTranslation } from "@/lib/dictionary-i18n";
import { renderFieldOverride, renderSlotExtensions } from "@/platform/composition";
<% if (resource.hasLongTextFields) { -%>
import { CopyableText } from "@/components/refine-ui/fields/copyable-text";
<% } -%>
<% if (resource.valueTypeImports.length) { -%>
import type { <%= resource.valueTypeImports.join(', ') %> } from "@/contexts/domain/value-types";
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

const formatValue = (
  value: unknown,
  t: ReturnType<typeof useTranslate>,
  dictionaryLabel: ReturnType<typeof useDictionaryTranslation>["dictionaryLabel"],
  options?: Array<{ label: string; value: string }>,
  dictionaryCode?: string,
): string => {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) {
    const formatted: string[] = value.map((item) => formatValue(item, t, dictionaryLabel, options, dictionaryCode)).filter((item) => item !== "-");
    return formatted.length > 0 ? formatted.join(", ") : "-";
  }
  if (typeof value === "boolean") return value ? t("values.boolean.true", "True") : t("values.boolean.false", "False");
  const stringValue = String(value);
  if (dictionaryCode) return dictionaryLabel(dictionaryCode, stringValue, t(`dictionaries.${dictionaryCode}.${stringValue}`, stringValue));
  return options?.find((option) => option.value === stringValue)?.label ?? stringValue;
};

export const <%= resource.component %>List = () => {
  const t = useTranslate();
<% if (resource.exportable) { -%>
  const { open } = useNotification();
  const [isExporting, setIsExporting] = React.useState(false);
<% } -%>
  const { dictionaryLabel } = useDictionaryTranslation();
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
        meta: {
          label: t("<%= field.i18nKey %>", "<%= field.label %>"),
<% if (field.dictionary) { -%>
          dictionaryCode: "<%= field.dictionary %>",
<% } -%>
          placeholder: <%- JSON.stringify(field.placeholder) %>,
          variant: "<%= field.filterVariant %>",
<% if (field.filterOperator) { -%>
          filterOperator: "<%= field.filterOperator %>",
<% } -%>
<% if (field.enumOptions.length > 0) { -%>
          options: [
<% field.enumOptions.forEach((option) => { -%>
            { label: t("<%= option.i18nKey %>", <%- JSON.stringify(option.label) %>), value: <%- JSON.stringify(option.value) %> },
<% }) -%>
          ],
<% } -%>
        },
        cell: ({ getValue, row }) =>
          renderFieldOverride<<%= resource.component %>Record>(
            frontendComposition,
            "field:<%= resource.route %>:display:<%= field.name %>",
            {
              value: getValue(),
              record: row.original,
              resource: "<%= resource.route %>",
              field: "<%= field.name %>",
              view: "display",
              compact: true,
            },
          ) ?? <% if (field.enumOptions.length > 0) { -%>formatValue(getValue(), t, dictionaryLabel, [
<% field.enumOptions.forEach((option) => { -%>
            { label: t("<%= option.i18nKey %>", <%- JSON.stringify(option.label) %>), value: <%- JSON.stringify(option.value) %> },
<% }) -%>
          ]<% if (field.dictionary) { -%>, "<%= field.dictionary %>"<% } -%>)<% } else if (field.dictionary) { -%>formatValue(getValue(), t, dictionaryLabel, undefined, "<%= field.dictionary %>")<% } else { -%><%- field.cellValue %><% } -%>,
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
            <RowActionMenu>
              {renderSlotExtensions<<%= resource.component %>Record>(
                frontendComposition,
                "row-actions:<%= resource.route %>:list",
                "rowActions.before",
                { resource: "<%= resource.route %>", record: row.original },
              )}
<% resource.itemCommands.forEach((command) => { -%>
                {isCommandVisible(row.original, <%- JSON.stringify(command.enabledField ?? '') %>, <%- JSON.stringify(command.stateField ?? '') %>, <%- JSON.stringify(command.allowedStates ?? []) %>) && (
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
                )}
<% }) -%>
              <ShowButton variant="ghost" recordItemId={row.original.<%= resource.idField %>} size="sm" />
              {renderSlotExtensions<<%= resource.component %>Record>(
                frontendComposition,
                "row-actions:<%= resource.route %>:list",
                "rowActions.after",
                { resource: "<%= resource.route %>", record: row.original },
              )}
            </RowActionMenu>
          </div>
        ),
        enableSorting: false,
        size: 32,
      }),
    ];
  }, [dictionaryLabel, t]);

  const table = useTable({
    columns,
    initialState: {
      columnPinning: { right: ["actions"], left: ["select"] },
    },
    getRowId: (row) => <%- resource.rowIdExpression %>,
    refineCoreProps: {
      dataProviderName: "<%= resource.dataProviderName %>",
      syncWithLocation: false,
      meta: {
        tableName: "<%= resource.tableName %>",
        idField: "<%= resource.idField %>",
        idFields: <%- JSON.stringify(resource.idFields) %>,
        queryFields: <%- JSON.stringify(resource.queryFields) %>,
        label: t("<%= resource.i18nKey %>", "<%= resource.label %>"),
        aggregateRoute: "<%= resource.aggregateRoute %>",
        queryRoute: "<%= resource.queryRoute %>",
        dataProviderName: "<%= resource.dataProviderName %>",
      },
    },
  });

<% if (resource.exportable) { -%>
  const handleExport = React.useCallback(async () => {
    setIsExporting(true);
    try {
      const tableState = table.reactTable.getState();
      const filters: CrudFilter[] = tableState.columnFilters.flatMap((filter) => {
        const currentFilter = filter as { id: string; operator?: string; value?: unknown };
        if (!currentFilter.operator) {
          return [];
        }
        return [{
          field: currentFilter.id,
          operator: currentFilter.operator,
          value: currentFilter.value,
        } as CrudFilter];
      });
      const sorters: CrudSorting = tableState.sorting.map((sort) => ({
        field: sort.id,
        order: sort.desc ? "desc" : "asc",
      }));
<% if (resource.idFields.length === 1) { -%>
      const selectedIds = Object.entries(tableState.rowSelection)
        .filter(([, selected]) => selected)
        .map(([id]) => id);
<% } -%>
      const exportFilters: CrudFilter[] = <% if (resource.idFields.length === 1) { -%>selectedIds.length > 0
        ? [...filters, { field: "<%= resource.idField %>", operator: "in", value: selectedIds } as CrudFilter]
        : filters<% } else { -%>filters<% } -%>;
      const columns: DataExportColumn[] = table.reactTable
        .getAllLeafColumns()
        .filter((column) => column.getIsVisible())
        .filter((column) => !["select", "actions"].includes(column.id))
        .map((column) => ({
          field: column.id,
          label: String(column.columnDef.meta?.label ?? column.id),
          dictionaryCode: typeof column.columnDef.meta?.dictionaryCode === "string"
            ? column.columnDef.meta.dictionaryCode
            : undefined,
        }));
      const result = await requestDataExport({
        aggregateRoute: "<%= resource.aggregateRoute %>",
        queryRoute: "<%= resource.queryRoute %>",
        dataProviderName: "<%= resource.dataProviderName %>",
        filters: exportFilters,
        sorters,
        columns,
      });
      open?.({
        type: "success",
        message: result.kind === "job"
          ? t("dataExport.jobCreated", "Export job created")
          : t("dataExport.downloadStarted", "Export download started"),
        description: result.kind === "job" ? result.jobId : result.filename,
      });
    } catch (error) {
      open?.({
        type: "error",
        message: t("dataExport.failed", "Export failed"),
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsExporting(false);
    }
  }, [open, table, t]);

<% } -%>

  return (
    <ListView>
      <ListViewHeader canCreate={false}>
        {renderSlotExtensions(frontendComposition, "toolbar:<%= resource.route %>:list", "toolbar.before", { resource: "<%= resource.route %>", table })}
<% if (resource.createCommand) { -%>
        <CommandButton variant="default" command="<%= resource.createCommand.name %>" />
<% } -%>
        {renderSlotExtensions(frontendComposition, "toolbar:<%= resource.route %>:list", "toolbar.actions", { resource: "<%= resource.route %>", table })}
      </ListViewHeader>
      <RefineDataTable table={table} actionBar={
<% if (resource.deleteCommand) { -%>
        <CommandButton variant="destructive" command="<%= resource.deleteCommand.name %>" size="sm" />
<% } else { -%>
        null
<% } -%>
      }>
        <ListToolbar
          table={table.reactTable}
          isQuerying={table.refineCore.tableQuery.isFetching}
          onQuery={() => table.refineCore.tableQuery.refetch()}
        >
<% if (resource.exportable) { -%>
          <Button type="button" variant="outline" size="sm" onClick={handleExport} disabled={isExporting}>
            <Download className="size-4" />
            {isExporting
              ? t("dataExport.exporting", "Exporting")
<% if (resource.idFields.length === 1) { -%>
              : Object.values(table.reactTable.getState().rowSelection).some(Boolean)
                ? t("dataExport.exportSelected", "Export selected")
                : t("dataExport.export", "Export")<% } else { -%>
              : t("dataExport.export", "Export")<% } -%>}
          </Button>
<% } -%>
        </ListToolbar>
        {renderSlotExtensions(frontendComposition, "toolbar:<%= resource.route %>:list", "toolbar.after", { resource: "<%= resource.route %>", table })}
      </RefineDataTable>
    </ListView>
  );
};
