import {
  CanReturnType,
  useCreate,
  useGo,
  useInvalidate,
  useNotification,
  useParsed,
  useResourceParams,
  useTranslate,
  type IResourceItem,
} from "@refinedev/core";
import React from "react";
import { useFileDownload } from "@/components/download/file-download";
import { useCommandButtonCanAccess } from "./useCommandButtonCanAccess";

type CommandNavOpts = {
  resource?: string;
  command: string;
  id?: string | number;
  query?: Record<string, any>;
};

export type CommandInteractionMode = "form" | "confirm" | "direct" | "custom";

export type CommandButtonMeta = {
  label?: string;
  i18nKey?: string;
  route?: string;
  dataProviderName?: string;
  uiPattern?: string;
  interactionMode?: CommandInteractionMode;
  requiresPage?: boolean;
  clientEffect?: {
    type?: string;
    options?: Record<string, string>;
  };
  downloadCommand?: boolean;
  confirmTitle?: string;
  confirmDescription?: string;
  confirmVariant?: "default" | "destructive";
};

const readPath = (value: unknown, path?: string): unknown => {
  if (!path || !value || typeof value !== "object") return undefined;
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
};

const dataPath = (path?: string): string | undefined => path ? `data.${path}` : undefined;

const findDownloadUri = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    const normalized = key.toLowerCase();
    if (
      typeof item === "string" &&
      item.trim().length > 0 &&
      (normalized.endsWith("uri") ||
        normalized.endsWith("url") ||
        normalized.endsWith("location") ||
        normalized.endsWith("path"))
    ) {
      return item;
    }
  }
  return findDownloadUri(record.data);
};

const resolveDownloadUri = (
  result: unknown,
  query?: Record<string, any>,
  options?: Record<string, string>,
): string | undefined => {
  const configured =
    readPath(result, options?.uriField) ??
    readPath(result, dataPath(options?.uriField)) ??
    readPath(query, options?.uriField);
  if (typeof configured === "string" && configured.trim()) return configured;
  return findDownloadUri(result) ?? findDownloadUri(query);
};

const extensionByFormat = (format?: unknown): string => {
  const normalized = String(format ?? "").toUpperCase();
  if (normalized === "JSON") return ".json";
  if (normalized === "PYTORCH_STATE_DICT") return ".pt";
  if (normalized === "ONNX") return ".onnx";
  if (normalized === "CSV") return ".csv";
  return "";
};

const safeFilenamePart = (value: unknown): string =>
  String(value ?? "").replace(/[^A-Za-z0-9._-]+/gu, "-");

const downloadFilename = (
  query?: Record<string, any>,
  result?: unknown,
  options?: Record<string, string>,
): string | undefined => {
  const configured = readPath(result, options?.filenameField)
    ?? readPath(result, dataPath(options?.filenameField))
    ?? readPath(query, options?.filenameField);
  if (configured) {
    const extension = extensionByFormat(
      readPath(result, options?.extensionFrom)
        ?? readPath(result, dataPath(options?.extensionFrom))
        ?? readPath(query, options?.extensionFrom),
    );
    const filename = safeFilenamePart(configured);
    return extension && !filename.endsWith(extension) ? `${filename}${extension}` : filename;
  }

  const explicit =
    query?.filename ??
    query?.fileName ??
    query?.originalFileName ??
    query?.name;
  if (explicit) {
    return safeFilenamePart(explicit);
  }

  const modelName = query?.modelName;
  if (modelName) {
    const parts = [
      safeFilenamePart(modelName),
      safeFilenamePart(query?.modelVersion ?? query?.version),
    ].filter(Boolean);
    return `${parts.join("-")}${extensionByFormat(query?.modelFormat ?? query?.format)}`;
  }

  return undefined;
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
  loading: boolean;
  canAccess: CanReturnType | undefined;
  title: string;
  interactionMode: CommandInteractionMode;
  confirmTitle: string;
  confirmDescription: string;
  confirmVariant: "default" | "destructive";
  submit: () => Promise<unknown>;
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
  const translate = useTranslate();
  const { commandUrl } = useCommandNavigation();
  const invalidate = useInvalidate();
  const { open } = useNotification();
  const { mutateAsync } = useCreate();
  const { download } = useFileDownload();
  const [submitting, setSubmitting] = React.useState(false);

  const commandMeta = resourceItem?.meta?.commands?.[command] as CommandButtonMeta | undefined;
  const label = commandMeta?.i18nKey
    ? translate(commandMeta.i18nKey, commandMeta.label ?? command)
    : commandMeta?.label ?? command;
  const interactionMode = commandMeta?.interactionMode ?? "form";
  const confirmTitle = commandMeta?.confirmTitle ?? `${label}?`;
  const confirmDescription =
    commandMeta?.confirmDescription ?? translate("commands.confirm.description", "This action will be submitted immediately.");
  const confirmVariant = commandMeta?.confirmVariant ?? "default";

  const { canAccess, title, hidden, disabled } = useCommandButtonCanAccess({
    resource: resourceItem,
    command,
    accessControl: accessControl,
    meta: meta,
    id,
  });
  const submit = React.useCallback(async () => {
    if (!resourceItem?.name) {
      return undefined;
    }

    const aggregateId = id ?? paramId;
    const idField = typeof resourceItem.meta?.idField === "string"
      ? resourceItem.meta.idField
      : "id";
    const variables = {
      ...(aggregateId && idField && !(idField in (query ?? {})) ? { [idField]: aggregateId } : {}),
      ...(query ?? {}),
    };

    setSubmitting(true);
    try {
      const result = await mutateAsync({
        resource: resourceItem.name,
        values: variables,
        dataProviderName: commandMeta?.dataProviderName ?? "command",
        meta: {
          ...resourceItem.meta,
          ...meta,
          command,
          aggregateId,
          dataProviderName: commandMeta?.dataProviderName ?? "command",
        },
      });
      await invalidate({
        resource: resourceItem.name,
        id: aggregateId,
        dataProviderName: resourceItem.meta?.dataProviderName as string | undefined,
        invalidates: ["list", "many", "detail"],
      });
      if (commandMeta?.downloadCommand) {
        const clientEffectOptions = commandMeta.clientEffect?.type === "download"
          ? commandMeta.clientEffect.options
          : undefined;
        await download({
          uri: resolveDownloadUri(result, query, clientEffectOptions),
          filename: downloadFilename(query, result, clientEffectOptions),
        });
        return result;
      }
      open?.({
        type: "success",
        message: translate("notifications.success", "Success"),
        description: label,
      });
      return result;
    } catch (error) {
      open?.({
        type: "error",
        message: translate("notifications.error", "Error"),
        description: error instanceof Error ? error.message : label,
      });
      throw error;
    } finally {
      setSubmitting(false);
    }
  }, [
    command,
    commandMeta?.dataProviderName,
    commandMeta?.downloadCommand,
    commandMeta?.clientEffect,
    download,
    id,
    invalidate,
    label,
    meta,
    mutateAsync,
    open,
    paramId,
    query,
    resourceItem?.meta,
    resourceItem?.name,
    translate,
  ]);

  return {
    to: commandUrl({
      resource: resourceItem?.name,
      id: id ?? paramId,
      command,
      query,
    }),
    label,
    hidden: hidden,
    disabled: disabled,
    loading: submitting,
    canAccess,
    title,
    interactionMode,
    confirmTitle,
    confirmDescription,
    confirmVariant,
    submit,
  };
};
