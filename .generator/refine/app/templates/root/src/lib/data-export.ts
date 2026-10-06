import type { CrudFilter, CrudSorting } from "@refinedev/core";

import { backendModules } from "@/providers/resources";
import { authFetch } from "@/providers/api-auth";
import { appendSpringCriteriaFilters } from "@/lib/query-filters";

export type DataExportColumn = {
  field: string;
  label: string;
};

export type DataExportResult =
  | { kind: "download"; filename: string }
  | { kind: "job"; jobId: string; status: string };

const appendSorters = (
  params: URLSearchParams,
  sorters?: CrudSorting,
): URLSearchParams => {
  for (const sorter of sorters ?? []) {
    if (!sorter.field || !sorter.order) continue;
    params.append("sort", `${sorter.field},${sorter.order}`);
  }
  return params;
};

const backendApiUrl = (dataProviderName?: string): string => {
  const module = dataProviderName
    ? backendModules.find((item) => item.dataProviderName === dataProviderName)
    : backendModules[0];
  if (!module) {
    throw new Error("No backend module is configured for data export.");
  }
  return module.apiUrl.replace(/\/$/, "");
};

const filenameFromDisposition = (value: string | null): string | undefined => {
  if (!value) return undefined;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (utf8) return decodeURIComponent(utf8);
  const plain = /filename="?([^";]+)"?/i.exec(value)?.[1];
  return plain ? decodeURIComponent(plain) : undefined;
};

export async function requestDataExport(params: {
  aggregateRoute: string;
  queryRoute: string;
  dataProviderName?: string;
  filters?: CrudFilter[];
  sorters?: CrudSorting;
  columns: DataExportColumn[];
}): Promise<DataExportResult> {
  const query = appendSorters(new URLSearchParams(), params.sorters);
  appendSpringCriteriaFilters(query, params.filters);
  const path = `/${params.aggregateRoute}/${params.queryRoute}/export`;
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await authFetch(`${backendApiUrl(params.dataProviderName)}${path}${suffix}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ columns: params.columns }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `Data export failed with HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    return {
      kind: "job",
      jobId: String(payload.jobId ?? ""),
      status: String(payload.status ?? "REQUESTED"),
    };
  }

  const blob = await response.blob();
  const filename = filenameFromDisposition(response.headers.get("content-disposition")) ?? "export.csv";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return { kind: "download", filename };
}
