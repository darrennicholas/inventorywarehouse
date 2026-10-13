
"use client";

import {
  useState,
  type ReactNode,
} from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  LoaderCircle,
  LogOut,
  ShieldCheck,
  Moon,
  Sun,
} from "lucide-react";

import { usePathname } from "next/navigation";

import { useAuth } from "./AuthProvider";
import LoginView from "./LoginView";
import { useTheme } from "@/components/theme/ThemeProvider";

export default function AuthShell({
  children,
}: {
  children: ReactNode;
}) {
  const {
    user,
    loading,
    error,
    refresh,
    logout,
    can,
  } = useAuth();

  const router = useRouter();
  const pathname = usePathname();
  const { dark, toggle } = useTheme();

  const [loggingOut, setLoggingOut] =
    useState(false);

  const [actionError, setActionError] =
    useState("");

  // ========================================
  // INITIAL LOADING
  // ========================================

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center gap-3 bg-slate-100 text-slate-700 dark:bg-slate-950 dark:text-slate-200">
        <LoaderCircle
          size={22}
          className="animate-spin text-blue-600"
        />
        <span className="text-sm text-slate-600">
          Checking your session...
        </span>
      </main>
    );
  }

  // ========================================
  // BACKEND CONNECTION ERROR
  // ========================================

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm dark:bg-slate-900">
          <h2 className="text-lg font-bold text-red-600">
            Cannot Connect to StockFlow
          </h2>

          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            {error}
          </p>

          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            Make sure your Express backend is running.
          </p>

          <button
            type="button"
            onClick={() =>
              void refresh().catch((reason) =>
                setActionError(
                  reason instanceof Error
                    ? reason.message
                    : "Retry failed"
                )
              )
            }
            className="mt-5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm text-white"
          >
            Retry Connection
          </button>

          {actionError && (
            <p className="mt-3 text-xs text-red-600">
              {actionError}
            </p>
          )}
        </div>
      </main>
    );
  }

  // ========================================
  // NO ACTIVE SESSION
  // ========================================

  if (!user) {
    return <LoginView />;
  }

  // ========================================
  // LOGOUT
  // ========================================

  async function handleLogout() {
    setActionError("");
    setLoggingOut(true);

    try {
      await logout();
      router.replace("/");
    } catch (reason) {
      setActionError(
        reason instanceof Error
          ? reason.message
          : "Logout failed"
      );
    } finally {
      setLoggingOut(false);
    }
  }

  const canManageAccess =
    can("users.manage") ||
    can("roles.manage");

  // ========================================
  // AUTHENTICATED LAYOUT
  // ========================================

  return (
    <>
      {pathname !== "/" && <div className="relative z-50 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-7">
          <div className="flex items-center gap-3">
            {canManageAccess && <Link href="/admin/access" className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 dark:bg-blue-950/50 dark:text-blue-300"><ShieldCheck size={16} /> Access Management</Link>}
            <button type="button" onClick={toggle} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" aria-label="Toggle dark mode">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-sm font-bold text-white">{user.fullName.slice(0, 1).toUpperCase()}</div>
            <div className="text-right"><p className="text-xs font-bold text-slate-800 dark:text-white">{user.fullName}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">{user.role.name}</p></div>
            <button type="button" onClick={() => void handleLogout()} disabled={loggingOut} className="flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/70 dark:hover:bg-red-950/40"><LogOut size={16} />{loggingOut ? "Logging out..." : "Logout"}</button>
          </div>
        </div>

        {actionError && (
          <p
            role="alert"
            className="mx-auto max-w-[1600px] px-7 pb-3 text-xs text-red-600"
          >
            {actionError}
          </p>
        )}
      </div>}

      {children}
    </>
  );
}
