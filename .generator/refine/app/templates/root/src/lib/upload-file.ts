import { backendModules, fileUploadCapability } from "@/providers/resources";
import { authFetch } from "@/providers/api-auth";

type FileUploadCapability = {
  dataProviderName: string;
  path: string;
  fileField: string;
  idField: string;
  additionalFields?: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
  }>;
};

export type PendingFileUpload = {
  file: File;
  uploadId: string;
};

const fileUploadApiUrl = (): string => {
  const capability = fileUploadCapability as unknown as FileUploadCapability | null;
  const uploadModule = capability
    ? backendModules.find((module) => module.dataProviderName === capability.dataProviderName)
    : undefined;

  if (!uploadModule) {
    throw new Error("A file upload capability must be modeled before generated file fields can upload files.");
  }

  return uploadModule.apiUrl.replace(/\/$/, "");
};

export async function uploadFile(params: {
  file: File;
  uploadId: string;
  source: string;
  values: Record<string, unknown>;
}): Promise<string> {
  const capability = fileUploadCapability as unknown as FileUploadCapability | null;
  if (!capability) {
    throw new Error("A file upload capability must be modeled before generated file fields can upload files.");
  }

  const formData = new FormData();
  formData.append(capability.fileField, params.file);
  formData.append(capability.idField, params.uploadId);

  for (const [name, value] of Object.entries(params.values)) {
    if (name === capability.fileField || name === capability.idField) {
      continue;
    }
    if (value === undefined || value === null || typeof value === "object") {
      continue;
    }
    formData.append(name, String(value));
  }

  for (const field of capability.additionalFields ?? []) {
    if (!formData.has(field.name)) {
      formData.append(field.name, `${params.source}.${field.name}`);
    }
  }

  const response = await authFetch(`${fileUploadApiUrl()}${capability.path}`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `Failed to upload file: ${response.status}`);
  }

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const uploadedId = payload[capability.idField];
  return typeof uploadedId === "string" && uploadedId.trim() ? uploadedId : params.uploadId;
}
