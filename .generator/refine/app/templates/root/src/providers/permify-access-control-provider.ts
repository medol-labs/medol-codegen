import type {
  AccessControlProvider,
  CanParams,
} from "@refinedev/core";
import { accessControlMode, cachedCurrentUser, fetchCurrentUser } from "./api-auth";
import { evaluateAdditionalAccess } from "@/domain/app-extensions";

const actionPermissions = (
  resource: string,
  action?: string,
  command?: string,
): string[] => {
  const normalizedResource = resource
    .replace(/-(catalog|directory|dashboard|overview|view|latest|readiness)$/u, "")
    .replace(/-/gu, "_");
  const normalizedCommand = command
    ?.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  if (normalizedCommand) {
    return [
      `${resource}:${command}`,
      `${resource}:${normalizedCommand}`,
      `${normalizedResource}:${command}`,
      `${normalizedResource}:${normalizedCommand}`,
      `${normalizedCommand}:execute`,
    ];
  }

  switch (action) {
    case "list":
    case "show":
      return [
        `${resource}:read`,
        `${resource}:list`,
        `${normalizedResource}:read`,
        `${normalizedResource}:list`,
      ];
    case "create":
    case "edit":
    case "delete":
      return [
        `${resource}:manage`,
        `${resource}:${action}`,
        `${normalizedResource}:manage`,
        `${normalizedResource}:${action}`,
      ];
    default:
      return action
        ? [
            `${resource}:${action}`,
            `${normalizedResource}:${action}`,
          ]
        : [];
  }
};

export const accessControlProvider: AccessControlProvider = {
  can: async ({ action, params, resource }: CanParams) => {
    if (!resource) {
      return { can: true };
    }

    const user = cachedCurrentUser() ?? (await fetchCurrentUser().catch(() => null));
    if (!user) {
      return { can: accessControlMode() !== "strict" };
    }

    const additionalDecision = await evaluateAdditionalAccess({
      user,
      resource,
      action,
      params: params as Record<string, unknown> | undefined,
    });
    if (additionalDecision) {
      return additionalDecision;
    }

    if (user.permissions.length === 0) {
      return { can: accessControlMode() !== "strict" };
    }

    if (user.permissions.includes("*:*")) {
      return { can: true };
    }

    const command = typeof params?.command === "string" ? params.command : undefined;
    const required = actionPermissions(resource, action, command);
    if (required.length === 0) {
      return { can: true };
    }

    return {
      can: required.some((permission) => user.permissions.includes(permission)),
    };
  },
  options: {
    buttons: {
      enableAccessControl: true,
      hideIfUnauthorized: true,
    },
  },
};
