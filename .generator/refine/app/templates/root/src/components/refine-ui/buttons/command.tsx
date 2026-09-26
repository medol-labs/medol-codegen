import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCommandButton } from "@/hooks/command/useCommandButton";
import { BaseKey } from "@refinedev/core";
import { Check, Loader2 } from "lucide-react";
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
    { resource, command, recordItemId, query, accessControl, meta, children, onClick, variant = "secondary", size = "sm", ...rest },
    ref
  ) => {
    const navigate = useNavigate();
    const [open, setOpen] = React.useState(false);
    const {
      to,
      label,
      hidden,
      disabled,
      loading,
      interactionMode,
      confirmTitle,
      confirmDescription,
      confirmVariant,
      submit,
    } = useCommandButton({
      resource,
      command,
      id: recordItemId,
      query,
      accessControl,
      meta,
    });

    const isDisabled = disabled || rest.disabled || loading;
    const isHidden = hidden || rest.hidden;

    if (isHidden) return null;

    const buttonContent = children ?? (
      <>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        <span>{label}</span>
      </>
    );

    const runAction = async (e: React.MouseEvent<HTMLButtonElement>) => {
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
      if (interactionMode === "direct") {
        await submit();
        return;
      }
      navigate(to);
    };

    if (interactionMode === "confirm") {
      const actionVariant = confirmVariant === "destructive" ? "destructive" : variant;

      return (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <span>
              <Button
                {...rest}
                ref={ref}
                disabled={isDisabled}
                variant={actionVariant}
                size={size}
                onClick={(e) => {
                  if (isDisabled) {
                    e.preventDefault();
                    return;
                  }
                  if (onClick) {
                    onClick(e);
                  }
                }}
              >
                {buttonContent}
              </Button>
            </span>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <div className="flex flex-col gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">{confirmTitle}</p>
                <p className="text-xs text-muted-foreground">{confirmDescription}</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant={confirmVariant === "destructive" ? "destructive" : "default"}
                  size="sm"
                  disabled={loading}
                  onClick={async () => {
                    await submit();
                    setOpen(false);
                  }}
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      );
    }

    return (
      <Button
        {...rest}
        ref={ref}
        disabled={isDisabled}
        variant={variant}
        size={size}
        onClick={runAction}
      >
        {buttonContent}
      </Button>
    );
  }
);
