import type { PropsWithChildren } from "react";

import type {
  AdditionalAccessDecision,
  AdditionalAccessParams,
  AppExtensionState,
} from "@/providers/app-extension-contract";

export function AppExtensionProvider({ children }: PropsWithChildren) {
  return children;
}

export function useAppExtensions(): AppExtensionState {
  return {
    dataProviderKey: "default",
    filterBackendModules: (modules) => modules,
    filterResources: (resources) => resources,
    resolveBackendBaseUrl: (module) => module.apiUrl,
  };
}

export function HeaderExtensionActions(_props: { compact?: boolean }) {
  return null;
}

export function AuthenticatedRouteExtension({ children }: PropsWithChildren) {
  return children;
}

export async function evaluateAdditionalAccess(
  _params: AdditionalAccessParams,
): Promise<AdditionalAccessDecision | undefined> {
  return undefined;
}
