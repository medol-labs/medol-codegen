import type { useTranslate } from "@refinedev/core";

type Translate = ReturnType<typeof useTranslate>;

export type ProblemDetailError = Error & {
  statusCode?: number;
  code?: string;
  i18nKey?: string;
  args?: Record<string, unknown>;
  detail?: string;
  title?: string;
  problem?: Record<string, unknown>;
};

export const problemDetailDescription = (
  error: unknown,
  translate: Translate,
  fallback: string,
): string => {
  if (!error || typeof error !== "object") {
    return error instanceof Error ? error.message : fallback;
  }

  const record = error as ProblemDetailError;
  const problem = record.problem ?? record;
  const i18nKey = typeof problem.i18nKey === "string" ? problem.i18nKey : record.i18nKey;
  const detail = typeof problem.detail === "string" ? problem.detail : record.message;
  return i18nKey
    ? translate(i18nKey, detail || fallback)
    : detail || fallback;
};
