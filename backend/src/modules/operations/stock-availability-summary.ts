import { prisma } from "../../lib/prisma.ts";

/** Categorize detail balances without double-counting: expiry first, then quarantine. */
export async function stockAvailabilitySummary(pairs: { productId: string; warehouseId: string }[]) {
  const result = new Map<string, { available: number; expired: number; quarantine: number; other: number; detailCount: number }>();
  if (!pairs.length) return result;
  const products = [...new Set(pairs.map((row) => row.productId))];
  const warehouses = [...new Set(pairs.map((row) => row.warehouseId))];
  const details = await prisma.inventoryLocationBalance.findMany({ where: { productId: { in: products }, warehouseId: { in: warehouses } }, select: { productId: true, warehouseId: true, quantityOnHand: true, reservedQuantity: true, location: { select: { locationType: true, isActive: true } }, batch: { select: { status: true, expiryDate: true } }, product: { select: { trackBatch: true } } } });
  const now = new Date();
  for (const row of details) {
    const key = `${row.productId}:${row.warehouseId}`;
    const summary = result.get(key) ?? { available: 0, expired: 0, quarantine: 0, other: 0, detailCount: 0 };
    summary.detailCount++;
    if (row.batch && (row.batch.status === "EXPIRED" || (row.batch.expiryDate && row.batch.expiryDate <= now))) summary.expired += row.quantityOnHand;
    else if (row.location.locationType === "QUARANTINE" || row.batch?.status === "QUARANTINED") summary.quarantine += row.quantityOnHand;
    else if (row.location.isActive && row.location.locationType === "STORAGE" && (!row.product.trackBatch ? !row.batch : row.batch?.status === "ACTIVE")) summary.available += Math.max(0, row.quantityOnHand - row.reservedQuantity);
    else summary.other += row.quantityOnHand;
    result.set(key, summary);
  }
  return result;
}
