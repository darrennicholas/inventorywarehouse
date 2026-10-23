
"use client";

import { useEffect, useState } from "react";

import {
  AlertCircle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  Boxes,
  ChartNoAxesColumn,
  ClipboardCheck,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  History,
  LogOut,
  Menu,
  Moon,
  Package,
  PackageCheck,
  Plus,
  RefreshCw,
  Ruler,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Sun,
  Tag,
  Truck,
  UserRound,
  Users,
  Wallet,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react";

import CategoriesView from "@/components/categories/CategoriesView";
import BrandsView from "@/components/brands/BrandsView";
import UnitsView from "@/components/units/UnitsView";
import ProductsView from "@/components/products/ProductsView";
import CustomersView from "@/components/customers/CustomersView";
import WarehousesView from "@/components/warehouses/WarehousesView";
import StaffView from "@/components/staff/StaffView";
import SuppliersView from "@/components/suppliers/SuppliersView";
import OperationsView from "@/components/operations/OperationsView";
import FulfillmentView from "@/components/fulfillment/FulfillmentView";
import ReturnsView from "@/components/returns/ReturnsView";
import DashboardView from "@/components/dashboard/DashboardView";
import MasterModuleFrame from "@/components/master/MasterModuleFrame";
import AuditLogsView from "@/components/audit/AuditLogsView";
import StockOpnamesView from "@/components/stock-opnames/StockOpnamesView";
import NotificationBell from "@/components/notifications/NotificationBell";
import { useAuth } from "@/components/auth/AuthProvider";
import { useTheme } from "@/components/theme/ThemeProvider";
import { apiRequest } from "@/lib/api";

import { useProducts } from "@/hooks/useProducts";

// ==========================================
// PAGE TYPES
// ==========================================

type Page =
  | "dashboard"
  | "categories"
  | "brands"
  | "units"
  | "products"
  | "warehouses"
  | "staff"
  | "customers"
  | "suppliers"
  | "purchases"
  | "sales"
  | "purchase-returns"
  | "sales-returns"
  | "fulfillment"
  | "adjustments"
  | "transfers"
  | "expenses"
  | "payments"
  | "stock-report"
  | "audit"
  | "stock-opnames";

type MenuItem = {
  label: string;
  icon: LucideIcon;
  page: Page | null;
  permission?: string;
};

type DashboardMasterRow = {
  id: string;
  name: string;
  code?: string;
  isActive: boolean;
  createdAt: string;
};

type DashboardSummary = {
  kpis: { purchaseValue: number; salesValue: number; expenseValue: number; stockUnits: number; lowStockLines: number };
  monthly: Array<{ label: string; purchases: number; sales: number; expenses: number }>;
  topProducts: Array<{ id: string; sku: string; name: string; quantity: number; minStock: number }>;
  warehouseStock: Array<{ id: string; name: string; quantity: number }>;
  lowStock: Array<{ productId: string; sku: string; productName: string; warehouseId: string; warehouseName: string; quantityOnHand: number; minStock: number; reorderQuantity: number }>;
};

// ==========================================
// PRODUCT SUBMENU
// ==========================================

const productSubmenus: MenuItem[] = [
  {
    label: "Categories",
    icon: Tag,
    page: "categories",
    permission: "categories.read",
  },
  {
    label: "Brands",
    icon: Boxes,
    page: "brands",
    permission: "brands.read",
  },
  {
    label: "Units",
    icon: Ruler,
    page: "units",
    permission: "units.read",
  },
  {
    label: "Products",
    icon: Package,
    page: "products",
    permission: "products.read",
  },
];

// ==========================================
// OTHER SIDEBAR MENUS
// ==========================================

const otherMenus: MenuItem[] = [
  {
    label: "Warehouse",
    icon: Warehouse,
    page: "warehouses",
    permission: "warehouses.read",
  },
  {
    label: "Staff",
    icon: Users,
    page: "staff",
    permission: "staff.read",
  },
  {
    label: "Customer",
    icon: UserRound,
    page: "customers",
    permission: "customers.read",
  },
  {
    label: "Supplier",
    icon: Truck,
    page: "suppliers",
    permission: "suppliers.read",
  },
  {
    label: "Purchase",
    icon: ShoppingCart,
    page: "purchases",
    permission: "purchases.read",
  },
  {
    label: "Sale",
    icon: ShoppingBag,
    page: "sales",
    permission: "sales.read",
  },
  {
    label: "Purchase Return",
    icon: ArrowDownLeft,
    page: "purchase-returns",
    permission: "purchase-returns.read",
  },
  {
    label: "Sales Return",
    icon: RefreshCw,
    page: "sales-returns",
    permission: "sales-returns.read",
  },
  {
    label: "Fulfillment",
    icon: PackageCheck,
    page: "fulfillment",
    permission: "fulfillment.read",
  },
  {
    label: "Adjustment",
    icon: SlidersHorizontal,
    page: "adjustments",
    permission: "adjustments.read",
  },
  {
    label: "Transfer",
    icon: ArrowLeftRight,
    page: "transfers",
    permission: "transfers.read",
  },
  {
    label: "Expense",
    icon: Wallet,
    page: "expenses",
    permission: "expenses.read",
  },
  {
    label: "Payment Report",
    icon: ClipboardList,
    page: "payments",
    permission: "payments.read",
  },
  {
    label: "Stock Report",
    icon: ChartNoAxesColumn,
    page: "stock-report",
    permission: "reports.read",
  },
  {
    label: "Stock Opname",
    icon: ClipboardCheck,
    page: "stock-opnames",
    permission: "stock-opnames.read",
  },
  {
    label: "Audit Log",
    icon: History,
    page: "audit",
    permission: "audit.read",
  },
];

// ==========================================
// PAGE TITLES
// ==========================================

const pageTitles: Record<Page, string> = {
  dashboard: "Dashboard",
  categories: "Category Management",
  brands: "Brand Management",
  units: "Unit Management",
  products: "Product Management",
  warehouses: "Warehouse Management",
  staff: "Staff Management",
  customers: "Customer Management",
  suppliers: "Supplier Management",
  purchases: "Purchase Management",
  sales: "Sale Management",
  "purchase-returns": "Purchase Returns",
  "sales-returns": "Sales Returns",
  fulfillment: "Sales Fulfillment",
  adjustments: "Stock Adjustment",
  transfers: "Stock Transfer",
  expenses: "Expense Management",
  payments: "Payment Report",
  "stock-report": "Stock Report",
  audit: "Audit Log",
  "stock-opnames": "Stock Opname",
};

const pagePermissions: Record<Page, string> = {
  dashboard: "dashboard.read",
  categories: "categories.read",
  brands: "brands.read",
  units: "units.read",
  products: "products.read",
  warehouses: "warehouses.read",
  staff: "staff.read",
  customers: "customers.read",
  suppliers: "suppliers.read",
  purchases: "purchases.read",
  sales: "sales.read",
  "purchase-returns": "purchase-returns.read",
  "sales-returns": "sales-returns.read",
  fulfillment: "fulfillment.read",
  adjustments: "adjustments.read",
  transfers: "transfers.read",
  expenses: "expenses.read",
  payments: "payments.read",
  "stock-report": "reports.read",
  audit: "audit.read",
  "stock-opnames": "stock-opnames.read",
};

// ==========================================
// FORMAT DATE
// ==========================================

function formatDate(date?: string) {
  if (!date) return "—";

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return parsed.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ==========================================
// MAIN HOME COMPONENT
// ==========================================

export default function Home() {
  const { can, user, logout } = useAuth();
  const { dark, toggle } = useTheme();

  // ====================================
  // NAVIGATION STATE
  // ====================================

  const [activePage, setActivePage] =
    useState<Page>("dashboard");

  const [
    productMenuOpen,
    setProductMenuOpen,
  ] = useState(true);

  const [
    sidebarCollapsed,
    setSidebarCollapsed,
  ] = useState(false);

  const [
    mobileMenuOpen,
    setMobileMenuOpen,
  ] = useState(false);

  const [profileMenuOpen, setProfileMenuOpen] =
    useState(false);

  const [
    createRequested,
    setCreateRequested,
  ] = useState(0);

  // ====================================
  // PRODUCT DATA
  // ====================================

  const productsStore = useProducts(can("products.read"));

  const {
    products,
    loading,
    error,
    fetchProducts,
  } = productsStore;

  const uniqueSKU = new Set(
    products.map((product) => product.sku)
  ).size;

  const [categories, setCategories] =
    useState<DashboardMasterRow[]>([]);
  const [brands, setBrands] =
    useState<DashboardMasterRow[]>([]);
  const [units, setUnits] =
    useState<DashboardMasterRow[]>([]);
  const [masterLoading, setMasterLoading] =
    useState(true);
  const [dashboardSummary, setDashboardSummary] =
    useState<DashboardSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void Promise.resolve().then(async () => {
      setMasterLoading(true);

      try {
        const [categoryResponse, brandResponse, unitResponse, summaryResponse] =
          await Promise.all([
            can("categories.read")
              ? apiRequest<{ data?: DashboardMasterRow[] }>(
                  "/api/categories",
                  { signal: controller.signal }
                )
              : Promise.resolve(null),
            can("brands.read")
              ? apiRequest<{ data?: DashboardMasterRow[] }>(
                  "/api/brands",
                  { signal: controller.signal }
                )
              : Promise.resolve(null),
            can("units.read")
              ? apiRequest<{ data?: DashboardMasterRow[] }>(
                  "/api/units",
                  { signal: controller.signal }
                )
              : Promise.resolve(null),
            can("dashboard.read")
              ? apiRequest<{ data?: DashboardSummary }>(
                  "/api/operations/dashboard-summary",
                  { signal: controller.signal }
                )
              : Promise.resolve(null),
          ]);

        if (!controller.signal.aborted) {
          setCategories(categoryResponse?.data ?? []);
          setBrands(brandResponse?.data ?? []);
          setUnits(unitResponse?.data ?? []);
          setDashboardSummary(summaryResponse?.data ?? null);
        }
      } catch {
        if (!controller.signal.aborted) {
          setCategories([]);
          setBrands([]);
          setUnits([]);
          setDashboardSummary(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setMasterLoading(false);
        }
      }
    });

    return () => controller.abort();
  }, [can]);

  // ====================================
  // ACTIVE PRODUCT SECTION
  // ====================================

  const isProductSection =
    activePage === "categories" ||
    activePage === "brands" ||
    activePage === "units" ||
    activePage === "products";

  const visibleProductSubmenus = productSubmenus.filter(
    (item) => !item.permission || can(item.permission)
  );

  const visibleOtherMenus = otherMenus.filter(
    (item) => !item.permission || can(item.permission)
  );

  const activePermission = pagePermissions[activePage];

  // ====================================
  // NAVIGATE
  // ====================================

  function navigate(page: Page) {
    setActivePage(page);
    setMobileMenuOpen(false);

    if (page !== "products") {
      setCreateRequested(0);
    }

    if (
      page === "products" ||
      page === "categories" ||
      page === "brands" ||
      page === "units"
    ) {
      setProductMenuOpen(true);
    }
  }

  async function handleLogout() {
    try {
      await logout();
      setProfileMenuOpen(false);
    } catch (reason) {
      setProfileMenuOpen(false);
      console.error(reason);
    }
  }

  // ====================================
  // ADD PRODUCT FROM DASHBOARD
  // ====================================

  function openAddModal() {
    setActivePage("products");
    setProductMenuOpen(true);
    setMobileMenuOpen(false);

    setCreateRequested(
      (previous) => previous + 1
    );
  }

  // ====================================
  // SIDEBAR
  // ====================================

  const sidebar = (
    <aside
      className={`
        fixed inset-y-0 left-0 z-40 flex flex-col
        border-r border-slate-200/80 bg-gradient-to-b from-white to-[#f8faff]
        shadow-xl shadow-slate-200/30
        transition-all duration-200
        lg:sticky lg:top-0 lg:h-screen lg:translate-x-0
        ${
          mobileMenuOpen
            ? "translate-x-0"
            : "-translate-x-full"
        }
        ${
          sidebarCollapsed
            ? "w-[250px] lg:w-[200px]"
            : "w-[250px]"
        }
      `}
    >
      {/* LOGO */}
      <div className="flex h-[86px] items-center justify-between border-b border-slate-100 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#3767f6] to-[#5b45e8] text-white shadow-lg shadow-blue-500/25">
            <PackageCheck size={24} />
          </div>

          <div
            className={
              sidebarCollapsed
                ? "lg:hidden"
                : ""
            }
          >
            <h1 className="text-xl font-extrabold tracking-tight text-[#14203b]">
              StockFlow
              <span className="text-[#3767f6]">
                .
              </span>
            </h1>

            <p className="text-[10px] font-medium text-slate-400">
              Inventory Management
            </p>
          </div>
        </div>

        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() =>
            setMobileMenuOpen(false)
          }
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
        >
          <X size={19} />
        </button>
      </div>

      {/* ================================= */}
      {/* SIDEBAR NAVIGATION */}
      {/* ================================= */}

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
        <p
          className={`mb-2 whitespace-nowrap px-3 font-bold uppercase text-slate-400 ${
            sidebarCollapsed
              ? "text-[9px] tracking-[0.12em]"
              : "text-[10px] tracking-[0.18em]"
          }`}
        >
          Workspace
        </p>
        {/* DASHBOARD */}
        {can("dashboard.read") && <button
          type="button"
          title="Dashboard"
          onClick={() =>
            navigate("dashboard")
          }
          className={`mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-[13px] font-medium transition ${
            activePage === "dashboard"
              ? "border-blue-100 bg-gradient-to-r from-[#edf3ff] to-white text-[#2965ec] shadow-sm"
              : "border-transparent text-[#626e80] hover:-translate-y-0.5 hover:bg-white hover:text-[#2965ec] hover:shadow-sm"
          }`}
        >
          <LayoutDashboard size={17} />

          <span
            className={
              sidebarCollapsed
                ? "lg:hidden"
                : ""
            }
          >
            Dashboard
          </span>
        </button>}

        {/* MANAGE PRODUCT */}
        {visibleProductSubmenus.length > 0 && <button
          type="button"
          title="Manage Product"
          aria-expanded={productMenuOpen}
          onClick={() =>
            setProductMenuOpen(
              (previous) => !previous
            )
          }
          className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-[13px] font-semibold transition ${
            isProductSection
              ? "border-blue-100 bg-gradient-to-r from-[#edf3ff] to-white text-[#2965ec] shadow-sm"
              : "border-transparent text-[#626e80] hover:bg-white hover:shadow-sm"
          }`}
        >
          <Boxes size={17} />

          <span
            className={`flex-1 ${
              sidebarCollapsed
                ? "lg:hidden"
                : ""
            }`}
          >
            Manage Product
          </span>

          <span
            className={
              sidebarCollapsed
                ? "lg:hidden"
                : ""
            }
          >
            {productMenuOpen ? (
              <ChevronDown size={15} />
            ) : (
              <ChevronRight size={15} />
            )}
          </span>
        </button>}

        {/* PRODUCT SUBMENU */}
        {productMenuOpen && visibleProductSubmenus.length > 0 && (
          <div
            className={`mb-3 ml-5 space-y-0.5 border-l border-slate-200 pl-3 ${
              sidebarCollapsed
                ? "lg:hidden"
                : ""
            }`}
          >
            {visibleProductSubmenus.map(
              (item) => {
                const Icon = item.icon;

                const active =
                  item.page === activePage;

                return (
                  <button
                    key={item.label}
                    type="button"
                    disabled={!item.page}
                    title={item.label}
                    onClick={() => {
                      if (item.page) {
                        navigate(
                          item.page
                        );
                      }
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[12px] transition ${
                      active
                        ? "bg-[#f3f6ff] font-semibold text-[#2867ed] shadow-sm"
                        : "text-slate-500 hover:translate-x-0.5"
                    } ${
                      item.page
                        ? "hover:bg-[#f3f6ff]"
                        : "cursor-not-allowed opacity-65"
                    }`}
                  >
                    <Icon size={15} />

                    <span className="flex-1">
                      {item.label}
                    </span>
                  </button>
                );
              }
            )}
          </div>
        )}

        {/* ================================= */}
        {/* OTHER MENUS */}
        {/* ================================= */}

        <div className="mt-5 space-y-1 border-t border-slate-200/70 pt-5">
          <p
            className={`mb-2 whitespace-nowrap px-3 font-bold uppercase text-slate-400 ${
              sidebarCollapsed
                ? "text-[9px] tracking-[0.12em]"
                : "text-[10px] tracking-[0.18em]"
            }`}
          >
            Operations & Reports
          </p>
          {visibleOtherMenus.map(
            (item) => {
              const Icon = item.icon;

              const active =
                item.page === activePage;

              return (
                <button
                  key={item.label}
                  type="button"
                  disabled={!item.page}
                  title={
                    item.page
                      ? item.label
                      : `${item.label} — Coming soon`
                  }
                  onClick={() => {
                    if (item.page) {
                      navigate(
                        item.page
                      );
                    }
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-[13px] transition ${
                    active
                      ? "border-blue-100 bg-gradient-to-r from-[#edf3ff] to-white font-semibold text-[#2965ec] shadow-sm"
                      : item.page
                        ? "border-transparent text-[#626e80] hover:-translate-y-0.5 hover:bg-white hover:text-[#2965ec] hover:shadow-sm"
                        : "cursor-not-allowed border-transparent text-[#7a8493] opacity-70"
                  }`}
                >
                  <Icon size={16} />

                  <span
                    className={`flex-1 ${
                      sidebarCollapsed
                        ? "lg:hidden"
                        : ""
                    }`}
                  >
                    {item.label}
                  </span>
                </button>
              );
            }
          )}
        </div>
      </nav>

      {/* SIDEBAR FOOTER */}
      <div className="border-t border-slate-100 p-4">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />

          <span
            className={
              sidebarCollapsed
                ? "lg:hidden"
                : ""
            }
          >
            Development Preview
          </span>
        </div>
      </div>
    </aside>
  );

  // ====================================
  // DASHBOARD STATISTICS
  // ====================================

  const dashboardStats = [
    {
      title: "Total Products",
      value: loading
        ? "..."
        : String(products.length),

      icon: Package,
      iconColor: "text-blue-600",
      iconBackground: "bg-blue-50",
      subtitle: "Registered products",
    },
    {
      title: "Unique SKU",
      value: loading
        ? "..."
        : String(uniqueSKU),

      icon: Boxes,
      iconColor: "text-emerald-600",
      iconBackground: "bg-emerald-50",
      subtitle: "Unique product codes",
    },
    {
      title: "Warehouses",
      value: "—",
      icon: Warehouse,
      iconColor: "text-violet-600",
      iconBackground: "bg-violet-50",
      subtitle: "Warehouse dashboard metrics coming soon",
    },
    {
      title: "Low Stock Alerts",
      value: "—",
      icon: AlertCircle,
      iconColor: "text-orange-600",
      iconBackground: "bg-orange-50",
      subtitle: "Waiting for inventory module",
    },
  ];

  // ====================================
  // MAIN RENDER
  // ====================================

  return (
    <div className="min-h-screen bg-[#f5f6f9] text-[#172238] lg:flex">
      {/* MOBILE OVERLAY */}
      {mobileMenuOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() =>
            setMobileMenuOpen(false)
          }
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}

      {sidebar}

      {/* MAIN CONTENT */}
      <div className="min-w-0 flex-1">
        {/* HEADER */}
        <header className="sticky top-0 z-20 flex h-[86px] items-center justify-between border-b border-slate-200/70 bg-white/80 px-5 shadow-sm backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3">
            {/* MOBILE MENU BUTTON */}
            <button
              type="button"
              aria-label="Open sidebar"
              onClick={() =>
                setMobileMenuOpen(true)
              }
              className="rounded-lg p-2 text-[#3475f5] hover:bg-white lg:hidden"
            >
              <Menu size={23} />
            </button>

            {/* DESKTOP COLLAPSE BUTTON */}
            <button
              type="button"
              aria-label="Toggle sidebar"
              onClick={() =>
                setSidebarCollapsed(
                  (previous) => !previous
                )
              }
              className="hidden rounded-lg p-2 text-[#3475f5] hover:bg-white lg:block"
            >
              <Menu size={22} />
            </button>

            <div className="hidden sm:block">
              <p className="text-xs font-medium text-slate-400">
                Inventory Warehouse System
              </p>

              <h2 className="text-sm font-semibold text-slate-700">
                {pageTitles[activePage]}
              </h2>
            </div>
          </div>

          {/* HEADER RIGHT */}
          <div className="flex items-center gap-3 sm:gap-5">
            <button
              type="button"
              onClick={toggle}
              aria-label="Toggle dark mode"
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
              className="rounded-xl border border-slate-200 p-2.5 text-slate-500 transition hover:-translate-y-0.5 hover:bg-white hover:text-[#2965ec] dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <NotificationBell />

            <div className="relative border-l border-slate-200 pl-3 dark:border-slate-700">
              <button
                type="button"
                aria-expanded={profileMenuOpen}
                onClick={() => setProfileMenuOpen((previous) => !previous)}
                className="flex items-center gap-2 rounded-xl p-1.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#3767f6] to-[#5b45e8] text-sm font-bold text-white shadow-md shadow-blue-500/20">
                  {user?.fullName.slice(0, 1).toUpperCase() ?? <UserRound size={18} />}
                </div>

                <div className="hidden sm:block">
                  <p className="text-xs font-bold text-[#182438] dark:text-white">
                    {user?.fullName}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-400">
                    {user?.role.name}
                  </p>
                </div>

                <ChevronDown size={15} className="text-slate-400" />
              </button>

              {profileMenuOpen && (
                <div className="absolute right-0 top-14 z-50 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{user?.fullName}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleLogout()}
                    className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                  >
                    <LogOut size={16} />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* ================================= */}
        {/* MAIN BODY */}
        {/* ================================= */}

        <main className="mx-auto max-w-[1530px] space-y-6 px-4 py-7 sm:px-7 lg:px-9">
          {/* DASHBOARD API ERROR */}
          {error &&
            activePage === "dashboard" && (
              <div
                role="alert"
                className="rounded-xl bg-red-50 p-4 text-sm text-red-700"
              >
                Failed to load products:{" "}
                {error}

                <button
                  type="button"
                  onClick={() =>
                    void fetchProducts()
                  }
                  className="ml-3 font-semibold underline"
                >
                  Retry
                </button>
              </div>
            )}

          {activePage !== "dashboard" &&
            !can(activePermission) && (
              <div
                role="alert"
                className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800"
              >
                Access Denied: you do not have permission to view this module.
              </div>
            )}

          {/* ================================= */}
          {/* CATEGORIES */}
          {/* ================================= */}

          {activePage === "categories" && can("categories.read") && (
            <MasterModuleFrame kind="categories"><CategoriesView /></MasterModuleFrame>
          )}

          {/* ================================= */}
          {/* BRANDS */}
          {/* ================================= */}

          {activePage === "brands" && can("brands.read") && (
            <MasterModuleFrame kind="brands"><BrandsView /></MasterModuleFrame>
          )}

          {/* ================================= */}
          {/* UNITS */}
          {/* ================================= */}

          {activePage === "units" && can("units.read") && (
            <MasterModuleFrame kind="units"><UnitsView /></MasterModuleFrame>
          )}

          {/* ================================= */}
          {/* PRODUCTS */}
          {/* ================================= */}

          {activePage === "products" && can("products.read") && (
            <MasterModuleFrame kind="products"><ProductsView store={productsStore} createRequested={createRequested} /></MasterModuleFrame>
          )}

          {/* ================================= */}
          {/* WAREHOUSE */}
          {/* ================================= */}

          {activePage === "warehouses" && can("warehouses.read") && (
            <MasterModuleFrame kind="warehouses"><WarehousesView /></MasterModuleFrame>
          )}

          {/* ================================= */}
          {/* STAFF */}
          {/* ================================= */}

          {activePage === "staff" && can("staff.read") && (
            <MasterModuleFrame kind="staff"><StaffView /></MasterModuleFrame>
          )}

          {/* ================================= */}
          {/* CUSTOMERS */}
          {/* ================================= */}

          {activePage === "customers" && can("customers.read") && (
            <MasterModuleFrame kind="customers"><CustomersView /></MasterModuleFrame>
          )}

          {/* ================================= */}
          {/* SUPPLIERS */}
          {/* ================================= */}

          {activePage === "suppliers" && can("suppliers.read") && (
            <MasterModuleFrame kind="suppliers"><SuppliersView /></MasterModuleFrame>
          )}

          {/* ================================= */}
          {/* OPERATIONAL MODULES */}
          {/* ================================= */}

          {(["purchases", "sales", "adjustments", "transfers", "expenses", "payments", "stock-report"] as Page[]).includes(activePage) && (
            <OperationsView kind={activePage as "purchases" | "sales" | "adjustments" | "transfers" | "expenses" | "payments" | "stock-report"} />
          )}

          {activePage === "purchase-returns" && can("purchase-returns.read") && (
            <ReturnsView type="PURCHASE" />
          )}
          {activePage === "sales-returns" && can("sales-returns.read") && (
            <ReturnsView type="SALE" />
          )}
          {activePage === "fulfillment" && can("fulfillment.read") && (
            <FulfillmentView />
          )}

          {activePage === "audit" && can("audit.read") && <AuditLogsView />}

          {activePage === "stock-opnames" && can("stock-opnames.read") && <StockOpnamesView />}

          {/* ================================= */}
          {/* DASHBOARD */}
          {/* ================================= */}

          {activePage === "dashboard" && (
            <DashboardView
              products={products}
              categories={categories}
              brands={brands}
              units={units}
              summary={dashboardSummary}
              loading={loading}
              masterLoading={masterLoading}
              onNavigate={navigate}
            />
          )}

          {false && activePage === "dashboard" && (
            <>
              {/* DASHBOARD TITLE */}
              <div>
                <h2 className="text-xl font-bold text-[#182237]">
                  Dashboard Overview
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Welcome to your inventory workspace.
                </p>
              </div>

              {/* STATISTIC CARDS */}
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
                {dashboardStats.map(
                  (stat) => {
                    const Icon = stat.icon;

                    return (
                      <div
                        key={stat.title}
                        className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm"
                      >
                        <div className="flex items-center justify-between">
                          <div
                            className={`flex h-12 w-12 items-center justify-center rounded-xl ${stat.iconBackground} ${stat.iconColor}`}
                          >
                            <Icon size={23} />
                          </div>

                          <p className="mt-5 text-sm font-medium text-slate-500">
                            {stat.title}
                          </p>

                          <h3 className="mt-1 text-3xl font-bold text-slate-900">
                            {stat.value}
                          </h3>

                          <p className="mt-2 text-xs text-slate-400">
                            {stat.subtitle}
                          </p>
                        </div>
                      </div>
                    );
                  }
                )}
              </div>

              {/* LOWER CONTENT */}
              <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
                {/* RECENT PRODUCTS */}
                <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-100 p-6">
                    <div>
                      <h3 className="font-bold text-slate-800">
                        Recent Products
                      </h3>

                      <p className="mt-1 text-xs text-slate-400">
                        Latest product records
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        navigate("products")
                      }
                      className="flex items-center gap-2 text-xs font-semibold text-blue-600 hover:text-blue-800"
                    >
                      View All
                      <ArrowRight size={15} />
                    </button>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {products
                      .slice(0, 5)
                      .map((product) => (
                        <div
                          key={product.id}
                          className="flex items-center gap-4 px-6 py-4"
                        >
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                            <Package size={20} />
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">
                              {product.name}
                            </p>

                            <p className="mt-1 text-xs text-slate-400">
                              {product.sku}
                            </p>
                          </div>

                          <span className="hidden text-xs text-slate-400 sm:inline">
                            {formatDate(product.createdAt)}
                          </span>
                        </div>
                      ))}

                    {!loading &&
                      products.length === 0 && (
                        <div className="py-12 text-center text-sm text-slate-400">
                          No products available.
                        </div>
                      )}

                    {loading && (
                      <div className="py-12 text-center text-sm text-slate-400">
                        Loading products...
                      </div>
                    )}
                  </div>
                </div>

                {/* QUICK ACTIONS */}
                <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
                  <h3 className="font-bold text-slate-800">
                    Quick Actions
                  </h3>

                  <p className="mt-1 text-xs text-slate-400">
                    Available operations
                  </p>

                  <div className="mt-6 space-y-3">
                    {/* ADD PRODUCT */}
                    <button
                      type="button"
                      onClick={openAddModal}
                      className="flex w-full items-center gap-3 rounded-xl bg-[#edf3ff] p-4 text-left text-sm font-semibold text-[#2e66e9] hover:bg-blue-100"
                    >
                      <Plus size={19} />
                      Add New Product
                    </button>

                    {/* PRODUCT CATALOG */}
                    <button
                      type="button"
                      onClick={() =>
                        navigate("products")
                      }
                      className="flex w-full items-center gap-3 rounded-xl bg-slate-50 p-4 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      <Package size={19} />
                      View Product Catalog
                    </button>

                    {/* REFRESH PRODUCT */}
                    <button
                      type="button"
                      onClick={() =>
                        void fetchProducts()
                      }
                      disabled={loading}
                      className="flex w-full items-center gap-3 rounded-xl bg-slate-50 p-4 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      <RefreshCw size={19} />
                      Refresh Data
                    </button>
                  </div>

                  {/* NEXT DEVELOPMENT */}
                  <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50 p-4">
                    <p className="text-xs font-semibold text-blue-700">
                      Next Development
                    </p>

                    <p className="mt-2 text-xs leading-6 text-slate-600">
                      Inventory Balance, Stock Movements,
                      and Purchase Transactions.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
