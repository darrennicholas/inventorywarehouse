/** StockFlow RBAC — permission registry and default system-role presets. */
export const PERMISSION_KEYS = [
  "dashboard.read",
  "categories.read", "categories.write", "categories.delete",
  "brands.read", "brands.write", "brands.delete",
  "units.read", "units.write", "units.delete",
  "products.read", "products.write", "products.delete",
  "warehouses.read", "warehouses.write", "warehouses.delete",
  "staff.read", "staff.write", "staff.delete",
  "customers.read", "customers.write", "customers.delete",
  "suppliers.read", "suppliers.write", "suppliers.delete",
  "inventory.read", "inventory.write",
  "inventory.relocate",
  "purchases.read", "purchases.write", "purchases.delete", "purchases.approve",
  "sales.read", "sales.write", "sales.delete",
  "purchase-returns.read", "purchase-returns.write", "purchase-returns.approve", "purchase-returns.delete",
  "sales-returns.read", "sales-returns.write", "sales-returns.approve", "sales-returns.delete",
  "fulfillment.read", "fulfillment.write", "fulfillment.pick", "fulfillment.pack", "fulfillment.ship",
  "adjustments.read", "adjustments.write", "adjustments.delete", "adjustments.approve",
  "transfers.read", "transfers.write", "transfers.delete", "transfers.approve",
  "expenses.read", "expenses.write", "expenses.delete",
  "payments.read", "payments.write", "payments.delete",
  "reports.read", "audit.read",
  "stock-opnames.read", "stock-opnames.write", "stock-opnames.approve",
  "users.manage", "roles.manage",
  "approval-policies.manage",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export const ROLE_CODES = ["ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE_STAFF", "PROCUREMENT", "AUDITOR"] as const;
export type RoleCode = (typeof ROLE_CODES)[number];
export const ROLE_NAMES: Record<RoleCode, string> = {
  ADMIN: "Administrator",
  WAREHOUSE_MANAGER: "Warehouse Manager",
  WAREHOUSE_STAFF: "Warehouse Staff",
  PROCUREMENT: "Procurement",
  AUDITOR: "Auditor",
};
export const ROLE_PRESETS: Record<RoleCode, readonly PermissionKey[]> = {
  ADMIN: [...PERMISSION_KEYS],
  WAREHOUSE_MANAGER: [
    "dashboard.read", "categories.read", "brands.read", "units.read", "products.read",
    "warehouses.read", "warehouses.write", "warehouses.delete", "staff.read",
    "inventory.read", "inventory.write", "inventory.relocate", "purchases.read", "sales.read", "purchases.approve",
    "purchase-returns.read", "purchase-returns.write", "purchase-returns.approve", "purchase-returns.delete",
    "sales-returns.read", "sales-returns.write", "sales-returns.approve", "sales-returns.delete",
    "fulfillment.read", "fulfillment.write", "fulfillment.pick", "fulfillment.pack", "fulfillment.ship",
    "adjustments.read", "adjustments.write", "adjustments.delete", "adjustments.approve",
    "transfers.read", "transfers.write", "transfers.delete", "transfers.approve",
    "expenses.read", "payments.read", "reports.read", "audit.read",
    "stock-opnames.read", "stock-opnames.write", "stock-opnames.approve",
  ],
  WAREHOUSE_STAFF: [
    "categories.read", "brands.read", "units.read", "products.read", "warehouses.read",
    "inventory.read", "inventory.write", "inventory.relocate", "purchases.read", "sales.read",
    "purchase-returns.read", "purchase-returns.write", "sales-returns.read", "sales-returns.write",
    "fulfillment.read", "fulfillment.pick", "fulfillment.pack", "fulfillment.ship",
    "transfers.read", "transfers.write", "stock-opnames.read", "stock-opnames.write",
  ],
  PROCUREMENT: [
    "dashboard.read", "products.read", "suppliers.read", "suppliers.write", "suppliers.delete",
    "warehouses.read", "inventory.read", "purchases.read", "purchases.write", "purchases.delete", "purchases.approve",
    "purchase-returns.read", "purchase-returns.write", "purchase-returns.approve", "purchase-returns.delete",
    "fulfillment.read",
    "expenses.read", "payments.read", "reports.read", "stock-opnames.read", "stock-opnames.write",
  ],
  AUDITOR: [
    "dashboard.read", "categories.read", "brands.read", "units.read", "products.read",
    "warehouses.read", "staff.read", "customers.read", "suppliers.read", "inventory.read",
    "purchases.read", "sales.read", "purchase-returns.read", "sales-returns.read",
    "fulfillment.read",
    "adjustments.read", "transfers.read", "expenses.read", "payments.read", "reports.read", "audit.read", "stock-opnames.read",
  ],
};
