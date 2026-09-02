import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { MoreHorizontal } from "lucide-react";
import * as React from "react";

type RowActionMenuProps = {
  children: React.ReactNode;
  align?: "start" | "center" | "end";
};

function normalizeAction(
  element: React.ReactElement<any>
) {
  return React.cloneElement(element, {
    variant: "ghost",
    size: "sm",
    className: cn(
      "h-auto min-h-8 w-full justify-start gap-2 rounded-sm px-2 py-1.5 text-left font-normal",
      element.props.className
    ),
  });
}

export function RowActionMenu({
  children,
  align = "end",
}: RowActionMenuProps) {

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={align}
        sideOffset={6}
        className="min-w-48"
      >
        {React.Children.map(children, (child) => {
          if (!React.isValidElement(child)) return null;

          return (
            <DropdownMenuItem asChild>
              {normalizeAction(child)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
