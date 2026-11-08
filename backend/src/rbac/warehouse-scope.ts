import { AppError } from "../utils/AppError.ts";
import type { AuthContext } from "../middlewares/auth.middleware.ts";

/**
 * Warehouse scope is deliberately centralized so every inventory query uses
 * the same rule. Staff members are restricted to their assigned warehouse;
 * supervisory, procurement and audit roles can work across warehouses.
 */
export function warehouseScope(auth: AuthContext): string[] | undefined {
  // These built-in roles are explicitly allowed to work across warehouses.
  // Any staff-linked custom role inherits the warehouse boundary of its staff
  // assignment, even if its custom role code is different.
  const crossWarehouseRoles = new Set([
    "ADMIN",
    "WAREHOUSE_MANAGER",
    "PROCUREMENT",
    "AUDITOR",
  ]);
  if (crossWarehouseRoles.has(auth.roleCode)) return undefined;
  if (auth.roleCode !== "WAREHOUSE_STAFF" && !auth.staffId) return undefined;
  if (!auth.warehouseId) {
    throw new AppError(403, "This staff account is not assigned to a warehouse");
  }
  return [auth.warehouseId];
}

export function assertWarehouseAccess(auth: AuthContext, warehouseId: string) {
  const allowed = warehouseScope(auth);
  if (allowed && !allowed.includes(warehouseId)) {
    throw new AppError(403, "You cannot access another warehouse");
  }
}

export function scopedWarehouseFilter(auth: AuthContext, requestedWarehouseId?: string) {
  const allowed = warehouseScope(auth);
  if (allowed) {
    if (requestedWarehouseId && requestedWarehouseId !== allowed[0]) {
      throw new AppError(403, "You cannot access another warehouse");
    }
    return { warehouseId: allowed[0] };
  }
  return requestedWarehouseId ? { warehouseId: requestedWarehouseId } : {};
}

