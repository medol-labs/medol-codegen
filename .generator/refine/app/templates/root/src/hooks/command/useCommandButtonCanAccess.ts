import {
  AccessControlContext,
  BaseKey,
  CanReturnType,
  IResourceItem,
  useTranslate,
} from "@refinedev/core";
import React from "react";
import { useCommandCan } from "./useCommandCan";

type CommandCanAccessProps = {
  resource?: IResourceItem;
  command: string;
  id?: BaseKey;
  accessControl?: {
    enabled?: boolean;
    hideIfUnauthorized?: boolean;
  };
  meta?: Record<string, unknown>;
};

type CommandCanAccessValues = {
  title: string;
  hidden: boolean;
  disabled: boolean;
  canAccess: CanReturnType | undefined;
};

export const useCommandButtonCanAccess = (
  props: CommandCanAccessProps,
): CommandCanAccessValues => {
  const translate = useTranslate();
  const accessControlContext = React.useContext(AccessControlContext);

  const accessControlEnabled =
    props.accessControl?.enabled ??
    accessControlContext.options.buttons.enableAccessControl;

  const hideIfUnauthorized =
    props.accessControl?.hideIfUnauthorized ??
    accessControlContext.options.buttons.hideIfUnauthorized;

  const { data: canAccess } = useCommandCan({
    resource: props.resource?.name,
    command: props.command,
    params: { meta: props.meta, id: props.id, resource: props.resource },
    enabled: accessControlEnabled,
  });

  const title = React.useMemo(() => {
    if (canAccess?.can) return "";
    if (canAccess?.reason) return canAccess.reason;

    return translate(
      "buttons.notAccessTitle",
      "You don't have permission to access",
    );
  }, [canAccess?.can, canAccess?.reason, translate]);

  const hidden = accessControlEnabled && hideIfUnauthorized && !canAccess?.can;

  const disabled = canAccess?.can === false;

  return {
    title,
    hidden,
    disabled,
    canAccess,
  };
};
