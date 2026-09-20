import type { ReactNode } from "react";

type MenuIconType = "dashboard" | "chapter" | "resource";

type MenuIconRequest = {
  type: MenuIconType;
  name: string;
  label?: string;
  parent?: string;
  fallback: ReactNode;
};

export function resolveMenuIcon({ fallback }: MenuIconRequest): ReactNode {
  return fallback;
}
