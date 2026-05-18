import {
  CanReturnType,
  useGo,
  useParsed,
  useResourceParams,
  type IResourceItem,
} from "@refinedev/core";
import { useCommandButtonCanAccess } from "./useCommandButtonCanAccess";

type CommandNavOpts = {
  resource?: string;
  command: string;
  id?: string | number;
  query?: Record<string, any>;
};

export const useCommandNavigation = () => {
  const { resources } = useResourceParams();
  const parsed = useParsed();
  const go = useGo();
  const resolveResource = (name?: string): IResourceItem | undefined => {
    return resources.find((r) => r.name === (name ?? parsed.resource));
  };

  const buildPath = (
    resource: IResourceItem,
    command: string,
    id?: string | number,
  ) => {
    const template =
      resource.meta?.commands?.[command]?.route ??
      resource.meta?.commandRoute ??
      "/:resource/:id/command/:command";

    return template
      .replace(":resource", resource.name)
      .replace(":id", id?.toString() ?? "")
      .replace(":command", command);
  };

  const commandUrl = ({
    resource,
    command,
    id,
    query,
  }: CommandNavOpts): string => {
    const resourceItem = resolveResource(resource);
    if (!resourceItem) return "";

    return go({
      to: buildPath(resourceItem, command, id ?? parsed.id),
      type: "path",
      query,
    }) as string;
  };

  const goCommand = (
    opts: CommandNavOpts,
    type: "push" | "replace" = "push",
  ) => {
    go({
      to: commandUrl(opts),
      type,
    });
  };

  return { commandUrl, goCommand };
};

export type UseCommandButtonProps = {
  command: string;
  id?: string | number;
  query?: Record<string, any>;
  resource?: string;
  meta?: Record<string, unknown>;
  accessControl?: {
    enabled?: boolean;
    hideIfUnauthorized?: boolean;
  };
};

export type CommandButtonResult = {
  to: string;
  label: string;
  hidden: boolean;
  disabled: boolean;
  canAccess: CanReturnType | undefined;
  title: string;
};

export const useCommandButton = ({
  command,
  resource,
  id,
  query,
  accessControl,
  meta,
}: UseCommandButtonProps): CommandButtonResult => {
  const { id: paramId, resource: resourceItem } = useResourceParams({
    resource,
    id,
  });
  const { commandUrl } = useCommandNavigation();

  const commandMeta = resourceItem?.meta?.commands?.[command];

  const { canAccess, title, hidden, disabled } = useCommandButtonCanAccess({
    resource: resourceItem,
    command,
    accessControl: accessControl,
    meta: meta,
    id,
  });

  return {
    to: commandUrl({
      resource: resourceItem?.name,
      id: id ?? paramId,
      command,
      query,
    }),
    label: commandMeta?.label ?? command,
    hidden: hidden,
    disabled: disabled,
    canAccess,
    title,
  };
};
