import { Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "../../lib/prisma.ts";
import { AppError } from "../../utils/AppError.ts";
import type { AuthContext } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess } from "../../rbac/warehouse-scope.ts";
import { assertUsableBatch } from "./batch-safety.ts";
import { postStockIn, postStockOut } from "./stock-allocation.service.ts";

/** Validates product references inside the same transaction as a document write. */
export async function ensureProducts(tx: Prisma.TransactionClient, ids: string[]) {
  const products = await tx.product.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  if (products.length !== new Set(ids).size) throw new AppError(400, "One or more selected products are invalid or inactive");
}

export async function ensureWarehouse(tx: Prisma.TransactionClient, id: string) {
  const warehouse = await tx.warehouse.findUnique({ where: { id } });
  if (!warehouse || !warehouse.isActive) throw new AppError(400, "Warehouse is invalid or inactive");
}

export async function ensureScopedWarehouse(tx: Prisma.TransactionClient, id: string, auth: AuthContext) {
  assertWarehouseAccess(auth, id);
  await ensureWarehouse(tx, id);
}

export async function validateRevisionLocations(tx: Prisma.TransactionClient | typeof prisma, warehouseId: string, productId: string, locationId?: string | null, batchId?: string | null) {
  if (locationId && !await tx.warehouseLocation.findFirst({ where: { id: locationId, warehouseId, isActive: true } })) throw new AppError(400, "Location is invalid or inactive for this warehouse");
  if (batchId) {
    const batch = await tx.productBatch.findFirst({ where: { id: batchId, warehouseId, productId } });
    if (!batch) throw new AppError(400, "Batch does not belong to the selected product and warehouse");
    if (!(await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { trackBatch: true } })).trackBatch) throw new AppError(400, "Non-batch product cannot use a batch");
    assertUsableBatch(batch, {});
  }
}

export async function ensureLocation(tx: Prisma.TransactionClient, warehouseId: string, requestedLocationId?: string | null) {
  if (requestedLocationId) {
    const location = await tx.warehouseLocation.findFirst({ where: { id: requestedLocationId, warehouseId, isActive: true } });
    if (!location) throw new AppError(400, "Location is invalid or inactive for this warehouse");
    return location;
  }
  const location = await tx.warehouseLocation.findFirst({ where: { warehouseId, isActive: true, locationType: "STORAGE" }, orderBy: { code: "asc" } });
  if (location) return location;
  return tx.warehouseLocation.create({ data: { warehouseId, code: "UNASSIGNED", name: "Unassigned / Legacy Stock", isActive: true } });
}

export async function ensureReceiptBatch(tx: Prisma.TransactionClient, input: { productId: string; warehouseId: string; batchNumber?: string | null; productionDate?: Date | null; expiryDate?: Date | null; locationId: string }, trackBatch: boolean, quarantineOnly = false) {
  if (!trackBatch && input.batchNumber) throw new AppError(400, "Non-batch product cannot use a batch number");
  if (trackBatch && !input.batchNumber) throw new AppError(400, `Batch number is required for ${input.productId}`);
  if (!input.batchNumber) return null;
  if (!quarantineOnly && input.expiryDate && input.expiryDate <= new Date()) throw new AppError(400, "Expired goods cannot be received into available stock");
  const batch = await tx.productBatch.upsert({
    where: { productId_warehouseId_batchNumber: { productId: input.productId, warehouseId: input.warehouseId, batchNumber: input.batchNumber } },
    create: { productId: input.productId, warehouseId: input.warehouseId, locationId: input.locationId, batchNumber: input.batchNumber, productionDate: input.productionDate ?? null, expiryDate: input.expiryDate ?? null, quantityOnHand: 0, reservedQuantity: 0, status: "ACTIVE" },
    update: {},
  });
  if (!quarantineOnly) assertUsableBatch(batch, input);
  else for (const field of ["productionDate", "expiryDate"] as const) if (input[field] && batch[field]?.getTime() !== input[field]!.getTime()) throw new AppError(409, `Existing batch ${field} cannot be overwritten`);
  return batch;
}

export async function moveStock(tx: Prisma.TransactionClient, item: { productId: string; quantity: number; sourceLocationId?: string | null; destinationLocationId?: string | null; batchId?: string | null }, fromWarehouseId: string, toWarehouseId: string) {
  const sourceAllocations = await postStockOut(tx, item.productId, fromWarehouseId, item.quantity, { locationId: item.sourceLocationId, batchId: item.batchId });
  const destinationAllocations = [] as Awaited<ReturnType<typeof postStockIn>>[];
  const destinationLocation = await ensureLocation(tx, toWarehouseId, item.destinationLocationId);
  for (const source of sourceAllocations) {
    let destinationBatchId: string | null = null;
    if (source.batchId) {
      const sourceBatch = await tx.productBatch.findUnique({ where: { id: source.batchId } });
      if (!sourceBatch) throw new AppError(409, "Source batch was not found during transfer");
      assertUsableBatch(sourceBatch, {});
      const destinationBatch = await tx.productBatch.upsert({
        where: { productId_warehouseId_batchNumber: { productId: item.productId, warehouseId: toWarehouseId, batchNumber: sourceBatch.batchNumber } },
        create: { productId: item.productId, warehouseId: toWarehouseId, locationId: destinationLocation.id, batchNumber: sourceBatch.batchNumber, productionDate: sourceBatch.productionDate, expiryDate: sourceBatch.expiryDate, quantityOnHand: 0, reservedQuantity: 0, status: "ACTIVE" },
        update: {},
      });
      assertUsableBatch(destinationBatch, sourceBatch);
      destinationBatchId = destinationBatch.id;
    }
    destinationAllocations.push(await postStockIn(tx, { productId: item.productId, warehouseId: toWarehouseId, locationId: destinationLocation.id, batchId: destinationBatchId, quantity: source.quantity, unitCost: source.unitCost ?? null }));
  }
  return { sourceAllocations, destinationAllocations };
}
