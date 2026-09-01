import type { AuthProvider } from "@refinedev/core";
import type { Provider } from "@supabase/supabase-js";
import {
  authBackendBaseUrl,
  authProviderMode,
  cachedCurrentUser,
  clearLocalAuth,
  fetchCurrentUser,
  getAccessToken,
  storeLocalAuth,
} from "./api-auth";
import { supabaseClient } from "./supabase-client";

const readErrorMessage = async (response: Response, fallback: string) => {
  const text = await response.text();
  if (!text) {
    return fallback;
  }

  try {
    const payload = JSON.parse(text);
    return payload.detail || payload.title || payload.message || text;
  } catch {
    return text;
  }
};

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
          const message = await readErrorMessage(response, "Invalid username or password");
          return {
            success: false,
            error: {
              message: "Login failed",
              name: message,
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
  register: async ({ email, password, setupToken }) => {
    if (authProviderMode() === "local") {
      try {
        const response = await fetch(`${authBackendBaseUrl()}/api/auth/setup-admin`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            setupToken,
            username: email,
            password,
          }),
        });

        if (!response.ok) {
          const message = await readErrorMessage(response, "Admin setup is disabled or already completed");
          return {
            success: false,
            error: {
              message: "Admin setup failed",
              name: message || "Admin setup is disabled or already completed",
            },
          };
        }

        return {
          success: true,
          redirectTo: "/login",
          successNotification: {
            message: "Admin account initialized",
            description: "You can now sign in with the administrator account.",
          },
        };
      } catch (error: any) {
        return {
          success: false,
          error,
        };
      }
    }

    try {
      const { data } = await supabaseClient.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        return {
          success: false,
          error: {
            message: "Admin setup failed",
            name: "Sign in with the Supabase administrator account first",
          },
        };
      }

      const response = await fetch(`${authBackendBaseUrl()}/api/auth/setup-supabase-admin`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          setupToken,
        }),
      });

      if (!response.ok) {
        const message = await readErrorMessage(response, "Admin setup is disabled or already completed");
        return {
          success: false,
          error: {
            message: "Admin setup failed",
            name: message || "Admin setup is disabled or already completed",
          },
        };
      }

      await fetchCurrentUser();

      return {
        success: true,
        redirectTo: "/",
        successNotification: {
          message: "Admin account initialized",
          description: "The current Supabase user is now the administrator.",
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error,
      };
    }

    return {
      success: false,
      error: {
        message: "Admin setup failed",
        name: "Admin setup is disabled or already completed",
      },
    };
  },
  forgotPassword: async ({ email }) => {
    if (authProviderMode() === "local") {
      return {
        success: false,
        error: {
          message: "Forgot password failed",
          name: "Local password reset is not enabled",
        },
      };
    }

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
    if (authProviderMode() === "local") {
      return {
        success: false,
        error: {
          message: "Update password failed",
          name: "Local password update is not enabled",
        },
      };
    }

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
      if (await getAccessToken() && cachedCurrentUser()) {
        await fetchCurrentUser();

        return {
          authenticated: true,
        };
      }

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
