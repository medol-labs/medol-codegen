import type { AuthProvider } from "@refinedev/core";
import type { Provider } from "@supabase/supabase-js";
import {
  authBackendBaseUrl,
  authProviderMode,
  cachedCurrentUser,
  clearLocalAuth,
  fetchCurrentUser,
  storeLocalAuth,
} from "./api-auth";
import { supabaseClient } from "./supabase-client";

const authProvider: AuthProvider = {
  login: async (params) => {
    const { email, username, password, providerName } = params as {
      email?: string;
      username?: string;
      password?: string;
      providerName?: string;
    };

    try {
      if (authProviderMode() === "local") {
        const response = await fetch(`${authBackendBaseUrl()}/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: username ?? email,
            password,
          }),
        });

        if (!response.ok) {
          return {
            success: false,
            error: {
              message: "Login failed",
              name: "Invalid username or password",
            },
          };
        }

        const payload = await response.json();
        storeLocalAuth(payload.accessToken, payload.user);

        return {
          success: true,
          redirectTo: "/",
        };
      }

      if (providerName) {
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
          provider: providerName as Provider,
        });

        if (error) {
          return {
            success: false,
            error,
          };
        }

        if (data?.url) {
          return {
            success: true,
            redirectTo: "/",
          };
        }
      }

      if (!email || !password) {
        return {
          success: false,
          error: {
            message: "Login failed",
            name: "Email and password are required",
          },
        };
      }

      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return {
          success: false,
          error,
        };
      }

      if (data?.user) {
        await fetchCurrentUser();

        return {
          success: true,
          redirectTo: "/",
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error,
      };
    }

    return {
      success: false,
      error: {
        message: "Login failed",
        name: "Invalid email or password",
      },
    };
  },
  register: async ({ email, password }) => {
    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
      });

      if (error) {
        return {
          success: false,
          error,
        };
      }

      if (data) {
        return {
          success: true,
          redirectTo: "/",
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error,
      };
    }

    return {
      success: false,
      error: {
        message: "Register failed",
        name: "Invalid email or password",
      },
    };
  },
  forgotPassword: async ({ email }) => {
    try {
      const { data, error } = await supabaseClient.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: `${window.location.origin}/update-password`,
        }
      );

      if (error) {
        return {
          success: false,
          error,
        };
      }

      if (data) {
        return {
          success: true,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error,
      };
    }

    return {
      success: false,
      error: {
        message: "Forgot password failed",
        name: "Invalid email",
      },
    };
  },
  updatePassword: async ({ password }) => {
    try {
      const { data, error } = await supabaseClient.auth.updateUser({
        password,
      });

      if (error) {
        return {
          success: false,
          error,
        };
      }

      if (data) {
        return {
          success: true,
          redirectTo: "/",
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error,
      };
    }
    return {
      success: false,
      error: {
        message: "Update password failed",
        name: "Invalid password",
      },
    };
  },
  logout: async () => {
    clearLocalAuth();

    if (authProviderMode() === "local") {
      return {
        success: true,
        redirectTo: "/login",
      };
    }

    const { error } = await supabaseClient.auth.signOut();

    if (error) {
      return {
        success: false,
        error,
      };
    }

    return {
      success: true,
      redirectTo: "/login",
    };
  },
  onError: async (error) => {
    console.error(error);
    return { error };
  },
  check: async () => {
    try {
      if (authProviderMode() === "local") {
        await fetchCurrentUser();

        return {
          authenticated: true,
        };
      }

      const { data } = await supabaseClient.auth.getSession();
      const { session } = data;

      if (!session) {
        return {
          authenticated: false,
          error: {
            message: "Check failed",
            name: "Session not found",
          },
          logout: true,
          redirectTo: "/login",
        };
      }

      await fetchCurrentUser();
    } catch (error: any) {
      return {
        authenticated: false,
        error: error || {
          message: "Check failed",
          name: "Not authenticated",
        },
        logout: true,
        redirectTo: "/login",
      };
    }

    return {
      authenticated: true,
    };
  },
  getPermissions: async () => {
    const user = cachedCurrentUser() ?? (await fetchCurrentUser());
    return user.permissions;
  },
  getIdentity: async () => {
    return cachedCurrentUser() ?? (await fetchCurrentUser());
  },
};

export default authProvider;
