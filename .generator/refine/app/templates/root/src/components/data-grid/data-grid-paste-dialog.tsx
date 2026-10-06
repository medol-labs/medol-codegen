"use client";

import type { TableMeta } from "@tanstack/react-table";
import { useTranslate } from "@refinedev/core";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAsRef } from "@/hooks/use-as-ref";
import { cn } from "@/lib/utils";
import type { PasteDialogState } from "@/types/data-grid";

interface DataGridPasteDialogProps<TData> {
  tableMeta: TableMeta<TData>;
  pasteDialog: PasteDialogState;
}

export function DataGridPasteDialog<TData>({
  tableMeta,
  pasteDialog,
}: DataGridPasteDialogProps<TData>) {
  const onPasteDialogOpenChange = tableMeta?.onPasteDialogOpenChange;
  const onCellsPaste = tableMeta?.onCellsPaste;

  if (!pasteDialog.open) return null;

  return (
    <PasteDialog
      pasteDialog={pasteDialog}
      onPasteDialogOpenChange={onPasteDialogOpenChange}
      onCellsPaste={onCellsPaste}
    />
  );
}

interface PasteDialogProps
  extends Pick<TableMeta<unknown>, "onPasteDialogOpenChange" | "onCellsPaste">,
    Required<Pick<TableMeta<unknown>, "pasteDialog">> {}

const PasteDialog = React.memo(PasteDialogImpl, (prev, next) => {
  if (prev.pasteDialog.open !== next.pasteDialog.open) return false;
  if (!next.pasteDialog.open) return true;
  if (prev.pasteDialog.rowsNeeded !== next.pasteDialog.rowsNeeded) return false;

  return true;
});

function PasteDialogImpl({
  pasteDialog,
  onPasteDialogOpenChange,
  onCellsPaste,
}: PasteDialogProps) {
  const t = useTranslate();
  const propsRef = useAsRef({
    onPasteDialogOpenChange,
    onCellsPaste,
  });

  const expandRadioRef = React.useRef<HTMLInputElement | null>(null);

  const onOpenChange = React.useCallback(
    (open: boolean) => {
      propsRef.current.onPasteDialogOpenChange?.(open);
    },
    [propsRef],
  );

  const onCancel = React.useCallback(() => {
    propsRef.current.onPasteDialogOpenChange?.(false);
  }, [propsRef]);

  const onContinue = React.useCallback(() => {
    propsRef.current.onCellsPaste?.(expandRadioRef.current?.checked ?? false);
  }, [propsRef]);

  return (
    <Dialog open={pasteDialog.open} onOpenChange={onOpenChange}>
      <DialogContent data-grid-popover="">
        <DialogHeader>
          <DialogTitle>{t("dataGrid.pasteDialog.title", "Do you want to add more rows?")}</DialogTitle>
          <DialogDescription>
            {t(
              "dataGrid.pasteDialog.description",
              { count: pasteDialog.rowsNeeded },
              `We need ${pasteDialog.rowsNeeded} additional row(s) to paste everything from your clipboard.`,
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <label className="flex cursor-pointer items-start gap-3">
            <RadioItem
              ref={expandRadioRef}
              name="expand-option"
              value="expand"
              defaultChecked
            />
            <div className="flex flex-col gap-1">
              <span className="font-medium text-sm leading-none">
                {t("dataGrid.pasteDialog.createRows", "Create new rows")}
              </span>
              <span className="text-muted-foreground text-sm">
                {t(
                  "dataGrid.pasteDialog.createRowsDescription",
                  { count: pasteDialog.rowsNeeded },
                  `Add ${pasteDialog.rowsNeeded} new row(s) to the table and paste all data`,
                )}
              </span>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <RadioItem name="expand-option" value="no-expand" />
            <div className="flex flex-col gap-1">
              <span className="font-medium text-sm leading-none">
                {t("dataGrid.pasteDialog.keepRows", "Keep current rows")}
              </span>
              <span className="text-muted-foreground text-sm">
                {t("dataGrid.pasteDialog.keepRowsDescription", "Paste only what fits in the existing rows")}
              </span>
            </div>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("dataGrid.pasteDialog.cancel", "Cancel")}
          </Button>
          <Button onClick={onContinue}>{t("dataGrid.pasteDialog.continue", "Continue")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RadioItem({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="radio"
      className={cn(
        "relative size-4 shrink-0 appearance-none rounded-full border border-input bg-background shadow-xs outline-none transition-[color,box-shadow]",
        "text-primary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "checked:before:absolute checked:before:start-1/2 checked:before:top-1/2 checked:before:size-2 checked:before:-translate-x-1/2 checked:before:-translate-y-1/2 checked:before:rounded-full checked:before:bg-primary checked:before:content-['']",
        "dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}
