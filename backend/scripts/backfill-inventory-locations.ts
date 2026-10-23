/**
 * StockFlow Stage 2 - controlled backfill of detailed inventory balances.
 * Run from backend/: npx tsx scripts/backfill-inventory-locations.ts
 * Read-only by default. To apply in maintenance mode, use:
 *   $env:STOCKFLOW_BACKFILL_APPLY="YES_I_HAVE_A_BACKUP"
 *   npx tsx scripts/backfill-inventory-locations.ts
 * No seeded quantities are invented and no warehouse/batch totals are modified.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { AppError } from "../src/utils/AppError.ts";
import { allocateAvailableStock } from "../src/modules/operations/stock-allocation.service.ts";
import type { Prisma } from "../src/generated/prisma/client.ts";

type Tx = Prisma.TransactionClient;
const APPLY = process.env.STOCKFLOW_BACKFILL_APPLY === "YES_I_HAVE_A_BACKUP";
const LOCATION_CODE = "UNASSIGNED";

async function run(tx: Tx) {
  // Transaction-wide advisory lock prevents running two backfill scripts at once.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261017, 2222)`;
  const balances = await tx.inventoryBalance.findMany({ include: { product: { select: { trackBatch: true } } }, orderBy: [{ warehouseId: "asc" }, { productId: "asc" }] });
  const issues: string[] = [];
  const plans: Array<{ productId: string; warehouseId: string; rows: number; onHand: number; reserved: number }> = [];
  // Build a complete plan BEFORE any writes.
  for (const b of balances) {
    const existing = await tx.inventoryLocationBalance.count({ where: { productId: b.productId, warehouseId: b.warehouseId } });
    if (existing > 0) {
      // Never overwrite partially populated detail balances.
      issues.push(`Detail rows already exist for ${b.productId}/${b.warehouseId}; use invariant report, not automatic overwrite`);
      continue;
    }
    const batches = await tx.productBatch.findMany({ where: { productId: b.productId, warehouseId: b.warehouseId } });
    const active = await tx.stockReservation.findMany({ where: { productId: b.productId, warehouseId: b.warehouseId, status: "ACTIVE" } });
    const reservationTotal = active.reduce((sum, row) => sum + row.quantity, 0);
    if (reservationTotal !== b.reservedQuantity) issues.push(`Reservation discrepancy ${b.productId}/${b.warehouseId}: ${reservationTotal} != ${b.reservedQuantity}`);
    if (b.quantityOnHand < b.reservedQuantity || b.reservedQuantity < 0) issues.push(`Invalid warehouse stock ${b.productId}/${b.warehouseId}`);
    if (b.product.trackBatch) {
      const batchOnHand = batches.reduce((sum, row) => sum + row.quantityOnHand, 0);
      const batchReserved = batches.reduce((sum, row) => sum + row.reservedQuantity, 0);
      if (batchOnHand !== b.quantityOnHand || batchReserved !== b.reservedQuantity) issues.push(`Batch totals inconsistent for ${b.productId}/${b.warehouseId}: ${batchOnHand}/${batchReserved} vs ${b.quantityOnHand}/${b.reservedQuantity}`);
      if (active.some(r => !r.batchId || !batches.some(batch => batch.id === r.batchId))) issues.push(`Missing batch on active reservation ${b.productId}/${b.warehouseId}`);
      for (const batch of batches) {
        const reserved = active.filter(r => r.batchId === batch.id).reduce((n, r) => n + r.quantity, 0);
        if (reserved !== batch.reservedQuantity) issues.push(`Reservation mismatch for batch ${batch.id}`);
        if (batch.locationId) {
          const loc = await tx.warehouseLocation.findUnique({ where: { id: batch.locationId } });
          if (!loc || loc.warehouseId !== b.warehouseId) issues.push(`Batch ${batch.id} location belongs to another warehouse`);
        }
      }
    } else {
      if (batches.some(x => x.quantityOnHand !== 0 || x.reservedQuantity !== 0)) issues.push(`Untracked product has nonempty ProductBatch ${b.productId}/${b.warehouseId}`);
      if (active.some(r => r.batchId)) issues.push(`Untracked product has batch reservations ${b.productId}/${b.warehouseId}`);
    }
    plans.push({ productId: b.productId, warehouseId: b.warehouseId, rows: b.product.trackBatch ? batches.length : 1, onHand: b.quantityOnHand, reserved: b.reservedQuantity });
  }
  console.log(JSON.stringify({ mode: APPLY ? "APPLY" : "DRY_RUN", aggregates: balances.length, plans, issues }, null, 2));
  if (issues.length) throw new AppError(409, `Backfill blocked: ${issues.length} discrepancy(s)`);
  if (!APPLY) return;
  // MUST run during maintenance, with all existing stock writers stopped.
  // Caller controls a single serializable transaction.
  const warehouseIds = [...new Set(balances.map(b => b.warehouseId))].sort();
  const fallback = new Map<string, string>();
  for (const warehouseId of warehouseIds) {
    const loc = await tx.warehouseLocation.upsert({
      where: { warehouseId_code: { warehouseId, code: LOCATION_CODE } },
      update: {},
      create: { warehouseId, code: LOCATION_CODE, name: "Unassigned / Legacy Stock", isActive: true },
    });
    fallback.set(warehouseId, loc.id);
  }
  for (const b of balances) {
    const fallbackId = fallback.get(b.warehouseId)!;
    const batches = b.product.trackBatch ? await tx.productBatch.findMany({ where: { productId: b.productId, warehouseId: b.warehouseId }, orderBy: { id: "asc" } }) : [];
    const rows = b.product.trackBatch
      ? batches.map(x => ({ batchId: x.id as string | null, locationId: x.locationId ?? fallbackId, quantityOnHand: x.quantityOnHand, reservedQuantity: x.reservedQuantity }))
      : [{ batchId: null as string | null, locationId: fallbackId, quantityOnHand: b.quantityOnHand, reservedQuantity: b.reservedQuantity }];
    // Zero-stock tracked products with no batch legitimately need no detail rows.
    for (const row of rows) {
      const record = await tx.inventoryLocationBalance.create({ data: { productId: b.productId, warehouseId: b.warehouseId, ...row } });
      // Legacy reservations are one per batch (or one untracked location).
      const active = await tx.stockReservation.findMany({ where: { productId: b.productId, warehouseId: b.warehouseId, batchId: row.batchId, status: "ACTIVE" } });
      for (const reservation of active) {
        await tx.stockReservation.update({ where: { id: reservation.id }, data: { locationBalanceId: record.id } });
      }
    }
    if (b.quantityOnHand > 0) await allocateAvailableStock(tx, b.productId, b.warehouseId, b.quantityOnHand);
  }
  console.log(`Backfill completed: ${balances.length} warehouse/product balances reconciled`);
}

async function main() {
  if (APPLY && process.env.NODE_ENV === "production") throw new Error("Production backfill requires separately reviewed operational runbook");
  // Serializable only when applying; it detects unexpected concurrent writes.
  await prisma.$transaction(tx => run(tx), { isolationLevel: "Serializable", timeout: 120000, maxWait: 15000 });
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
