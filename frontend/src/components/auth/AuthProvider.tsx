
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  authApi,
  ApiError,
  registerUnauthorizedHandler,
  setCsrfToken,
} from "@/lib/auth-api";

import type {
  AuthSessionData,
  AuthUser,
} from "@/types/auth";

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  error: string;

  login: (
    email: string,
    password: string
  ) => Promise<void>;

  logout: () => Promise<void>;

  refresh: () => Promise<void>;

  can: (permission: string) => boolean;
}

const AuthContext =
  createContext<AuthContextType | null>(null);

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [user, setUser] =
    useState<AuthUser | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    return registerUnauthorizedHandler(() => {
      setCsrfToken(null);
      setUser(null);
      setError("");
      setLoading(false);
    });
  }, []);

  // ========================================
  // CHECK CURRENT SESSION
  // ========================================

  const refresh = useCallback(async () => {
    try {
      const result =
        await authApi<AuthSessionData>(
          "/api/auth/me"
        );

      setCsrfToken(result.data.csrfToken);
      setUser(result.data.user);
      setError("");
    } catch (reason) {
      if (
        reason instanceof ApiError &&
        (reason.status === 401 ||
          reason.status === 403)
      ) {
        setCsrfToken(null);
        setUser(null);
        setError("");
        return;
      }

      throw reason;
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        await refresh();
      } catch (reason) {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Cannot connect to backend"
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [refresh]);

  // ========================================
  // LOGIN
  // ========================================

  const login = useCallback(
    async (email: string, password: string) => {
      const result =
        await authApi<AuthSessionData>(
          "/api/auth/login",
          {
            method: "POST",
            body: JSON.stringify({
              email,
              password,
            }),
          }
        );

      setCsrfToken(result.data.csrfToken);
      setUser(result.data.user);
      setError("");
    },
    []
  );

  // ========================================
  // LOGOUT
  // ========================================

  const logout = useCallback(async () => {
    await authApi<unknown>(
      "/api/auth/logout",
      {
        method: "POST",
      }
    );

    setCsrfToken(null);
    setUser(null);
    setError("");
  }, []);

  // ========================================
  // PERMISSION CHECK
  // ========================================

  const can = useCallback(
    (permission: string) =>
      user?.permissions.includes(permission) ??
      false,
    [user]
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      login,
      logout,
      refresh,
      can,
    }),
    [user, loading, error, login, logout, refresh, can]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used within AuthProvider"
    );
  }

  return context;
}
