import type { Table } from "@tanstack/react-table"
import { ActionBar, ActionBarClose, ActionBarGroup, ActionBarItem, ActionBarSelection, ActionBarSeparator } from "../ui/action-bar"
import { Download, X } from "lucide-react"
import { DeleteButton } from "../refine-ui/buttons/delete"
import { exportTableToCSV } from "@/lib/export"
import React from "react"

type TableActionBarProps<TData> = {
  table: Table<TData>
  side?: "top" | "bottom"
  enableExport?: boolean,
  enableDelete?: boolean,
  actions?: (ctx: {
    selectedRows: TData[]
    clearSelection: () => void
  }) => React.ReactNode
}

export function TableActionBar<TData>({
  table,
  side = "top",
  actions,
  enableExport,
  enableDelete,
}: TableActionBarProps<TData>) {
  const selectedRowModel = table.getFilteredSelectedRowModel()
  const selectedCount = selectedRowModel.rows.length

  const open = selectedCount > 0

  const clearSelection = () => {
    table.resetRowSelection()
  }

  if (!open) return null

  const onTaskExport = React.useCallback(() => {
    exportTableToCSV(table, {
      excludeColumns: ["select", "actions"],
      onlySelected: true,
    });
  }, [table]);

  return (
    <ActionBar open side={side}>
      <ActionBarSelection>
        {selectedCount} selected
        <ActionBarSeparator />
        <ActionBarClose onClick={clearSelection}>
          <X />
        </ActionBarClose>
      </ActionBarSelection>

      <ActionBarSeparator />

      <ActionBarGroup>
        {enableExport && <ActionBarItem onClick={onTaskExport}>
          <Download />
          Export
        </ActionBarItem>}
        {enableDelete && <DeleteButton size="sm" />}

        {(enableExport || enableDelete) && <ActionBarSeparator />}

        {actions?.({
          selectedRows: selectedRowModel.rows.map(r => r.original),
          clearSelection,
        })}
        {actions && <ActionBarSeparator />}
      </ActionBarGroup>

      <ActionBarClose onClick={clearSelection}>
        <X />
      </ActionBarClose>
    </ActionBar>
  )
}
