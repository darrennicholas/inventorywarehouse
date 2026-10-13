
"use client";

import {
  useState,
  type FormEvent,
} from "react";

import {
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Moon,
  PackageCheck,
  Sun,
} from "lucide-react";

import { useAuth } from "./AuthProvider";
import { useTheme } from "@/components/theme/ThemeProvider";

export default function LoginView() {
  const { login } = useAuth();
  const { dark, toggle } = useTheme();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] =
    useState(false);

  const [submitting, setSubmitting] =
    useState(false);

  const [error, setError] =
    useState("");

  async function handleLogin(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setSubmitting(true);

    try {
      await login(
        email.trim().toLowerCase(),
        password
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Login failed"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <button
        type="button"
        onClick={toggle}
        aria-label="Toggle dark mode"
        className="absolute right-5 top-5 rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50">
        {/* LOGO */}
        <div className="mb-9 flex items-center gap-3">
          <div className="rounded-xl bg-blue-600 p-3 text-white">
            <PackageCheck size={27} />
          </div>

          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">
              StockFlow
              <span className="text-blue-600">.</span>
            </h1>

            <p className="text-xs text-slate-500">
              Inventory & Warehouse Management
            </p>
          </div>
        </div>

        <h2 className="text-xl font-bold text-slate-900">
          Welcome Back
        </h2>

        <p className="mt-2 text-sm text-slate-500">
          Sign in to access your workspace.
        </p>

        <form
          onSubmit={handleLogin}
          className="mt-7 space-y-5"
        >
          <div>
            <label
              htmlFor="login-email"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Email Address
            </label>

            <input
              id="login-email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder="admin@stockflow.local"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Password
            </label>

            <div className="relative">
              <input
                id="login-password"
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                placeholder="Enter your password"
                className="w-full rounded-xl border border-slate-200 py-3 pl-4 pr-12 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />

              <button
                type="button"
                onClick={() =>
                  setShowPassword((value) => !value)
                }
                aria-label={
                  showPassword
                    ? "Hide password"
                    : "Show password"
                }
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400"
              >
                {showPassword ? (
                  <EyeOff size={19} />
                ) : (
                  <Eye size={19} />
                )}
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? (
              <LoaderCircle
                size={18}
                className="animate-spin"
              />
            ) : (
              <LockKeyhole size={18} />
            )}

            {submitting
              ? "Signing in..."
              : "Sign In"}
          </button>
        </form>

        <p className="mt-8 text-center text-xs text-slate-400">
          Access is restricted to authorized users.
        </p>
      </div>
    </main>
  );
}
