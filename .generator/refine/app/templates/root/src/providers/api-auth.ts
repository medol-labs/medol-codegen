import { getAppConfig } from "./app-config";
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

export const authProviderMode = (): string =>
  getAppConfig("VITE_AUTH_PROVIDER", "local");

export const accessControlMode = (): string =>
  getAppConfig("VITE_ACCESS_CONTROL_MODE", "permissive");

export const authBackendBaseUrl = (): string =>
  getAppConfig("VITE_AUTH_API_URL", getAppConfig("VITE_AXON_API_URL", "http://localhost:8080"));

export const storeLocalAuth = (token: string, user?: CurrentUser) => {
  localStorage.setItem(TOKEN_KEY, token);
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
};

export const clearLocalAuth = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
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
  if (authProviderMode() === "supabase") {
    const { data } = await supabaseClient.auth.getSession();
    return data.session?.access_token;
  }

  return localStorage.getItem(TOKEN_KEY) ?? undefined;
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
  const response = await authFetch(`${authBackendBaseUrl()}/api/me`);
  if (!response.ok) {
    throw new Error("Current user could not be loaded.");
  }

  const user = (await response.json()) as CurrentUser;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
};
