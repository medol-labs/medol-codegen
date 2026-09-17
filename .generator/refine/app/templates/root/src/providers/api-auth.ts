import { getAppConfig } from "./app-config";
import { authBackendModule } from "./resources";
import { supabaseClient } from "./supabase-client";

export type CurrentUser = {
  id: string;
  username: string;
  organizationId?: string | null;
  roles: string[];
  permissions: string[];
};

const TOKEN_KEY = "medol-auth-token";
const USER_KEY = "medol-current-user";
export const AUTH_STATE_CHANGE_EVENT = "medol-auth-state-change";
let currentUserRequest: Promise<CurrentUser> | null = null;
let validatedAccessToken: string | null = null;

export const authProviderMode = (): string =>
  getAppConfig("VITE_AUTH_PROVIDER", "local");

export const accessControlMode = (): string =>
  getAppConfig("VITE_ACCESS_CONTROL_MODE", "permissive");

export const authBackendBaseUrl = (): string =>
  getAppConfig(
    "VITE_AUTH_API_URL",
    authBackendModule?.apiUrl ?? getAppConfig("VITE_AXON_API_URL", "http://localhost:8080"),
  );

export const storeLocalAuth = (token: string, user?: CurrentUser) => {
  validatedAccessToken = null;
  localStorage.setItem(TOKEN_KEY, token);
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
};

export type PortalSsoExchangeResponse = {
  accessToken: string;
  tokenType: string;
  expiresAt: number;
  user: CurrentUser;
  redirectPath: string;
  registrationRequired: boolean;
  permissionAssignmentRequired: boolean;
  notice?: string | null;
};

export const exchangePortalJwtForSystemSession = async (params: {
  portalJwt: string;
  requestedPath?: string | null;
  systemSource?: string | null;
}): Promise<PortalSsoExchangeResponse> => {
  const response = await fetch(`${authBackendBaseUrl()}/api/auth/exchange-portal-jwt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const text = await response.text();
    try {
      const payload = JSON.parse(text);
      throw new Error(payload.detail || payload.title || "Portal sign-in failed");
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(text || "Portal sign-in failed");
      }
      throw error;
    }
  }

  return response.json();
};

export const clearLocalAuth = () => {
  validatedAccessToken = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
};

export const cachedCurrentUser = (): CurrentUser | null => {
  const value = localStorage.getItem(USER_KEY);
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as CurrentUser;
  } catch {
    return null;
  }
};

export const getAccessToken = async (): Promise<string | undefined> => {
  const localToken = localStorage.getItem(TOKEN_KEY) ?? undefined;
  if (localToken) {
    return localToken;
  }

  if (authProviderMode() === "supabase") {
    const { data } = await supabaseClient.auth.getSession();
    return data.session?.access_token;
  }

  return undefined;
};

export const authHeaders = async (): Promise<Record<string, string>> => {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const authFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> => {
  const headers = new Headers(init.headers);
  const authorization = await authHeaders();
  Object.entries(authorization).forEach(([key, value]) => headers.set(key, value));

  return fetch(input, {
    ...init,
    headers,
  });
};

export const fetchCurrentUser = async (): Promise<CurrentUser> => {
  if (currentUserRequest) {
    return currentUserRequest;
  }

  currentUserRequest = getAccessToken()
    .then(async (accessToken) => {
      const response = await authFetch(`${authBackendBaseUrl()}/api/me`);
      if (!response.ok) {
        throw new Error("Current user could not be loaded.");
      }

      const user = (await response.json()) as CurrentUser;
      validatedAccessToken = accessToken ?? null;
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
      return user;
    })
    .finally(() => {
      currentUserRequest = null;
    });

  return currentUserRequest;
};

export const validateCurrentSession = async (): Promise<CurrentUser> => {
  const accessToken = await getAccessToken();
  const cachedUser = cachedCurrentUser();

  if (accessToken && accessToken === validatedAccessToken && cachedUser) {
    return cachedUser;
  }

  return fetchCurrentUser();
};
