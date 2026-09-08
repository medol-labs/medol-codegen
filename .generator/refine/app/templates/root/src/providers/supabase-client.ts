import { createClient } from "@refinedev/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "./constants";

const FALLBACK_SUPABASE_URL = "http://127.0.0.1:54321";
const FALLBACK_SUPABASE_KEY = "not-configured";

export const supabaseClient: SupabaseClient = createClient(
  SUPABASE_URL || FALLBACK_SUPABASE_URL,
  SUPABASE_KEY || FALLBACK_SUPABASE_KEY,
  {
    db: {
      schema: "public",
    },
    auth: {
      persistSession: true,
    },
  }
);
