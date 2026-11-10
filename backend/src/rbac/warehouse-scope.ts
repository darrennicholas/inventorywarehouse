import { AppError } from "../utils/AppError.ts";
import type { AuthContext } from "../middlewares/auth.middleware.ts";

/**
 * Warehouse scope is deliberately centralized so every inventory query uses
 * the same rule. Assigned staff are scoped to their warehouse. Cross-warehouse
 * access requires an explicit permission; unknown/custom roles fail closed.
 */
export function warehouseScope(auth: AuthContext): string[] | undefined {
  if (auth.permissions.includes("warehouses.access_all")) return undefined;
  // Any staff-linked role inherits the physical warehouse boundary of its
  // staff assignment, regardless of the role's code or whether it is custom.
  if (!auth.staffId) {
    throw new AppError(403, "This account needs a warehouse assignment or cross-warehouse permission");
  }
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

