import { Button } from "@/components/ui/button";
import { useCommandButton } from "@/hooks/command/useCommandButton";
import { cn } from "@/lib/utils";
import { BaseKey } from "@refinedev/core";
import { Check } from "lucide-react";
import React from "react";
import { useNavigate } from "react-router";

type CommandButtonProps = {
  /**
   * Resource name for API data interactions. `identifier` of the resource can be used instead of the `name` of the resource.
   * @default Inferred resource name from the route
   */
  command: string;
  /**
   * Data item identifier for the actions with the API
   * @default Reads `:id` from the URL
   */
  recordItemId?: BaseKey;
  query?: Record<string, any>;
  /**
   * Access Control configuration for the button
   * @default `{ enabled: true, hideIfUnauthorized: false }`
   */
  accessControl?: {
    enabled?: boolean;
    hideIfUnauthorized?: boolean;
  };
  /**
   * `meta` property is used when creating the URL for the related action and path.
   */
  meta?: Record<string, unknown>;
} & React.ComponentProps<typeof Button>;

export const CommandButton = React.forwardRef<
  React.ComponentRef<typeof Button>,
  CommandButtonProps
>(
  (
    { resource, command, recordItemId, query, accessControl, meta, children, onClick, variant = "secondary", size = "sm", className, ...rest },
    ref
  ) => {
    const navigate = useNavigate();
    const { to, label, hidden, disabled } = useCommandButton({
      resource,
      command,
      id: recordItemId,
      query,
    });

    const isDisabled = disabled || rest.disabled;
    const isHidden = hidden || rest.hidden;

    if (isHidden) return null;

    return (
      <Button
        {...rest}
        ref={ref}
        disabled={isDisabled}
        variant={variant}
        size={size}
        className={cn(
          "border border-border bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80 hover:text-secondary-foreground",
          "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          className,
        )}
        onClick={(e) => {
          if (isDisabled) {
            e.preventDefault();
            return;
          }
          if (onClick) {
            onClick(e);
            if (e.defaultPrevented) {
              return;
            }
          }
          navigate(to);
        }}
      >
        {children ?? (
          <>
            <Check className="h-4 w-4" />
            <span>{label}</span>
          </>
        )}
      </Button>
    );
  }
);
