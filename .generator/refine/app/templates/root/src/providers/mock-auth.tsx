import { AuthProvider } from "@refinedev/core";

const MOCK_AUTH_KEY = "refine-mock-authenticated";

const mockUser = {
  id: "mock-user",
  name: "Mock User",
  email: "mock@example.com",
  role: "admin",
};

const authProvider: AuthProvider = {
  login: async () => {
    localStorage.setItem(MOCK_AUTH_KEY, "true");

    return {
      success: true,
      redirectTo: "/",
    };
  },
  register: async () => {
    localStorage.setItem(MOCK_AUTH_KEY, "true");

    return {
      success: true,
      redirectTo: "/",
    };
  },
  forgotPassword: async () => {
    return {
      success: true,
    };
  },
  updatePassword: async () => {
    localStorage.setItem(MOCK_AUTH_KEY, "true");

    return {
      success: true,
      redirectTo: "/",
    };
  },
  logout: async () => {
    localStorage.removeItem(MOCK_AUTH_KEY);

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
    const authenticated = localStorage.getItem(MOCK_AUTH_KEY) === "true";

    if (!authenticated) {
      return {
        authenticated: false,
        logout: true,
        redirectTo: "/login",
        error: {
          message: "Check failed",
          name: "Not authenticated",
        },
      };
    }

    return {
      authenticated: true,
    };
  },
  getPermissions: async () => {
    return mockUser.role;
  },
  getIdentity: async () => {
    return mockUser;
  },
};

export default authProvider;
