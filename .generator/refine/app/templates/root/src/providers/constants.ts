import { getAppConfig } from "./app-config";

export const SUPABASE_URL = getAppConfig("VITE_API_URL");
export const SUPABASE_KEY = getAppConfig("VITE_SUPABASE_API_KEY");
export const isSupabaseConfigured = (): boolean =>
  SUPABASE_URL.length > 0 && SUPABASE_KEY.length > 0;

export const QUERY_DATA_PROVIDER_NAME = "default";
export const COMMAND_DATA_PROVIDER_NAME = "command";
