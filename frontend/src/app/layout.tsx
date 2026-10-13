
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/auth/AuthProvider";
import AuthShell from "@/components/auth/AuthShell";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

import "./globals.css";

// ==========================================
// WEBSITE METADATA
// ==========================================

export const metadata: Metadata = {
  title: "StockFlow | Inventory & Warehouse Management",

  description:
    "StockFlow is an inventory and warehouse management system for managing products, stock, warehouses, suppliers, customers, staff, and user access.",

  applicationName: "StockFlow",

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
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        {/* ==================================
            GLOBAL AUTHENTICATION PROVIDER
        ================================== */}

        <ThemeProvider>
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
        </ThemeProvider>
      </body>
    </html>
  );
}
