import type { DataProvider } from "@refinedev/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dataProvider as supabaseDataProvider } from "./data";

export const commandDataProvider = (
  supabaseClient: SupabaseClient<any, any, any>,
): Required<DataProvider> => {
  const baseUrl = "http://localhost:8080";

  return {
    ...supabaseDataProvider,
    create: async ({ resource, variables, meta }) => {
      const command = meta?.command;
      if (!command) {
        throw new Error(
          `[commandProvider] meta.command is required for command create`,
        );
      }

      const res = await fetch(
        `${baseUrl}/api/${resource}/${command.toLowerCase()}`,
        {
          method: "POST",
          body: JSON.stringify(variables),
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!res.ok) {
        throw new Error(`Command failed: ${resource}.${command}`);
      }

      return {
        data: await res.json(),
      };
    },
    getApiUrl: () => {
      throw Error("Not implemented on refine-supabase data provider.");
    },

    custom: () => {
      throw Error("Not implemented on refine-supabase data provider.");
    },
  };
};

import { supabaseClient } from "./supabase-client";

export const commandProvider = commandDataProvider(supabaseClient);
