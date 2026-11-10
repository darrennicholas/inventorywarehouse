
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/auth/AuthProvider";
import AuthShell from "@/components/auth/AuthShell";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { GlobalAlertProvider } from "@/components/ui/GlobalAlert";
import GlobalActionLoading from "@/components/ui/GlobalActionLoading";
import "@fontsource-variable/inter/wght.css";

import "./globals.css";

// ==========================================
// WEBSITE METADATA
// ==========================================

export const metadata: Metadata = {
  title: "StockFlow | Inventory & Warehouse Management",

  description:
    "StockFlow is an inventory and warehouse management system for managing products, stock, warehouses, suppliers, customers, staff, and user access.",

  applicationName: "StockFlow",

  icons: {
    icon: "/stockflow-icon.svg",
    shortcut: "/stockflow-icon.svg",
    apple: "/stockflow-icon.svg",
  },

  robots: {
    index: false,
    follow: false,
  },
};

// ==========================================
// ROOT LAYOUT
// ==========================================

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="id" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        {/* ==================================
            GLOBAL AUTHENTICATION PROVIDER
        ================================== */}

        <ThemeProvider>
        <GlobalAlertProvider>
        <GlobalActionLoading>
        <AuthProvider>
          {/* ================================
              AUTHENTICATION SHELL
              - Login Page
              - Session Checking
              - Protected Dashboard
              - Logout
              - RBAC Navigation
          ================================ */}

          <AuthShell>
            {children}
          </AuthShell>

        </AuthProvider>
        </GlobalActionLoading>
        </GlobalAlertProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
