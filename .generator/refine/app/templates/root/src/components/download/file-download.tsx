import { useCallback, useMemo, useState } from "react";
import type React from "react";
import { useNotification } from "@refinedev/core";
import { Download, Loader2 } from "lucide-react";

import { useAppExtensions } from "@/domain/app-extensions";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { backendModules } from "@/contexts/resources";
import type { BackendModule } from "@/providers/app-extension-contract";
import { authFetch } from "@/providers/api-auth";

export type DownloadFileOptions = {
  uri?: string | null;
  filename?: string | null;
  backendModuleName?: string;
  fallbackBaseUrl?: string;
};

type ResolvedDownloadTarget = {
  url: string;
  filename?: string | null;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/u, "");

const browserOrigin = () =>
  typeof window === "undefined" ? "http://localhost" : window.location.origin;

const toAbsoluteBaseUrl = (baseUrl: string) => {
  const trimmedBaseUrl = trimTrailingSlash(baseUrl.trim());
  if (!trimmedBaseUrl) return browserOrigin();
  return new URL(trimmedBaseUrl, `${browserOrigin()}/`)
    .toString()
    .replace(/\/+$/u, "");
};

const isDownloadableUri = (uri?: string | null) => {
  const value = uri?.trim();
  return Boolean(value && !value.startsWith("builtin://"));
};

const defaultDownloadBackendModule = (): BackendModule | undefined =>
  backendModules.find((item) => item.name.toLowerCase().includes("support")) ??
  backendModules[0];

const contentDispositionFilename = (header: string | null) => {
  if (!header) return undefined;

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/iu);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/gu, ""));
  }

  const asciiMatch = header.match(/filename="?([^";]+)"?/iu);
  return asciiMatch?.[1]?.trim();
};

const pathFilename = (url: string) => {
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split("/").filter(Boolean).at(-1);
    return lastSegment && lastSegment !== "content" ? lastSegment : undefined;
  } catch {
    return undefined;
  }
};

const resolveDownloadTarget = (
  options: DownloadFileOptions,
  baseUrl: string,
): ResolvedDownloadTarget => {
  const rawUri = options.uri?.trim();
  if (!rawUri) {
    throw new Error("Download URI is empty.");
  }

  const normalizedBaseUrl = toAbsoluteBaseUrl(baseUrl);
  let url: string;

  if (rawUri.startsWith("/")) {
    url = `${normalizedBaseUrl}${rawUri}`;
  } else {
    const parsedUri = new URL(rawUri, `${normalizedBaseUrl}/`);
    if (
      parsedUri.hostname === "localhost" ||
      parsedUri.hostname === "127.0.0.1"
    ) {
      const parsedBaseUrl = new URL(normalizedBaseUrl);
      parsedUri.protocol = parsedBaseUrl.protocol;
      parsedUri.host = parsedBaseUrl.host;
    }
    url = parsedUri.toString();
  }

  return {
    url,
    filename: options.filename,
  };
};

export async function downloadFile(
  options: DownloadFileOptions,
  baseUrl: string,
) {
  const target = resolveDownloadTarget(options, baseUrl);
  const response = await authFetch(target.url);
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}.`);
  }

  const blob = await response.blob();
  const filename =
    target.filename ||
    contentDispositionFilename(response.headers.get("content-disposition")) ||
    pathFilename(target.url) ||
    "download";

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);

  return filename;
}

export function useFileDownload(options: DownloadFileOptions = {}) {
  const { open } = useNotification();
  const appExtensions = useAppExtensions();
  const [downloading, setDownloading] = useState(false);

  const baseUrl = useMemo(() => {
    const backendModule = options.backendModuleName
      ? backendModules.find((item) => item.name === options.backendModuleName)
      : defaultDownloadBackendModule();
    if (!backendModule) return options.fallbackBaseUrl ?? "";
    return appExtensions.resolveBackendBaseUrl(backendModule);
  }, [appExtensions, options.backendModuleName, options.fallbackBaseUrl]);

  const download = useCallback(
    async (overrides: DownloadFileOptions = {}) => {
      const nextOptions = {
        ...options,
        ...overrides,
      };
      if (!isDownloadableUri(nextOptions.uri)) {
        throw new Error("Download URI is not available.");
      }

      setDownloading(true);
      try {
        const filename = await downloadFile(nextOptions, baseUrl);
        open?.({
          type: "success",
          message: "Download started",
          description: filename,
        });
        return filename;
      } catch (error) {
        open?.({
          type: "error",
          message: "Download failed",
          description: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        setDownloading(false);
      }
    },
    [baseUrl, open, options],
  );

  return {
    baseUrl,
    canDownload: isDownloadableUri(options.uri),
    downloading,
    download,
  };
}

export type DownloadFileButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "onClick"
> &
  DownloadFileOptions & {
    label?: string;
    tooltip?: string;
    onDownloaded?: (filename: string) => void;
  };

export function DownloadFileButton({
  uri,
  filename,
  backendModuleName,
  fallbackBaseUrl,
  label,
  tooltip = "Download",
  disabled,
  onDownloaded,
  children,
  variant = "outline",
  size = "icon-sm",
  ...buttonProps
}: DownloadFileButtonProps) {
  const { canDownload, downloading, download } = useFileDownload({
    uri,
    filename,
    backendModuleName,
    fallbackBaseUrl,
  });

  const button = (
    <Button
      {...buttonProps}
      type={buttonProps.type ?? "button"}
      variant={variant}
      size={size}
      disabled={disabled || !canDownload || downloading}
      aria-label={buttonProps["aria-label"] ?? label ?? tooltip}
      onClick={async () => {
        const downloadedFilename = await download();
        onDownloaded?.(downloadedFilename);
      }}
    >
      {children ?? (
        <>
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {label ? <span>{label}</span> : null}
        </>
      )}
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
