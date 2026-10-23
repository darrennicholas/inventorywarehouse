import { randomUUID } from "node:crypto";
import type { StockAllocation } from "../operations/stock-allocation.service.ts";
import { postPurchaseReturnStock, postSalesReturnStock, linkMovementAllocations } from "../operations/stock-allocation.service.ts";
import { assertInventoryInvariant } from "../operations/inventory-invariant.service.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import type { ReturnTx } from "./return.repository.ts";
import { makeReturnRepository, listReturns } from "./return.repository.ts";
import {
  createPurchaseReturnSchema,
  createSalesReturnSchema,
  updateReturnSchema,
  returnListQuerySchema,
} from "./return.validation.ts";
import type {
  CreatePurchaseReturnInput,
  CreateSalesReturnInput,
  UpdateReturnInput,
  ReturnListQuery,
} from "./return.validation.ts";

/**
 * Stage 2B — return workflow, with NO physical stock posting.
 * Functions receive a Prisma transaction client. The future HTTP controller
 * MUST execute each workflow in prisma.$transaction(async tx => ...).
 * Stage 3 must implement posting + stock movements + allocations together.
 */
export class ReturnWorkflowError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "ReturnWorkflowError";
  }
}
function fail(status: number, message: string): never {
  throw new ReturnWorkflowError(status, message);
}

type CreatePurchase = CreatePurchaseReturnInput;
type CreateSale = CreateSalesReturnInput;
type ReturnSourceInput =
  | { type: "PURCHASE"; data: CreatePurchase }
  | { type: "SALE"; data: CreateSale };

/**
 * SOURCE VALIDATION: checks source document, items, warehouse, receipts/
 * consumption provenance, location classification, and total source quantity.
 * This checks POSTED historical returns; approval separately checks other
 * approved quantities under a source lock.
 */
export async function validateReturnSource(tx: ReturnTx, input: ReturnSourceInput): Promise<void> {
  const repo = makeReturnRepository(tx);
  const { type, data } = input;
  const warehouse = await tx.warehouse.findUnique({ where: { id: data.warehouseId }, select: { isActive: true } });
  if (!warehouse?.isActive) fail(400, "Warehouse not found or inactive");

  if (type === "PURCHASE") {
    const source = await repo.findPurchase(data.purchaseOrderId);
    if (!source) fail(404, "Purchase order not found");
    if (source.warehouseId !== data.warehouseId) fail(400, "Warehouse does not match purchase order");
    if (!["RECEIVED", "PARTIALLY_RECEIVED"].includes(source.status)) {
      fail(409, "Purchase order must have received goods before returning");
    }
    const quantities = new Map<string, number>();
    for (const line of data.items) {
      const sourceLine = source.items.find(item => item.id === line.purchaseOrderItemId);
      if (!sourceLine || sourceLine.productId !== line.productId) fail(400, "Return item is not part of this purchase order");
      quantities.set(sourceLine.id, (quantities.get(sourceLine.id) ?? 0) + line.quantity);
      await validateLineLocationAndBatch(tx, {
        warehouseId: data.warehouseId, productId: line.productId,
        locationId: line.locationId, batchId: line.batchId ?? null,
        disposition: line.disposition, type,
        sourceItemId: line.purchaseOrderItemId,
      });
    }
    for (const [id, amount] of quantities) {
      const sourceLine = source.items.find(item => item.id === id)!;
      const posted = await repo.postedPurchaseReturnQuantity(id);
      if (amount + posted > sourceLine.receivedQuantity) {
        fail(409, `Purchase return quantity exceeds received quantity for item ${id}`);
      }
    }
    return;
  }

  const source = await repo.findSale(data.saleId);
  if (!source) fail(404, "Sale not found");
  if (source.warehouseId !== data.warehouseId) fail(400, "Warehouse does not match sale");
  if (source.status !== "COMPLETED") fail(409, "Sale must be COMPLETED before returning");
  const quantities = new Map<string, number>();
  for (const line of data.items) {
    const sourceLine = source.items.find(item => item.id === line.saleItemId);
    if (!sourceLine || sourceLine.productId !== line.productId) fail(400, "Return item is not part of this sale");
    quantities.set(sourceLine.id, (quantities.get(sourceLine.id) ?? 0) + line.quantity);
    await validateLineLocationAndBatch(tx, {
      warehouseId: data.warehouseId, productId: line.productId,
      locationId: line.locationId, batchId: line.batchId ?? null,
      disposition: line.disposition, type,
      sourceItemId: line.saleItemId,
    });
  }
  for (const [id, amount] of quantities) {
    const sourceLine = source.items.find(item => item.id === id)!;
    const posted = await repo.postedSaleReturnQuantity(id);
    if (amount + posted > sourceLine.quantity) {
      fail(409, `Sales return quantity exceeds sold quantity for item ${id}`);
    }
  }
}

type LineCheck = {
  warehouseId: string; productId: string; locationId: string;
  batchId: string | null; disposition: "RESTOCK" | "QUARANTINE" | "SCRAP";
  type: "PURCHASE" | "SALE"; sourceItemId: string;
};
async function validateLineLocationAndBatch(tx: ReturnTx, line: LineCheck) {
  const location = await tx.warehouseLocation.findUnique({ where: { id: line.locationId } });
  if (!location?.isActive || location.warehouseId !== line.warehouseId) {
    fail(400, "Return location must be active and belong to the source warehouse");
  }
  if (line.type === "PURCHASE") {
    // Outbound to supplier: RESTOCK is the legacy enum value, not an inbound movement.
    // Stage 3 will deduct from a specified source location.
    if (line.disposition !== "RESTOCK") fail(400, "Purchase return only accepts RESTOCK disposition as outbound-to-supplier in this schema");
    if (location.locationType !== "STORAGE") fail(400, "Purchase return source location must be STORAGE");
  } else {
    const requiredLocationType = line.disposition === "RESTOCK" ? "STORAGE"
      : line.disposition === "QUARANTINE" ? "QUARANTINE" : "DAMAGED";
    if (location.locationType !== requiredLocationType) {
      fail(400, `${line.disposition} requires a ${requiredLocationType} location`);
    }
  }

  const product = await tx.product.findUnique({ where: { id: line.productId }, select: { trackBatch: true, isActive: true } });
  if (!product?.isActive) fail(400, "Product not found or inactive");
  if (product.trackBatch && !line.batchId) fail(400, "Batch is required for a batch-tracked product");
  if (!product.trackBatch && line.batchId) fail(400, "Non batch-tracked product cannot specify batch");
  if (!line.batchId) return;

  const batch = await tx.productBatch.findUnique({ where: { id: line.batchId } });
  if (!batch || batch.productId !== line.productId || batch.warehouseId !== line.warehouseId) {
    fail(400, "Batch does not match product and warehouse");
  }
  if (line.type === "PURCHASE") {
    const receipt = await tx.goodsReceiptItem.findFirst({
      where: { purchaseOrderItemId: line.sourceItemId, batchId: line.batchId, goodsReceipt: { status: "POSTED" } },
      select: { id: true },
    });
    if (!receipt) fail(409, "Cannot establish batch provenance from the purchase receipt");
  } else {
    const consumed = await tx.stockReservation.findFirst({
      where: { saleItemId: line.sourceItemId, batchId: line.batchId, status: "CONSUMED" },
      select: { id: true },
    });
    if (!consumed) fail(409, "Cannot establish batch provenance from the original sale");
  }
}

async function ensureUniqueNumber(tx: ReturnTx, number: string) {
  const existing = await makeReturnRepository(tx).findByNumber(number);
  if (existing) fail(409, "Return number already exists");
}

/** Generate an application-level unique candidate; DB unique constraint is authoritative. */
export function generateReturnNumber(type: "PURCHASE" | "SALE"): string {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${type === "PURCHASE" ? "PR" : "SR"}-${day}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createPurchaseReturn(tx: ReturnTx, raw: CreatePurchase, actorId: string) {
  const data = createPurchaseReturnSchema.parse(raw);
  await ensureUniqueNumber(tx, data.number);
  await validateReturnSource(tx, { type: "PURCHASE", data });
  return makeReturnRepository(tx).createPurchase({
    number: data.number, type: "PURCHASE", reason: data.reason, notes: data.notes,
    warehouse: { connect: { id: data.warehouseId } },
    purchaseOrder: { connect: { id: data.purchaseOrderId } },
    createdBy: { connect: { id: actorId } },
    items: { create: data.items.map(item => ({
      quantity: item.quantity, condition: item.condition, disposition: item.disposition,
      notes: item.notes, product: { connect: { id: item.productId } },
      purchaseOrderItem: { connect: { id: item.purchaseOrderItemId } },
      location: { connect: { id: item.locationId } },
      ...(item.batchId ? { batch: { connect: { id: item.batchId } } } : {}),
    })) },
  });
}

export async function createSalesReturn(tx: ReturnTx, raw: CreateSale, actorId: string) {
  const data = createSalesReturnSchema.parse(raw);
  await ensureUniqueNumber(tx, data.number);
  await validateReturnSource(tx, { type: "SALE", data });
  return makeReturnRepository(tx).createSale({
    number: data.number, type: "SALE", reason: data.reason, notes: data.notes,
    warehouse: { connect: { id: data.warehouseId } },
    sale: { connect: { id: data.saleId } },
    createdBy: { connect: { id: actorId } },
    items: { create: data.items.map(item => ({
      quantity: item.quantity, condition: item.condition, disposition: item.disposition,
      notes: item.notes, product: { connect: { id: item.productId } },
      saleItem: { connect: { id: item.saleItemId } },
      location: { connect: { id: item.locationId } },
      ...(item.batchId ? { batch: { connect: { id: item.batchId } } } : {}),
    })) },
  });
}

export async function getReturn(tx: ReturnTx, id: string) {
  const doc = await makeReturnRepository(tx).findById(id);
  if (!doc) fail(404, "Return not found");
  return doc;
}

export async function getReturns(tx: ReturnTx, type: "PURCHASE" | "SALE", raw: ReturnListQuery, warehouseIds?: string[]) {
  const query = returnListQuerySchema.parse(raw);
  return listReturns(tx, { type, ...query, warehouseIds });
}

export async function updateDraftReturn(tx: ReturnTx, id: string, raw: UpdateReturnInput) {
  const data = updateReturnSchema.parse(raw);
  const changed = await makeReturnRepository(tx).updateDraft(id, data);
  if (changed.count !== 1) fail(409, "Return not found or not editable (only DRAFT)");
  return getReturn(tx, id);
}

/** DRAFT -> PENDING; item edits are intentionally not supported in Stage 2B. */
export async function submitReturn(tx: ReturnTx, id: string) {
  const doc = await getReturn(tx, id);
  if (doc.status !== "DRAFT") fail(409, "Only DRAFT returns can be submitted");
  const changed = await makeReturnRepository(tx).transitionStatus(id, "DRAFT", "PENDING");
  if (changed.count !== 1) fail(409, "Return status changed concurrently");
  return getReturn(tx, id);
}

/** Lock both source and Return documents to serialize approvals of the same source. */
export async function approveReturn(tx: ReturnTx, id: string, approverId: string) {
  const snapshot = await getReturn(tx, id);
  const sourceId = snapshot.type === "PURCHASE" ? snapshot.purchaseOrderId : snapshot.saleId;
  if (!sourceId) fail(409, "Return source is missing");
  // Row-level lock on source document means concurrent approvals for same source serialize.
  if (snapshot.type === "PURCHASE") {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PurchaseOrder" WHERE "id"=${sourceId}::uuid FOR UPDATE`);
  } else {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Sale" WHERE "id"=${sourceId}::uuid FOR UPDATE`);
  }
  // Lock this return after source (fixed acquisition order for other transactions).
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ReturnOrder" WHERE "id"=${id}::uuid FOR UPDATE`);
  const doc = await getReturn(tx, id);
  if (doc.status !== "PENDING") fail(409, "Only PENDING returns can be approved");
  if (doc.createdById === approverId) fail(403, "Creator cannot approve their own return");

  // Revalidate item-source/batch constraints at approval (items are immutable post-create).
  if (doc.type === "PURCHASE") {
    const raw = {
      number: doc.number, warehouseId: doc.warehouseId, purchaseOrderId: doc.purchaseOrderId!,
      reason: doc.reason, notes: doc.notes,
      items: doc.items.map(i => ({ productId: i.productId, purchaseOrderItemId: i.purchaseOrderItemId!,
        locationId: i.locationId!, batchId: i.batchId, quantity: i.quantity,
        condition: i.condition, disposition: i.disposition, notes: i.notes })),
    };
    await validateReturnSource(tx, { type: "PURCHASE", data: createPurchaseReturnSchema.parse(raw) });
  } else {
    const raw = {
      number: doc.number, warehouseId: doc.warehouseId, saleId: doc.saleId!,
      reason: doc.reason, notes: doc.notes,
      items: doc.items.map(i => ({ productId: i.productId, saleItemId: i.saleItemId!,
        locationId: i.locationId!, batchId: i.batchId, quantity: i.quantity,
        condition: i.condition, disposition: i.disposition, notes: i.notes })),
    };
    await validateReturnSource(tx, { type: "SALE", data: createSalesReturnSchema.parse(raw) });
  }

  // Prevent the total approved-but-unposted PLUS posted quantity exceeding source.
  // This is a conservative reservation of return allowance, not physical stock.
  for (const line of doc.items) {
    const sourceLineId = doc.type === "PURCHASE" ? line.purchaseOrderItemId : line.saleItemId;
    if (!sourceLineId) fail(409, "Return source item missing");
    const [other, limit] = doc.type === "PURCHASE"
      ? [await tx.returnOrderItem.aggregate({ where: { purchaseOrderItemId: sourceLineId,
          returnOrder: { id: { not: id }, type: "PURCHASE", status: { in: ["APPROVED", "POSTED"] } } }, _sum: { quantity: true } }),
         await tx.purchaseOrderItem.findUnique({ where: { id: sourceLineId }, select: { receivedQuantity: true } })]
      : [await tx.returnOrderItem.aggregate({ where: { saleItemId: sourceLineId,
          returnOrder: { id: { not: id }, type: "SALE", status: { in: ["APPROVED", "POSTED"] } } }, _sum: { quantity: true } }),
         await tx.saleItem.findUnique({ where: { id: sourceLineId }, select: { quantity: true } })];
    const allowed = limit && ("receivedQuantity" in limit ? limit.receivedQuantity : limit.quantity);
    const ownTotal = doc.items.filter(i => (doc.type === "PURCHASE" ? i.purchaseOrderItemId : i.saleItemId) === sourceLineId)
      .reduce((sum, item) => sum + item.quantity, 0);
    if (allowed == null || ownTotal + (other._sum.quantity ?? 0) > allowed) {
      fail(409, `Not enough returnable quantity for source item ${sourceLineId}`);
    }
  }
  const changed = await makeReturnRepository(tx).transitionStatus(id, "PENDING", "APPROVED", {
    approvedById: approverId, approvedAt: new Date(),
  });
  if (changed.count !== 1) fail(409, "Return status changed concurrently");
  return getReturn(tx, id);
}

export async function cancelReturn(tx: ReturnTx, id: string) {
  const changed = await makeReturnRepository(tx).cancelUnposted(id);
  if (changed.count !== 1) fail(409, "Return cannot be cancelled (not found or already POSTED/CANCELLED)");
  return getReturn(tx, id);
}

/**
 * POST in one caller-managed interactive Prisma transaction.
 * IMPORTANT: caller MUST await prisma.$transaction(async tx => postReturn(tx,...)).
 * Never call with standalone queries or after the transaction commits.
 */
export async function postReturn(tx: ReturnTx, id: string, actorId: string) {
  const snapshot = await getReturn(tx, id);
  const sourceId = snapshot.type === "PURCHASE" ? snapshot.purchaseOrderId : snapshot.saleId;
  if (!sourceId) fail(409, "Return source is missing");

  // Same lock order as approveReturn: source first, return second.
  if (snapshot.type === "PURCHASE") {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${sourceId}::uuid FOR UPDATE`);
  } else {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Sale" WHERE "id" = ${sourceId}::uuid FOR UPDATE`);
  }
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ReturnOrder" WHERE "id" = ${id}::uuid FOR UPDATE`);
  const doc = await getReturn(tx, id);
  if (doc.status !== "APPROVED") fail(409, "Only APPROVED returns can be posted");
  if (doc.items.length === 0) fail(409, "Cannot post an empty return");

  const items = [...doc.items].sort((a, b) => a.productId.localeCompare(b.productId) || a.id.localeCompare(b.id));
  const sourceLineIds = [...new Set(items.map(i => doc.type === "PURCHASE" ? i.purchaseOrderItemId : i.saleItemId))];
  for (const sourceLineId of sourceLineIds) {
    if (!sourceLineId) fail(409, "Return source item missing");
    const quantity = items.filter(i => (doc.type === "PURCHASE" ? i.purchaseOrderItemId : i.saleItemId) === sourceLineId)
      .reduce((sum, i) => sum + i.quantity, 0);
    const posted = await tx.returnOrderItem.aggregate({
      where: doc.type === "PURCHASE"
        ? { purchaseOrderItemId: sourceLineId, returnOrder: { id: { not: id }, type: "PURCHASE", status: "POSTED" } }
        : { saleItemId: sourceLineId, returnOrder: { id: { not: id }, type: "SALE", status: "POSTED" } },
      _sum: { quantity: true },
    });
    const limit = doc.type === "PURCHASE"
      ? (await tx.purchaseOrderItem.findUnique({ where: { id: sourceLineId }, select: { receivedQuantity: true } }))?.receivedQuantity
      : (await tx.saleItem.findUnique({ where: { id: sourceLineId }, select: { quantity: true } }))?.quantity;
    if (limit === undefined || quantity + (posted._sum.quantity ?? 0) > limit) {
      fail(409, `Return quantity exceeds remaining source quantity for item ${sourceLineId}`);
    }
  }

  // Enforce batch-level provenance cumulatively, not only per sale/purchase source line.
  // This check runs under the source document lock and serializes postings for that source.
  for (const item of items) {
    if (!item.batchId) continue;
    const sourceLineId = doc.type === "PURCHASE" ? item.purchaseOrderItemId : item.saleItemId;
    if (!sourceLineId) fail(409, "Return item source is missing");
    const allowed = doc.type === "PURCHASE"
      ? (await tx.goodsReceiptItem.aggregate({ where: {
          purchaseOrderItemId: sourceLineId, batchId: item.batchId,
          goodsReceipt: { status: "POSTED" },
        }, _sum: { quantity: true } }))._sum.quantity ?? 0
      : (await tx.stockReservation.aggregate({ where: {
          saleItemId: sourceLineId, batchId: item.batchId, status: "CONSUMED",
        }, _sum: { quantity: true } }))._sum.quantity ?? 0;
    const other = await tx.returnOrderItem.aggregate({ where: {
      ...(doc.type === "PURCHASE" ? { purchaseOrderItemId: sourceLineId } : { saleItemId: sourceLineId }),
      batchId: item.batchId, returnOrder: { id: { not: id }, type: doc.type, status: "POSTED" },
    }, _sum: { quantity: true } });
    const own = items.filter(i => (doc.type === "PURCHASE" ? i.purchaseOrderItemId : i.saleItemId) === sourceLineId && i.batchId === item.batchId)
      .reduce((sum, i) => sum + i.quantity, 0);
    if (own + (other._sum.quantity ?? 0) > allowed) fail(409, `Batch return exceeds consumed/received quantity: ${item.batchId}`);
  }

  const touched = new Set<string>();
  for (const item of items) {
    if (!item.locationId || item.quantity <= 0) fail(409, "Return requires a valid location and positive quantity");
    const location = await tx.warehouseLocation.findFirst({ where: { id: item.locationId, warehouseId: doc.warehouseId, isActive: true }, select: { locationType: true } });
    if (!location) fail(409, "Return location is missing or inactive");
    const product = await tx.product.findUnique({ where: { id: item.productId }, select: { trackBatch: true } });
    if (!product || (product.trackBatch && !item.batchId) || (!product.trackBatch && item.batchId)) fail(409, "Return product/batch validation failed");
    if (item.batchId) {
      const batch = await tx.productBatch.findFirst({ where: { id: item.batchId, productId: item.productId, warehouseId: doc.warehouseId } });
      if (!batch) fail(409, "Return batch does not belong to the source warehouse/product");
      if (doc.type === "PURCHASE") {
        if (!item.purchaseOrderItemId) fail(409, "Purchase return item missing source");
        const receipt = await tx.goodsReceiptItem.findFirst({ where: { purchaseOrderItemId: item.purchaseOrderItemId, batchId: item.batchId, goodsReceipt: { status: "POSTED" } }, select: { id: true } });
        if (!receipt) fail(409, "Purchase return batch provenance was lost");
      } else {
        if (!item.saleItemId) fail(409, "Sales return item missing source");
        const reservation = await tx.stockReservation.findFirst({ where: { saleItemId: item.saleItemId, batchId: item.batchId, status: "CONSUMED" }, select: { id: true } });
        if (!reservation) fail(409, "Sales return batch provenance was lost");
      }
    }

    let allocations: StockAllocation[];
    if (doc.type === "PURCHASE") {
      if (item.disposition !== "RESTOCK" || location.locationType !== "STORAGE") fail(409, "Purchase return requires STORAGE and outbound disposition");
      allocations = await postPurchaseReturnStock(tx, { productId: item.productId, warehouseId: doc.warehouseId, locationId: item.locationId, batchId: item.batchId, quantity: item.quantity });
    } else {
      allocations = await postSalesReturnStock(tx, { productId: item.productId, warehouseId: doc.warehouseId, locationId: item.locationId, batchId: item.batchId, quantity: item.quantity, disposition: item.disposition });
    }

    // SCRAP is an auditable zero-quantity disposition: no InventoryBalance change.
    const movement = await tx.stockMovement.create({ data: {
      productId: item.productId, warehouseId: doc.warehouseId,
      quantity: doc.type === "PURCHASE" ? -item.quantity : item.disposition === "SCRAP" ? 0 : item.quantity,
      movementType: doc.type === "PURCHASE" ? "PURCHASE_RETURN" : "SALES_RETURN",
      returnOrderId: doc.id, createdById: actorId,
      ...(doc.type === "PURCHASE" ? { purchaseOrderId: doc.purchaseOrderId } : { saleId: doc.saleId }),
      note: `Return ${doc.number}; item ${item.id}; disposition ${item.disposition}; condition ${item.condition}`,
    } });
    if (allocations.length) await linkMovementAllocations(tx, movement.id, allocations, doc.type === "PURCHASE" ? -1 : 1);
    touched.add(item.productId);
  }
  for (const productId of [...touched].sort()) await assertInventoryInvariant(tx, productId, doc.warehouseId);
  const changed = await makeReturnRepository(tx).transitionStatus(id, "APPROVED", "POSTED", { postedAt: new Date() });
  if (changed.count !== 1) fail(409, "Return status changed during posting");
  return getReturn(tx, id);
}
