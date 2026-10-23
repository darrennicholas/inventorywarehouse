import { randomUUID } from "node:crypto";

import { Prisma } from "../../generated/prisma/client.ts";
import { AppError } from "../../utils/AppError.ts";

export type InventoryTx = Prisma.TransactionClient;
export type StockAllocation = {
  locationBalanceId: string;
  locationId: string;
  batchId: string | null;
  quantity: number;
};

type StockLocationInput = {
  productId: string;
  warehouseId: string;
  locationId?: string | null;
  batchId?: string | null;
};

async function resolveLocation(tx: InventoryTx, warehouseId: string, locationId?: string | null) {
  if (locationId) {
    const location = await tx.warehouseLocation.findFirst({ where: { id: locationId, warehouseId, isActive: true } });
    if (!location) throw new AppError(400, "Location is invalid or inactive for this warehouse");
    return location;
  }
  const first = await tx.warehouseLocation.findFirst({ where: { warehouseId, isActive: true, locationType: "STORAGE" }, orderBy: { code: "asc" } });
  if (first) return first;
  return tx.warehouseLocation.create({ data: { warehouseId, code: "UNASSIGNED", name: "Unassigned / Legacy Stock", isActive: true } });
}

export async function ensureLocationBalance(tx: InventoryTx, input: StockLocationInput) {
  const location = await resolveLocation(tx, input.warehouseId, input.locationId);
  const where = { productId: input.productId, warehouseId: input.warehouseId, locationId: location.id, batchId: input.batchId ?? null };
  const existing = await tx.inventoryLocationBalance.findFirst({ where });
  if (existing) return existing;
  try {
    return await tx.inventoryLocationBalance.create({ data: { ...where, id: randomUUID() } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const retry = await tx.inventoryLocationBalance.findFirst({ where });
    if (!retry) throw error;
    return retry;
  }
}

async function updateWarehouseBalance(tx: InventoryTx, productId: string, warehouseId: string, delta: number, locationId: string) {
  if (delta > 0) {
    return tx.inventoryBalance.upsert({
      where: { productId_warehouseId: { productId, warehouseId } },
      create: { productId, warehouseId, quantityOnHand: delta, reservedQuantity: 0, locationId },
      update: { quantityOnHand: { increment: delta }, locationId },
    });
  }
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "InventoryBalance"
    SET "quantityOnHand" = "quantityOnHand" + ${delta}, "updatedAt" = NOW(), "locationId" = ${locationId}::uuid
    WHERE "productId" = ${productId}::uuid
      AND "warehouseId" = ${warehouseId}::uuid
      AND "quantityOnHand" + ${delta} >= 0
      AND "quantityOnHand" + ${delta} >= "reservedQuantity"
    RETURNING "id"
  `);
  if (rows.length !== 1) throw new AppError(409, `Insufficient stock for ${productId}`);
  return rows[0];
}

async function assertBatchScope(tx: InventoryTx, productId: string, warehouseId: string, batchId: string | null) {
  if (!batchId) return null;
  const batch = await tx.productBatch.findFirst({ where: { id: batchId, productId, warehouseId } });
  if (!batch) throw new AppError(400, "Batch does not belong to the selected product and warehouse");
  return batch;
}

export async function postStockIn(tx: InventoryTx, input: StockLocationInput & { quantity: number; reactivateBatch?: boolean }) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) throw new AppError(400, "Stock quantity must be a positive integer");
  const product = await tx.product.findUnique({ where: { id: input.productId }, select: { trackBatch: true } });
  if (!product) throw new AppError(404, "Product not found");
  if (product.trackBatch && !input.batchId) throw new AppError(400, "Batch is required for a batch-tracked product");
  if (!product.trackBatch && input.batchId) throw new AppError(400, "Non-batch product cannot use a batch");
  const batch = await assertBatchScope(tx, input.productId, input.warehouseId, input.batchId ?? null);
  const balance = await ensureLocationBalance(tx, input);
  const detail = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "InventoryLocationBalance"
    SET "quantityOnHand" = "quantityOnHand" + ${input.quantity}, "updatedAt" = NOW()
    WHERE "id" = ${balance.id}::uuid
    RETURNING "id"
  `);
  if (detail.length !== 1) throw new AppError(409, "Unable to update location stock");
  await updateWarehouseBalance(tx, input.productId, input.warehouseId, input.quantity, balance.locationId);
  if (batch) await tx.productBatch.update({ where: { id: batch.id }, data: { quantityOnHand: { increment: input.quantity }, ...(input.reactivateBatch === false ? {} : { status: "ACTIVE" as const }) } });
  return { locationBalanceId: balance.id, locationId: balance.locationId, batchId: balance.batchId, quantity: input.quantity } satisfies StockAllocation;
}

export async function allocateAvailableStock(
  tx: InventoryTx,
  productId: string,
  warehouseId: string,
  quantity: number,
  filters: { locationId?: string | null; batchId?: string | null } = {},
): Promise<StockAllocation[]> {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new AppError(400, "Quantity must be a positive integer");
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "InventoryBalance" WHERE "productId" = ${productId}::uuid AND "warehouseId" = ${warehouseId}::uuid FOR UPDATE`);
  const product = await tx.product.findUnique({ where: { id: productId }, select: { trackBatch: true } });
  if (!product) throw new AppError(404, "Product not found");
  if (product.trackBatch && filters.batchId === null) throw new AppError(400, "Batch is required for a batch-tracked product");
  const rows = await tx.inventoryLocationBalance.findMany({
    where: {
      productId,
      warehouseId,
      ...(filters.locationId ? { locationId: filters.locationId } : {}),
      ...(filters.batchId ? { batchId: filters.batchId } : product.trackBatch ? { batchId: { not: null } } : { batchId: null }),
      quantityOnHand: { gt: 0 },
      ...(product.trackBatch ? { batch: { status: "ACTIVE", OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }] } } : {}),
    },
    include: { location: { select: { isActive: true, locationType: true } }, batch: { select: { expiryDate: true, createdAt: true, status: true } } },
  });
  rows.sort((left, right) => {
    const leftExpiry = left.batch?.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightExpiry = right.batch?.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return leftExpiry - rightExpiry || (left.batch?.createdAt.getTime() ?? 0) - (right.batch?.createdAt.getTime() ?? 0) || left.id.localeCompare(right.id);
  });
  const output: StockAllocation[] = [];
  let remaining = quantity;
  for (const row of rows) {
    if (!row.location.isActive || row.location.locationType !== "STORAGE") continue;
    const available = row.quantityOnHand - row.reservedQuantity;
    const take = Math.min(available, remaining);
    if (take <= 0) continue;
    output.push({ locationBalanceId: row.id, locationId: row.locationId, batchId: row.batchId, quantity: take });
    remaining -= take;
    if (remaining === 0) break;
  }
  if (remaining > 0) throw new AppError(409, `Insufficient allocatable stock for ${productId}: shortage ${remaining}`);
  return output;
}

export async function postStockOut(tx: InventoryTx, productId: string, warehouseId: string, quantity: number, filters: { locationId?: string | null; batchId?: string | null } = {}) {
  const allocations = await allocateAvailableStock(tx, productId, warehouseId, quantity, filters);
  for (const allocation of allocations) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "InventoryLocationBalance"
      SET "quantityOnHand" = "quantityOnHand" - ${allocation.quantity}, "updatedAt" = NOW()
      WHERE "id" = ${allocation.locationBalanceId}::uuid
        AND "quantityOnHand" - "reservedQuantity" >= ${allocation.quantity}
      RETURNING "id"
    `);
    if (rows.length !== 1) throw new AppError(409, "Location stock changed during the transaction");
    if (allocation.batchId) {
      const batchRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE "ProductBatch"
        SET "quantityOnHand" = "quantityOnHand" - ${allocation.quantity},
            "status" = CASE WHEN "quantityOnHand" - ${allocation.quantity} = 0 THEN 'DEPLETED'::"BatchStatus" ELSE "status" END,
            "updatedAt" = NOW()
        WHERE "id" = ${allocation.batchId}::uuid
          AND "quantityOnHand" - ${allocation.quantity} >= "reservedQuantity"
        RETURNING "id"
      `);
      if (batchRows.length !== 1) throw new AppError(409, "Batch stock changed during the transaction");
    }
    await updateWarehouseBalance(tx, productId, warehouseId, -allocation.quantity, allocation.locationId);
  }
  return allocations;
}

export async function changeLocationReservation(tx: InventoryTx, locationBalanceId: string, delta: number) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "InventoryLocationBalance"
    SET "reservedQuantity" = "reservedQuantity" + ${delta}, "updatedAt" = NOW()
    WHERE "id" = ${locationBalanceId}::uuid
      AND "reservedQuantity" + ${delta} >= 0
      AND "quantityOnHand" >= "reservedQuantity" + ${delta}
    RETURNING "id"
  `);
  if (rows.length !== 1) throw new AppError(409, "Insufficient available stock or invalid reservation release");
}

export async function consumeLocationReservation(tx: InventoryTx, locationBalanceId: string, quantity: number) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "InventoryLocationBalance"
    SET "quantityOnHand" = "quantityOnHand" - ${quantity}, "reservedQuantity" = "reservedQuantity" - ${quantity}, "updatedAt" = NOW()
    WHERE "id" = ${locationBalanceId}::uuid AND "quantityOnHand" >= ${quantity} AND "reservedQuantity" >= ${quantity}
    RETURNING "id"
  `);
  if (rows.length !== 1) throw new AppError(409, "Reserved location stock is no longer available");
}

export async function linkMovementAllocations(tx: InventoryTx, movementId: string, allocations: StockAllocation[], sign: 1 | -1) {
  if (!allocations.length) return;
  await tx.stockMovementAllocation.createMany({ data: allocations.map((allocation) => ({ stockMovementId: movementId, inventoryLocationBalanceId: allocation.locationBalanceId, quantity: allocation.quantity * sign })) });
}

/** Purchase return leaves the warehouse from a specific STORAGE location and optional batch. */
export async function postPurchaseReturnStock(tx: InventoryTx, input: StockLocationInput & { quantity: number; locationId: string }) {
  const location = await tx.warehouseLocation.findFirst({ where: { id: input.locationId, warehouseId: input.warehouseId, isActive: true, locationType: "STORAGE" } });
  if (!location) throw new AppError(400, "Purchase return requires an active STORAGE location");
  return postStockOut(tx, input.productId, input.warehouseId, input.quantity, { locationId: input.locationId, batchId: input.batchId ?? null });
}

/** Sales return is physically received at the stated location; SCRAP has no stock entry. */
export async function postSalesReturnStock(tx: InventoryTx, input: StockLocationInput & { quantity: number; locationId: string; disposition: "RESTOCK" | "QUARANTINE" | "SCRAP" }) {
  const expectedType = input.disposition === "RESTOCK" ? "STORAGE" : input.disposition === "QUARANTINE" ? "QUARANTINE" : "DAMAGED";
  const location = await tx.warehouseLocation.findFirst({ where: { id: input.locationId, warehouseId: input.warehouseId, isActive: true, locationType: expectedType } });
  if (!location) throw new AppError(400, `Sales return ${input.disposition} requires active ${expectedType} location`);
  if (input.disposition === "SCRAP") return [] as StockAllocation[];
  const batch = input.batchId ? await tx.productBatch.findUnique({ where: { id: input.batchId }, select: { status: true, expiryDate: true } }) : null;
  // A restored batch must not bypass FEFO expiry/quarantine rules.
  if (input.disposition === "RESTOCK" && batch && (batch.status === "EXPIRED" || batch.status === "QUARANTINED" || (batch.expiryDate && batch.expiryDate <= new Date()))) {
    throw new AppError(409, "Expired or quarantined batch cannot be RESTOCKED for sale");
  }
  const posted = await postStockIn(tx, { productId: input.productId, warehouseId: input.warehouseId, locationId: input.locationId, batchId: input.batchId ?? null, quantity: input.quantity, reactivateBatch: input.disposition === "RESTOCK" });
  return [posted];
}
