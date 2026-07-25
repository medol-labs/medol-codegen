import type { Table } from "@tanstack/react-table";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useTranslate } from "@refinedev/core";

interface DataTablePaginationProps<TData> extends React.ComponentProps<"div"> {
  table: Table<TData>;
  total?: number;
  pageSizeOptions?: number[];
}

export function DataTablePagination<TData>({
  table,
  total,
  pageSizeOptions = [10, 20, 30, 40, 50],
  className,
  ...props
}: DataTablePaginationProps<TData>) {
  const t = useTranslate();
  const selectedRows = table.getFilteredSelectedRowModel().rows.length;
  const filteredRows = table.getFilteredRowModel().rows.length;
  const totalRows = typeof total === "number" ? total : filteredRows;
  const pageCount = table.getPageCount();
  const currentPage = pageCount > 0 ? table.getState().pagination.pageIndex + 1 : 0;

  return (
    <div
      className={cn(
        "flex w-full flex-col-reverse items-center justify-between gap-4 overflow-auto p-1 sm:flex-row sm:gap-8",
        className,
      )}
      {...props}
    >
      <div className="flex-1 whitespace-nowrap text-muted-foreground text-sm">
        <span className="font-medium text-foreground">
          {t("table.pagination.totalRows", { total: totalRows }, "{{total}} row(s)")}
        </span>
        {selectedRows > 0 ? (
          <span className="ml-2">
            {t("table.pagination.selectedRows", {
              selected: selectedRows,
              total: totalRows,
            }, "{{selected}} of {{total}} row(s) selected.")}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col-reverse items-center gap-4 sm:flex-row sm:gap-6 lg:gap-8">
        <div className="flex items-center space-x-2">
          <p className="whitespace-nowrap font-medium text-sm">{t("table.pagination.rowsPerPage", "Rows per page")}</p>
          <Select
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={(value) => {
              table.setPageSize(Number(value));
            }}
          >
            <SelectTrigger className="h-8 w-18 data-size:h-8">
              <SelectValue placeholder={table.getState().pagination.pageSize} />
            </SelectTrigger>
            <SelectContent side="top">
              {pageSizeOptions.map((pageSize) => (
                <SelectItem key={pageSize} value={`${pageSize}`}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-center font-medium text-sm">
          {t("table.pagination.pageOf", {
            page: currentPage,
            pageCount,
          }, "Page {{page}} of {{pageCount}}")}
        </div>
        <div className="flex items-center space-x-2">
          <Button
            aria-label={t("table.pagination.firstPage", "Go to first page")}
            variant="outline"
            size="icon"
            className="hidden size-8 lg:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronsLeft />
          </Button>
          <Button
            aria-label={t("table.pagination.previousPage", "Go to previous page")}
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft />
          </Button>
          <Button
            aria-label={t("table.pagination.nextPage", "Go to next page")}
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight />
          </Button>
          <Button
            aria-label={t("table.pagination.lastPage", "Go to last page")}
            variant="outline"
            size="icon"
            className="hidden size-8 lg:flex"
            onClick={() => table.setPageIndex(Math.max(pageCount - 1, 0))}
            disabled={!table.getCanNextPage()}
          >
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
