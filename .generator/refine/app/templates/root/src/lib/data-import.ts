import { backendModules } from "@/providers/resources";
import { authFetch } from "@/providers/api-auth";

export type DataImportResult = {
  jobId: string;
  status: string;
  originalFileName?: string;
};

const backendApiUrl = (dataProviderName?: string): string => {
  const module = dataProviderName
    ? backendModules.find((item) => item.dataProviderName === dataProviderName)
    : backendModules[0];
  if (!module) {
    throw new Error("No backend module is configured for data import.");
  }
  return module.apiUrl.replace(/\/$/, "");
};

const currentLocale = (): string | undefined => {
  if (typeof document !== "undefined") {
    const htmlLang = document.documentElement.lang;
    if (htmlLang) return htmlLang;
  }
  if (typeof navigator !== "undefined") {
    return navigator.language || navigator.languages?.[0];
  }
  return undefined;
};

export async function requestDataImport(params: {
  aggregateRoute: string;
  commandRoute: string;
  dataProviderName?: string;
  file: File;
  requestedLocale?: string;
}): Promise<DataImportResult> {
  const body = new FormData();
  body.append("file", params.file);
  const locale = params.requestedLocale ?? currentLocale();
  if (locale) {
    body.append("requestedLocale", locale);
  }

  const path = `/${params.aggregateRoute}/${params.commandRoute}/import`;
  const response = await authFetch(`${backendApiUrl(params.dataProviderName)}${path}`, {
    method: "POST",
    body,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `Data import failed with HTTP ${response.status}.`);
  }

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  return {
    jobId: String(payload.jobId ?? ""),
    status: String(payload.status ?? "REQUESTED"),
    originalFileName: payload.originalFileName ? String(payload.originalFileName) : undefined,
  };
}
