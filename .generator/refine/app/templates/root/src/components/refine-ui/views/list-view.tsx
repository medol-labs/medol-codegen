"use client";

import type { PropsWithChildren } from "react";

import { CreateButton } from "@/components/refine-ui/buttons/create";
import { Breadcrumb } from "@/components/refine-ui/layout/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useResourceParams, useTranslate, useUserFriendlyName } from "@refinedev/core";
import { type Table as TanstackTable } from "@tanstack/react-table";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { DataTableFilterList } from "@/components/data-table/data-table-filter-list";
import { DataTableSortList } from "@/components/data-table/data-table-sort-list";

type ListViewProps = PropsWithChildren<{
  className?: string;
}>;

export function ListView({ children, className }: ListViewProps) {
  return (
    <div className={cn("flex flex-col", "gap-4", className)}>{children}</div>
  );
}

type ListHeaderProps = PropsWithChildren<{
  resource?: string;
  title?: string;
  canCreate?: boolean;
  headerClassName?: string;
  wrapperClassName?: string;
  children?: any;
}>;

interface DataTableProps<TData> extends React.ComponentProps<"div"> {
  table: TanstackTable<TData>;
}

export const ListToolbar = <TData,>({
  table
}: DataTableProps<TData>) => {
  return (<DataTableToolbar table={table} >
    <DataTableFilterList table={table} />
    <DataTableSortList table={table}></DataTableSortList>
  </DataTableToolbar >
  );
}

export const ListViewHeader = ({
  canCreate,
  resource: resourceFromProps,
  title: titleFromProps,
  wrapperClassName,
  headerClassName,
  children,
}: ListHeaderProps) => {
  const getUserFriendlyName = useUserFriendlyName();
  const translate = useTranslate();

  const { resource, identifier } = useResourceParams({
    resource: resourceFromProps,
  });
  const resourceName = identifier ?? resource?.name;

  const isCreateButtonVisible = canCreate ?? !!resource?.create;

  const title =
    titleFromProps ??
    getUserFriendlyName(
      resource?.meta?.i18nKey
        ? translate(resource.meta.i18nKey, resource?.meta?.label ?? identifier ?? resource?.name)
        : resource?.meta?.label ?? identifier ?? resource?.name,
      "plural"
    );

  return (
    <div className={cn("flex flex-col", "gap-4", "overflow-x-auto", wrapperClassName)}>
      <div className="flex items-center relative gap-2">
        <div className="bg-background z-[2] pr-4">
          <Breadcrumb />
        </div>
        <Separator className={cn("absolute", "left-0", "right-0", "z-[1]")} />
      </div>
      <div className={cn("flex", "justify-between", "gap-4", headerClassName)}>
        <h2 className="text-2xl font-bold">{title}</h2>
        <div className="flex items-center gap-2">
          {children && (
            <div className="flex items-center gap-2">
              {children}
            </div>
          )}
          {isCreateButtonVisible && (
            <div className="flex items-center gap-2">
              <CreateButton resource={resourceName} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

ListView.displayName = "ListView";
