import { prisma } from "../../lib/prisma.ts";
import type { Prisma } from "../../generated/prisma/client.ts";

export type StockAvailabilityPair = {
  productId: string;
  warehouseId: string;
  quantityOnHand?: number;
  reservedQuantity?: number;
};

export function conservativeAvailableQuantity(detailAvailable: number, quantityOnHand: number, reservedQuantity: number) {
  const aggregateAvailable = Math.max(0, quantityOnHand - reservedQuantity);
  return Math.min(Math.max(0, detailAvailable), aggregateAvailable);
}

/** Categorize detail balances without double-counting: expiry first, then quarantine. */
export async function stockAvailabilitySummary(pairs: StockAvailabilityPair[]) {
  const result = new Map<string, { available: number; expired: number; quarantine: number; other: number; detailCount: number; detailQuantityOnHand: number; detailReservedQuantity: number; detailMissing: boolean; detailMismatch: boolean }>();
  if (!pairs.length) return result;
  const uniquePairs = [...new Map(pairs.map((pair) => [`${pair.productId}:${pair.warehouseId}`, pair])).values()];
  const detailSelect = { productId: true, warehouseId: true, quantityOnHand: true, reservedQuantity: true, location: { select: { locationType: true, isActive: true } }, batch: { select: { status: true, expiryDate: true } }, product: { select: { trackBatch: true } } } as const;
  const details: Prisma.InventoryLocationBalanceGetPayload<{ select: typeof detailSelect }>[] = [];
  for (let offset = 0; offset < uniquePairs.length; offset += 400) {
    const chunk = uniquePairs.slice(offset, offset + 400);
    details.push(...await prisma.inventoryLocationBalance.findMany({ where: { OR: chunk.map(({ productId, warehouseId }) => ({ productId, warehouseId })) }, select: detailSelect }));
  }
  const now = new Date();
  for (const row of details) {
    const key = `${row.productId}:${row.warehouseId}`;
    const summary = result.get(key) ?? { available: 0, expired: 0, quarantine: 0, other: 0, detailCount: 0, detailQuantityOnHand: 0, detailReservedQuantity: 0, detailMissing: false, detailMismatch: false };
    summary.detailCount++;
    summary.detailQuantityOnHand += row.quantityOnHand;
    summary.detailReservedQuantity += row.reservedQuantity;
    if (row.batch && (row.batch.status === "EXPIRED" || (row.batch.expiryDate && row.batch.expiryDate <= now))) summary.expired += row.quantityOnHand;
    else if (row.location.locationType === "QUARANTINE" || row.batch?.status === "QUARANTINED") summary.quarantine += row.quantityOnHand;
    else if (row.location.isActive && row.location.locationType === "STORAGE" && (!row.product.trackBatch ? !row.batch : row.batch?.status === "ACTIVE")) summary.available += Math.max(0, row.quantityOnHand - row.reservedQuantity);
    else summary.other += row.quantityOnHand;
    result.set(key, summary);
  }
  for (const pair of uniquePairs) {
    const key = `${pair.productId}:${pair.warehouseId}`;
    const summary = result.get(key) ?? { available: 0, expired: 0, quarantine: 0, other: 0, detailCount: 0, detailQuantityOnHand: 0, detailReservedQuantity: 0, detailMissing: false, detailMismatch: false };
    if (pair.quantityOnHand !== undefined && pair.reservedQuantity !== undefined) {
      summary.detailMissing = summary.detailCount === 0 && pair.quantityOnHand > 0;
      summary.detailMismatch = summary.detailQuantityOnHand !== pair.quantityOnHand || summary.detailReservedQuantity !== pair.reservedQuantity;
      summary.available = summary.detailMissing
        ? Math.max(0, pair.quantityOnHand - pair.reservedQuantity)
        : conservativeAvailableQuantity(summary.available, pair.quantityOnHand, pair.reservedQuantity);
    }
    result.set(key, summary);
  }
  return result;
}
