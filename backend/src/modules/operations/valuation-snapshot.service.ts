import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "../../lib/prisma.ts";

function jakartaNowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function jakartaSnapshotDate(date = new Date()) {
  const parts = jakartaNowParts(date);
  return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`);
}

/** Capture once a day at/after 23:55 Asia/Jakarta. No synthetic backfill. */
export async function captureDailyInventoryValuationSnapshot(now = new Date()) {
  const parts = jakartaNowParts(now);
  if (Number(parts.hour) * 60 + Number(parts.minute) < 23 * 60 + 55) return { captured: false, reason: "not_due" };
  const snapshotDate = jakartaSnapshotDate(now);
  const count = await prisma.$transaction(async (tx) => {
    const balances = await tx.inventoryBalance.findMany({ select: { productId: true, warehouseId: true, quantityOnHand: true, averageUnitCost: true } });
    if (!balances.length) return 0;
    const rows = balances.map((balance) => ({
      id: randomUUID(), snapshotDate, productId: balance.productId, warehouseId: balance.warehouseId,
      quantityOnHand: balance.quantityOnHand, averageUnitCost: balance.averageUnitCost,
      knownValue: balance.averageUnitCost === null ? null : balance.averageUnitCost.mul(balance.quantityOnHand).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    }));
    const result = await tx.inventoryValuationSnapshot.createMany({ data: rows, skipDuplicates: true });
    return result.count;
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
  return { captured: count > 0, rows: count, snapshotDate };
}
