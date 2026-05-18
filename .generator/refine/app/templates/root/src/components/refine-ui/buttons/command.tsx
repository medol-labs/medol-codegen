import { Button } from "@/components/ui/button";
import { useCommandButton } from "@/hooks/command/useCommandButton";
import { BaseKey, Link } from "@refinedev/core";
import { Check } from "lucide-react";
import React from "react";

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
    { resource, command, recordItemId, accessControl, meta, children, onClick, ...rest },
    ref
  ) => {
    const { to, label, hidden, disabled } = useCommandButton({
      resource,
      command,
      id: recordItemId,
    });

    const isDisabled = disabled || rest.disabled;
    const isHidden = hidden || rest.hidden;

    if (isHidden) return null;

    return (
      <Button {...rest} ref={ref} disabled={isDisabled} asChild>
        <Link
          to={to}
          replace={false}
          onClick={(e: React.PointerEvent<HTMLButtonElement>) => {
            if (isDisabled) {
              e.preventDefault();
              return;
            }
            if (onClick) {
              e.preventDefault();
              onClick(e);
            }
          }}
        >
          {children ?? (
            <div className="flex items-center gap-2 font-semibold">
              <Check className="h-4 w-4" />
              <span>{label}</span>
            </div>
          )}
        </Link>
      </Button>
    );
  }
);
