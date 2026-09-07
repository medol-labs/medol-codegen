import type { ReactElement } from "react";

export type PageOverrideKey = `${string}:${string}`;

export const pageOverrides: Partial<Record<PageOverrideKey, ReactElement>> = {};

export function resolvePageOverride(
  resourceRoute: string,
  view: string,
  fallback: ReactElement,
) {
  return pageOverrides[`${resourceRoute}:${view}`] ?? fallback;
}
