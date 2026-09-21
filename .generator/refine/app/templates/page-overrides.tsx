import type { ReactElement } from "react";

import { frontendComposition } from "@/app/composition/composition.resolved";

export type PageOverrideKey = `${string}:${string}`;
export type PageOverrideTarget = `page:${string}:${string}`;

export const pageOverrides: Partial<Record<PageOverrideKey, ReactElement>> = {};

export function resolvePageOverride(
  resourceRoute: string,
  view: string,
  fallback: ReactElement,
) {
  const target: PageOverrideTarget = `page:${resourceRoute}:${view}`;
  const typedOverride = frontendComposition.overrides.find(
    (override) => override.type === "page" && override.target === target,
  );

  return (
    (typedOverride?.implementation as ReactElement | undefined) ??
    pageOverrides[`${resourceRoute}:${view}`] ??
    fallback
  );
}
