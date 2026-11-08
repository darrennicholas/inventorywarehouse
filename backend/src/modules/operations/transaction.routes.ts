import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../lib/prisma.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess, scopedWarehouseFilter, warehouseScope } from "../../rbac/warehouse-scope.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { releaseSaleReservations, reserveSaleStock } from "./inventory.service.ts";
import { linkMovementAllocations, postStockIn, postStockOut } from "./stock-allocation.service.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { assertApprovalAuthority } from "../approvals/approval-policy.service.ts";
import { pageMeta, pagination } from "../../utils/pagination.ts";
import { assertUsableBatch } from "./batch-safety.ts";
import { lockCostBalance } from "./costing.service.ts";
import {
  adjustmentSchema,
  purchaseSchema,
  purchaseReceiveSchema,
  saleSchema,
  transferSchema,
  type AdjustmentInput,
  type PurchaseInput,
  type PurchaseReceiveInput,
  type SaleInput,
  type TransferInput,
} from "./operations.validation.ts";

// Transaction-domain router. Mounted by operations.routes.ts.
const router = Router();

function dateRange(query: Record<string, unknown>, field: string) {
  const range: { gte?: Date; lt?: Date } = {};
  const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const from = validDate(query.fromDate) ? query.fromDate : "";
  const to = validDate(query.toDate) ? query.toDate : "";
  if (from) range.gte = new Date(`${from}T00:00:00.000+07:00`);
  if (to) { const exclusive = new Date(`${to}T00:00:00.000+07:00`); exclusive.setUTCDate(exclusive.getUTCDate() + 1); range.lt = exclusive; }
  return Object.keys(range).length ? { [field]: range } : null;
}


function sumItems(items: { quantity: number; unitPrice: number }[]) {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

async function ensureProducts(tx: any, ids: string[]) {
  const products = await tx.product.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true },
  });
  if (products.length !== new Set(ids).size) {
    throw new AppError(400, "One or more selected products are invalid or inactive");
  }
}

async function ensureWarehouse(tx: any, id: string) {
  const warehouse = await tx.warehouse.findUnique({ where: { id } });
  if (!warehouse || !warehouse.isActive) throw new AppError(400, "Warehouse is invalid or inactive");
}

async function ensureScopedWarehouse(tx: any, id: string, auth: ReturnType<typeof authOf>) {
  assertWarehouseAccess(auth, id);
  await ensureWarehouse(tx, id);
}

async function validateRevisionLocations(tx: typeof prisma | any, warehouseId: string, productId: string, locationId?: string | null, batchId?: string | null) {
  if (locationId && !await tx.warehouseLocation.findFirst({ where: { id: locationId, warehouseId, isActive: true } })) throw new AppError(400, "Location is invalid or inactive for this warehouse");
  if (batchId) {
    const batch = await tx.productBatch.findFirst({ where: { id: batchId, warehouseId, productId } });
    if (!batch) throw new AppError(400, "Batch does not belong to the selected product and warehouse");
    if (!(await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { trackBatch: true } })).trackBatch) throw new AppError(400, "Non-batch product cannot use a batch");
    assertUsableBatch(batch, {});
  }
}

async function ensureLocation(tx: any, warehouseId: string, requestedLocationId?: string | null) {
  if (requestedLocationId) {
    const location = await tx.warehouseLocation.findFirst({ where: { id: requestedLocationId, warehouseId, isActive: true } });
    if (!location) throw new AppError(400, "Location is invalid or inactive for this warehouse");
    return location;
  }
  const location = await tx.warehouseLocation.findFirst({ where: { warehouseId, isActive: true, locationType: "STORAGE" }, orderBy: { code: "asc" } });
  if (location) return location;
  return tx.warehouseLocation.create({ data: { warehouseId, code: "UNASSIGNED", name: "Unassigned / Legacy Stock", isActive: true } });
}

async function ensureReceiptBatch(tx: any, input: { productId: string; warehouseId: string; batchNumber?: string | null; productionDate?: Date | null; expiryDate?: Date | null; locationId: string }, trackBatch: boolean, quarantineOnly = false) {
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

async function moveStock(tx: any, item: { productId: string; quantity: number; sourceLocationId?: string | null; destinationLocationId?: string | null; batchId?: string | null }, fromWarehouseId: string, toWarehouseId: string) {
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

const purchaseInclude = {
  supplier: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  items: { include: { product: { select: { id: true, sku: true, barcode: true, name: true, trackBatch: true } } } },
} as const;

const saleInclude = {
  customer: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  items: { include: { product: { select: { id: true, sku: true, barcode: true, name: true, trackBatch: true } } } },
} as const;

const editStatusSchema = z.object({
  status: z.string().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  expectedDate: z.coerce.date().nullable().optional(),
}).strict();

async function ensureTransitionAllowed(currentStatus: string, nextStatus: string, allowed: string[]) {
  if (!allowed.includes(nextStatus)) throw new AppError(400, `Invalid status: ${nextStatus}`);
  if (["RECEIVED", "COMPLETED", "POSTED", "CANCELLED"].includes(currentStatus)) throw new AppError(409, "A posted transaction cannot be edited");
}

async function estimateStockValue(tx: any, items: Array<{ productId: string; quantity: number }>, warehouseId: string) {
  let total = 0;
  for (const item of items) {
    const balance = await lockCostBalance(tx, item.productId, warehouseId);
    if (balance.averageUnitCost === null) throw new AppError(409, "Record the unknown opening stock cost in Stock Report before approval amount limits can be evaluated");
    total += item.quantity * Number(balance.averageUnitCost);
  }
  return total;
}

async function approvePurchase(id: string, userId: string, auth: ReturnType<typeof authOf>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const current = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!current) throw new AppError(404, "Purchase not found");
    await ensureScopedWarehouse(tx, current.warehouseId, auth);
    if (current.status !== "PENDING") throw new AppError(409, "Only pending purchases can be approved");
    await assertApprovalAuthority(tx, "PURCHASE", Number(current.total), auth, current.createdById);
    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: { status: "APPROVED", approvedById: userId, approvedAt: new Date() },
      include: purchaseInclude,
    });
    await writeAuditLog({ userId, action: "APPROVE", entity: "PurchaseOrder", entityId: id, beforeData: current, afterData: updated }, tx as never);
    return updated;
  });
}

async function approveAdjustment(id: string, userId: string, auth: ReturnType<typeof authOf>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StockAdjustment" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const current = await tx.stockAdjustment.findUnique({ where: { id }, include: { items: true } });
    if (!current) throw new AppError(404, "Adjustment not found");
    await ensureScopedWarehouse(tx, current.warehouseId, auth);
    if (current.status !== "DRAFT") throw new AppError(409, "Only draft adjustments can be approved");
    await assertApprovalAuthority(tx, "ADJUSTMENT", await estimateStockValue(tx, current.items, current.warehouseId), auth, current.createdById);
    for (const item of current.items) {
      const quantity = current.type === "INCREASE" ? item.quantity : -item.quantity;
      const allocations = current.type === "INCREASE"
        ? [await postStockIn(tx, { productId: item.productId, warehouseId: current.warehouseId, locationId: item.locationId, batchId: item.batchId, quantity: item.quantity })]
        : await postStockOut(tx, item.productId, current.warehouseId, item.quantity, { locationId: item.locationId, batchId: item.batchId });
      const movement = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: current.warehouseId, quantity, movementType: current.type === "INCREASE" ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", adjustmentId: id, createdById: userId, note: current.reason } });
      await linkMovementAllocations(tx, movement.id, allocations, current.type === "INCREASE" ? 1 : -1);
    }
    const updated = await tx.stockAdjustment.update({
      where: { id },
      data: { status: "POSTED", approvedById: userId, approvedAt: new Date() },
      include: { warehouse: true, approvedBy: { select: { id: true, fullName: true } }, items: true },
    });
    await writeAuditLog({ userId, action: "APPROVE", entity: "StockAdjustment", entityId: id, beforeData: current, afterData: updated }, tx as never);
    return updated;
  });
}

async function approveTransfer(id: string, userId: string, auth: ReturnType<typeof authOf>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StockTransfer" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const current = await tx.stockTransfer.findUnique({ where: { id } });
    if (!current) throw new AppError(404, "Transfer not found");
    await ensureScopedWarehouse(tx, current.fromWarehouseId, auth);
    if (current.status !== "DRAFT") throw new AppError(409, "Only draft transfers can be approved");
    if (current.createdById === auth.userId) throw new AppError(403, "The document creator cannot approve their own document");
    const updated = await tx.stockTransfer.update({
      where: { id },
      data: { status: "IN_TRANSIT", approvedById: userId, approvedAt: new Date() },
      include: { fromWarehouse: true, toWarehouse: true, approvedBy: { select: { id: true, fullName: true } }, items: true },
    });
    await writeAuditLog({ userId, action: "APPROVE", entity: "StockTransfer", entityId: id, beforeData: current, afterData: updated }, tx as never);
    return updated;
  });
}

async function receivePurchase(id: string, input: PurchaseReceiveInput, userId: string, auth: ReturnType<typeof authOf>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const current = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!current) throw new AppError(404, "Purchase not found");
    await ensureScopedWarehouse(tx, current.warehouseId, auth);
    if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(current.status)) {
      throw new AppError(409, "Only approved purchases can be received");
    }

    const requested: Array<{ productId: string; quantity: number; damagedQuantity: number; batchNumber?: string | null; expiryDate?: Date | null; productionDate?: Date | null; locationId?: string | null; notes?: string | null }> = input.items ?? current.items
      .filter((item) => item.receivedQuantity < item.quantity)
      .map((item) => ({ productId: item.productId, quantity: item.quantity - item.receivedQuantity, damagedQuantity: 0, batchNumber: item.batchNumber, expiryDate: item.expiryDate, productionDate: item.productionDate }));
    if (requested.length === 0) throw new AppError(409, "This purchase has already been fully received");

    const itemByProduct = new Map(current.items.map((item) => [item.productId, item]));
    const seen = new Set<string>();
    for (const requestedItem of requested) {
      if (seen.has(requestedItem.productId)) throw new AppError(400, "A product can only appear once in a receipt");
      seen.add(requestedItem.productId);
      const orderItem = itemByProduct.get(requestedItem.productId);
      if (!orderItem) throw new AppError(400, "Receipt contains a product that is not in this purchase");
      const receivedTotal = requestedItem.quantity + requestedItem.damagedQuantity;
      const remaining = orderItem.quantity - orderItem.receivedQuantity;
      if (receivedTotal > remaining) {
        throw new AppError(400, `Receipt quantity for ${requestedItem.productId} exceeds the remaining quantity`);
      }
    }

    const receiptNumber = input.receiptNumber ?? `GR-${current.number}-${Date.now().toString().slice(-6)}`;
    const receiptItems: Array<{ purchaseOrderItemId: string; productId: string; locationId: string; batchId: string | null; quantity: number; damagedQuantity: number; notes: string | null }> = [];
    for (const requestedItem of requested) {
      const orderItem = itemByProduct.get(requestedItem.productId)!;
      // Purchase has no discount column; recoverable invoice tax is excluded from cost.
      const incomingCost = orderItem.unitPrice;
      const product = await tx.product.findUnique({ where: { id: requestedItem.productId }, select: { trackBatch: true } });
      if (!product) throw new AppError(404, `Product ${requestedItem.productId} not found`);
      const location = await ensureLocation(tx, current.warehouseId, requestedItem.locationId);
      if (requestedItem.quantity > 0 && location.locationType !== "STORAGE") throw new AppError(400, "Accepted goods require an active STORAGE location");
      let damagedLocation: typeof location | null = null;
      if (requestedItem.damagedQuantity > 0) {
        damagedLocation = await tx.warehouseLocation.upsert({ where: { warehouseId_code: { warehouseId: current.warehouseId, code: "RECEIVING-DAMAGED" } }, create: { warehouseId: current.warehouseId, code: "RECEIVING-DAMAGED", name: "Receiving quarantine", locationType: "QUARANTINE" }, update: {} });
        if (!damagedLocation.isActive || damagedLocation.locationType !== "QUARANTINE") throw new AppError(409, "RECEIVING-DAMAGED must be an active quarantine location");
      }
      const batchNumber = requestedItem.batchNumber ?? orderItem.batchNumber;
      const expiryDate = requestedItem.expiryDate ?? orderItem.expiryDate;
      const productionDate = requestedItem.productionDate ?? orderItem.productionDate;
      const batch = await ensureReceiptBatch(tx, { productId: requestedItem.productId, warehouseId: current.warehouseId, batchNumber, expiryDate, productionDate, locationId: requestedItem.quantity > 0 ? location.id : damagedLocation!.id }, product.trackBatch, requestedItem.quantity === 0);
      const allocation = requestedItem.quantity > 0 ? await postStockIn(tx, { productId: requestedItem.productId, warehouseId: current.warehouseId, locationId: location.id, batchId: batch?.id ?? null, quantity: requestedItem.quantity, unitCost: incomingCost }) : null;
      if (allocation) {
        const movement = await tx.stockMovement.create({ data: { productId: requestedItem.productId, warehouseId: current.warehouseId, quantity: requestedItem.quantity, movementType: "PURCHASE_RECEIPT", unitCost: orderItem.unitPrice, purchaseOrderId: id, createdById: userId, note: "Purchase receiving" } });
        await linkMovementAllocations(tx, movement.id, [allocation], 1);
      }
      if (requestedItem.quantity > 0) receiptItems.push({ purchaseOrderItemId: orderItem.id, productId: requestedItem.productId, locationId: location.id, batchId: batch?.id ?? null, quantity: requestedItem.quantity, damagedQuantity: 0, notes: requestedItem.notes ?? null });
      if (requestedItem.damagedQuantity > 0 && damagedLocation) {
        const damagedAllocation = await postStockIn(tx, { productId: requestedItem.productId, warehouseId: current.warehouseId, locationId: damagedLocation.id, batchId: batch?.id ?? null, quantity: requestedItem.damagedQuantity, unitCost: incomingCost, reactivateBatch: false });
        const damagedMovement = await tx.stockMovement.create({ data: { productId: requestedItem.productId, warehouseId: current.warehouseId, quantity: requestedItem.damagedQuantity, movementType: "PURCHASE_RECEIPT", purchaseOrderId: id, createdById: userId, note: "Damaged receiving; quarantined, unavailable for sale" } });
        await linkMovementAllocations(tx, damagedMovement.id, [damagedAllocation], 1);
        receiptItems.push({ purchaseOrderItemId: orderItem.id, productId: requestedItem.productId, locationId: damagedLocation.id, batchId: batch?.id ?? null, quantity: 0, damagedQuantity: requestedItem.damagedQuantity, notes: requestedItem.notes ?? "Damaged goods received into quarantine" });
      }
      await tx.purchaseOrderItem.update({ where: { id: orderItem.id }, data: { receivedQuantity: { increment: requestedItem.quantity + requestedItem.damagedQuantity }, ...(batchNumber ? { batchNumber } : {}), ...(expiryDate !== undefined ? { expiryDate } : {}), ...(productionDate !== undefined ? { productionDate } : {}) } });
    }

    const receipt = await tx.goodsReceipt.create({ data: { number: receiptNumber, purchaseOrderId: id, warehouseId: current.warehouseId, receivedById: userId, notes: input.notes ?? null, items: { create: receiptItems } } });
    const allReceived = current.items.every((item) => item.receivedQuantity + (requested.find((row) => row.productId === item.productId)?.quantity ?? 0) + (requested.find((row) => row.productId === item.productId)?.damagedQuantity ?? 0) >= item.quantity);
    const updated = await tx.purchaseOrder.update({ where: { id }, data: { status: allReceived ? "RECEIVED" : "PARTIALLY_RECEIVED" }, include: purchaseInclude });
    await writeAuditLog({ userId, action: "RECEIVE", entity: "PurchaseOrder", entityId: id, beforeData: current, afterData: updated }, tx as never);
    return { ...updated, receiptId: receipt.id, receiptNumber: receipt.number };
  });
}

router.get("/options", requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const scope = warehouseScope(auth);
  const [products, warehouses, suppliers, customers, purchaseOrders, sales, expenses, locations, batches] = await Promise.all([
    prisma.product.findMany({ where: { isActive: true }, select: { id: true, sku: true, barcode: true, name: true, trackBatch: true }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { isActive: true, ...(scope ? { id: { in: scope } } : {}) }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    auth.permissions.includes("suppliers.read") ? prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }) : [],
    auth.permissions.includes("customers.read") ? prisma.customer.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }) : [],
    auth.permissions.includes("purchases.read") ? prisma.purchaseOrder.findMany({ where: scope ? { warehouseId: { in: scope } } : undefined, select: { id: true, number: true }, orderBy: { orderDate: "desc" }, take: 100 }) : [],
    auth.permissions.includes("sales.read") ? prisma.sale.findMany({ where: scope ? { warehouseId: { in: scope } } : undefined, select: { id: true, number: true }, orderBy: { saleDate: "desc" }, take: 100 }) : [],
    auth.permissions.includes("expenses.read") ? prisma.expense.findMany({ where: scope ? { warehouseId: { in: scope } } : undefined, select: { id: true, number: true }, orderBy: { expenseDate: "desc" }, take: 100 }) : [],
    prisma.warehouseLocation.findMany({ where: { isActive: true, ...(scope ? { warehouseId: { in: scope } } : {}) }, select: { id: true, warehouseId: true, code: true, name: true, locationType: true, }, orderBy: { code: "asc" } }),
    prisma.productBatch.findMany({ where: { status: "ACTIVE", quantityOnHand: { gt: 0 }, ...(scope ? { warehouseId: { in: scope } } : {}) }, select: { id: true, productId: true, warehouseId: true, batchNumber: true, product: { select: { sku: true, name: true } } }, orderBy: [{ expiryDate: "asc" }, { batchNumber: "asc" }], take: 500 }),
  ]);
  res.json({ success: true, data: { products, warehouses, suppliers, customers, purchaseOrders, sales, expenses, locations, batches } });
}));

router.get("/purchases", requirePermission("purchases.read"), asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
  const clauses: any[] = [];
  const base = scopedWarehouseFilter(authOf(req));
  if (base) clauses.push(base);
  if (search) clauses.push({ OR: [{ number: { contains: search, mode: "insensitive" } }, { supplier: { name: { contains: search, mode: "insensitive" } } }, { items: { some: { product: { OR: [{ name: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] } } } }] });
  const status = typeof req.query.status === "string" ? req.query.status : "";
  if (["DRAFT", "PENDING", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"].includes(status)) clauses.push({ status });
  const dates = dateRange(req.query as Record<string, unknown>, "orderDate"); if (dates) clauses.push(dates);
  const where = clauses.length ? { AND: clauses } : undefined;
  const [data, total] = await Promise.all([prisma.purchaseOrder.findMany({ where, include: purchaseInclude, orderBy: { orderDate: "desc" }, skip, take }), prisma.purchaseOrder.count({ where })]);
  res.json({ success: true, data, meta: pageMeta(page, pageSize, total) });
}));

router.post("/purchases/:id/approve", requirePermission("purchases.approve"), asyncHandler(async (req, res) => {
  const data = await approvePurchase(z.uuid().parse(req.params.id), authOf(req).userId, authOf(req));
  await notifyByPermission({ permission: "purchases.read", type: "PURCHASE_STATUS", title: "Purchase approved", message: `${data.number} has been approved for receiving.`, entity: "PurchaseOrder", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Purchase approved successfully", data });
}));

router.post("/purchases/:id/receive", requirePermission("purchases.write"), asyncHandler(async (req, res) => {
  const input = purchaseReceiveSchema.parse(req.body ?? {});
  const auth = authOf(req);
  const data = await receivePurchase(z.uuid().parse(req.params.id), input, auth.userId, auth);
  await notifyByPermission({ permission: "purchases.read", type: "PURCHASE_RECEIVED", title: "Purchase receipt recorded", message: `${data.number} is now ${data.status.toLowerCase().replaceAll("_", " ")}.`, entity: "PurchaseOrder", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: data.status === "RECEIVED" ? "Purchase fully received" : "Purchase partially received", data });
}));

router.post("/purchases", requirePermission("purchases.write"), asyncHandler(async (req, res) => {
  const input: PurchaseInput = purchaseSchema.parse(req.body);
  if (["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(input.status ?? "DRAFT")) throw new AppError(409, "Create the purchase as pending, then approve it before receiving");
  const userId = authOf(req).userId;
  const subtotal = sumItems(input.items);
  const tax = input.tax ?? 0;

  const data = await prisma.$transaction(async (tx) => {
    await ensureScopedWarehouse(tx, input.warehouseId, authOf(req));
    await ensureProducts(tx, input.items.map((item) => item.productId));
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier?.isActive) throw new AppError(400, "Supplier is invalid or inactive");

    const purchase = await tx.purchaseOrder.create({
      data: {
        number: input.number,
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        createdById: userId,
        status: input.status ?? "DRAFT",
        expectedDate: input.expectedDate ?? null,
        notes: input.notes ?? null,
        subtotal,
        tax,
        total: subtotal + tax,
        items: { create: input.items.map((item) => ({ ...item, total: item.quantity * item.unitPrice, receivedQuantity: 0 })) },
      },
      include: purchaseInclude,
    });
    if (purchase.status === "PENDING") await writeAuditLog({ userId, action: "SUBMIT", entity: "PurchaseOrder", entityId: purchase.id, afterData: { status: purchase.status } }, tx as never);

    return purchase;
  });

  await writeAuditLog({ userId, action: "PRICE_SNAPSHOT", entity: "PurchaseOrderItem", entityId: data.id, afterData: data.items.map((item) => ({ productId: item.productId, unitPrice: item.unitPrice, quantity: item.quantity })) , requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") });
  await notifyByPermission({ permission: "purchases.read", type: "PURCHASE_CREATED", title: "New purchase order", message: `${data.number} was created with status ${data.status.toLowerCase()}.`, entity: "PurchaseOrder", entityId: data.id, warehouseId: data.warehouseId });

  res.status(201).json({ success: true, message: "Purchase created successfully", data });
}));

router.patch("/purchases/:id", requirePermission("purchases.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const input = editStatusSchema.parse(req.body);
  const userId = authOf(req).userId;
  const current = await prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
  if (!current) throw new AppError(404, "Purchase not found");
  await ensureScopedWarehouse(prisma, current.warehouseId, authOf(req));
  const nextStatus = input.status ?? current.status;
  if (input.status && input.status !== current.status) await ensureTransitionAllowed(current.status, input.status, ["DRAFT", "PENDING", "RECEIVED", "CANCELLED"]);
  if (["DRAFT", "PENDING"].includes(nextStatus) && !["DRAFT", "PENDING"].includes(current.status)) throw new AppError(409, "An approved or received purchase cannot return to draft or pending");
  if (nextStatus === "RECEIVED" && current.status !== "APPROVED") throw new AppError(409, "Purchase must be approved before receiving");
  if (nextStatus === "RECEIVED" && current.status !== "RECEIVED") throw new AppError(409, "Use the receiving action to create a goods receipt and update stock");

  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const latest = await tx.purchaseOrder.findUnique({ where: { id }, select: { status: true } });
    if (!latest || latest.status !== current.status) throw new AppError(409, "Purchase status changed; reload and try again");
    if (nextStatus === "CANCELLED") {
      if (current.items.some((item) => item.receivedQuantity > 0)) throw new AppError(409, "Received goods must use the return workflow; this purchase cannot be cancelled");
      if (await tx.payment.count({ where: { purchaseOrderId: id, status: { not: "VOID" } } }) || await tx.creditApplication.count({ where: { purchaseOrderId: id } })) throw new AppError(409, "Void pending/paid payments before cancellation; applied credit cannot be removed by cancelling an invoice");
    }
    const updated = await tx.purchaseOrder.update({ where: { id }, data: { status: nextStatus as never, notes: input.notes, expectedDate: input.expectedDate }, include: purchaseInclude });
    if (current.status !== "PENDING" && nextStatus === "PENDING") await writeAuditLog({ userId, action: "SUBMIT", entity: "PurchaseOrder", entityId: id, beforeData: { status: current.status }, afterData: { status: updated.status } }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "purchases.read", type: "PURCHASE_STATUS", title: "Purchase status updated", message: `${data.number} is now ${data.status.toLowerCase().replaceAll("_", " ")}.`, entity: "PurchaseOrder", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Purchase updated successfully", data });
}));

router.delete("/purchases/:id", requirePermission("purchases.delete"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const current = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "Purchase not found");
  assertWarehouseAccess(authOf(req), current.warehouseId);
  if (["RECEIVED", "CANCELLED"].includes(current.status)) throw new AppError(409, "A posted or cancelled purchase cannot be deleted");
  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const latest = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });
    if (latest.status !== current.status || latest.items.some((item) => item.receivedQuantity > 0)) throw new AppError(409, "Purchase changed or contains received stock; use a return instead");
    if (await tx.payment.count({ where: { purchaseOrderId: id, status: { not: "VOID" } } }) || await tx.creditApplication.count({ where: { purchaseOrderId: id } })) throw new AppError(409, "This invoice has financial entries and cannot be cancelled");
    const updated = await tx.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" }, include: purchaseInclude });
    await writeAuditLog({ userId: authOf(req).userId, action: "CANCEL", entity: "PurchaseOrder", entityId: id, beforeData: { status: latest.status }, afterData: { status: updated.status } }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "purchases.read", type: "PURCHASE_CANCELLED", title: "Purchase cancelled", message: `${data.number} was cancelled.`, entity: "PurchaseOrder", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Purchase cancelled successfully", data });
}));

router.get("/sales", requirePermission("sales.read"), asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
  const base = scopedWarehouseFilter(authOf(req));
  const clauses: any[] = [];
  if (base) clauses.push(base);
  if (search) clauses.push({ OR: [{ number: { contains: search, mode: "insensitive" } }, { customer: { name: { contains: search, mode: "insensitive" } } }, { items: { some: { product: { OR: [{ name: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] } } } }] });
  const status = typeof req.query.status === "string" ? req.query.status : "";
  if (["DRAFT", "RESERVED", "PICKING", "PACKED", "PARTIALLY_SHIPPED", "SHIPPED", "COMPLETED", "CANCELLED"].includes(status)) clauses.push({ status });
  const dates = dateRange(req.query as Record<string, unknown>, "saleDate"); if (dates) clauses.push(dates);
  const where = clauses.length ? { AND: clauses } : undefined;
  const [data, total] = await Promise.all([prisma.sale.findMany({ where, include: saleInclude, orderBy: { saleDate: "desc" }, skip, take }), prisma.sale.count({ where })]);
  res.json({ success: true, data, meta: pageMeta(page, pageSize, total) });
}));

router.post("/sales", requirePermission("sales.write"), asyncHandler(async (req, res) => {
  const input: SaleInput = saleSchema.parse(req.body);
  const userId = authOf(req).userId;
  const subtotal = sumItems(input.items);
  const discount = input.discount ?? 0;
  const tax = input.tax ?? 0;

  const data = await prisma.$transaction(async (tx) => {
    await ensureScopedWarehouse(tx, input.warehouseId, authOf(req));
    await ensureProducts(tx, input.items.map((item) => item.productId));
    const sale = await tx.sale.create({
      data: {
        number: input.number,
        customerId: input.customerId ?? null,
        warehouseId: input.warehouseId,
        createdById: userId,
        status: input.status ?? "DRAFT",
        notes: input.notes ?? null,
        subtotal,
        discount,
        tax,
        total: subtotal - discount + tax,
        items: { create: input.items.map((item) => ({ ...item, total: item.quantity * item.unitPrice })) },
      },
      include: saleInclude,
    });

    if (input.status === "RESERVED") {
      await reserveSaleStock(tx, sale.id, input.warehouseId, userId, sale.items.map((item) => ({ id: item.id, productId: item.productId, quantity: item.quantity })));
    }
    return sale;
  });

  await writeAuditLog({ userId, action: "PRICE_SNAPSHOT", entity: "SaleItem", entityId: data.id, afterData: data.items.map((item) => ({ productId: item.productId, unitPrice: item.unitPrice, quantity: item.quantity })) , requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") });
  await notifyByPermission({ permission: "sales.read", type: "SALE_CREATED", title: "New sale created", message: `${data.number} was created with status ${data.status.toLowerCase()}.`, entity: "Sale", entityId: data.id, warehouseId: data.warehouseId });

  res.status(201).json({ success: true, message: "Sale created successfully", data });
}));

router.post("/sales/:id/reserve", requirePermission("sales.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const auth = authOf(req);
  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const current = await tx.sale.findUnique({ where: { id }, include: { items: true } });
    if (!current) throw new AppError(404, "Sale not found");
    await ensureScopedWarehouse(tx, current.warehouseId, auth);
    if (current.status !== "DRAFT") throw new AppError(409, "Only draft sales can reserve stock");
    await reserveSaleStock(tx, id, current.warehouseId, auth.userId, current.items.map((item) => ({ id: item.id, productId: item.productId, quantity: item.quantity })));
    const updated = await tx.sale.update({ where: { id }, data: { status: "RESERVED" }, include: saleInclude });
    await writeAuditLog({ userId: auth.userId, action: "RESERVE", entity: "Sale", entityId: id, beforeData: current, afterData: updated }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "sales.read", type: "SALE_RESERVED", title: "Stock reserved", message: `${data.number} reserved stock successfully.`, entity: "Sale", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Stock reserved successfully", data });
}));

router.post("/sales/:id/release-reservation", requirePermission("sales.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id); const { reason } = z.object({ reason: z.string().trim().min(5).max(500) }).strict().parse(req.body); const auth = authOf(req);
  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const current = await tx.sale.findUnique({ where: { id } });
    if (!current) throw new AppError(404, "Sale not found");
    await ensureScopedWarehouse(tx, current.warehouseId, auth);
    if (current.status !== "RESERVED") throw new AppError(409, "Only a reserved sale can release its reservation");
    const shipments = await tx.saleShipment.count({ where: { saleId: id, status: { not: "CANCELLED" } } });
    if (shipments) throw new AppError(409, "Cancel or complete all active shipments before releasing stock");
    const active = await tx.stockReservation.count({ where: { saleId: id, status: "ACTIVE" } });
    if (!active) throw new AppError(409, "No active reservations remain");
    await releaseSaleReservations(tx, id, "RELEASED", reason);
    const updated = await tx.sale.update({ where: { id }, data: { status: "DRAFT" }, include: saleInclude });
    await writeAuditLog({ userId: auth.userId, action: "RELEASE_RESERVATION", entity: "Sale", entityId: id, beforeData: { status: current.status }, afterData: { status: updated.status, reason } }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "sales.read", type: "SALE_RESERVATION_RELEASED", title: "Sale reservation released", message: `${data.number}: ${reason}`, entity: "Sale", entityId: id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Reservation released; sale returned to draft", data });
}));

router.patch("/sales/:id", requirePermission("sales.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const input = editStatusSchema.pick({ status: true, notes: true }).parse(req.body);
  const userId = authOf(req).userId;
  const current = await prisma.sale.findUnique({ where: { id }, include: { items: true } });
  if (!current) throw new AppError(404, "Sale not found");
  await ensureScopedWarehouse(prisma, current.warehouseId, authOf(req));
  const nextStatus = input.status ?? current.status;
  if (!["DRAFT", "RESERVED"].includes(current.status) && nextStatus !== current.status) throw new AppError(409, "Sales in fulfillment must be managed through the fulfillment workflow");
  if (nextStatus === "COMPLETED" && nextStatus !== current.status) throw new AppError(409, "Complete the shipment in Fulfillment to finish this sale");
  if (current.status === "RESERVED" && ["DRAFT", "CANCELLED"].includes(nextStatus)) throw new AppError(409, "Release the reservation with a reason before editing or cancelling this sale");
  if (input.status && input.status !== current.status) await ensureTransitionAllowed(current.status, input.status, ["DRAFT", "RESERVED", "COMPLETED", "CANCELLED"]);

  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const latest = await tx.sale.findUnique({ where: { id }, select: { status: true } });
    if (!latest || latest.status !== current.status) throw new AppError(409, "Sale status changed; reload and try again");
    if (nextStatus === "RESERVED" && current.status === "DRAFT") {
      await reserveSaleStock(tx, id, current.warehouseId, userId, current.items.map((item) => ({ id: item.id, productId: item.productId, quantity: item.quantity })));
    }
    if (nextStatus === "CANCELLED" && (await tx.payment.count({ where: { saleId: id, status: { not: "VOID" } } }) || await tx.creditApplication.count({ where: { saleId: id } }))) throw new AppError(409, "This sale has financial entries and cannot be cancelled");
    return tx.sale.update({ where: { id }, data: { status: nextStatus as never, notes: input.notes }, include: saleInclude });
  });
  await notifyByPermission({ permission: "sales.read", type: "SALE_STATUS", title: "Sale status updated", message: `${data.number} is now ${data.status.toLowerCase()}.`, entity: "Sale", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Sale updated successfully", data });
}));

router.delete("/sales/:id", requirePermission("sales.delete"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const current = await prisma.sale.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "Sale not found");
  assertWarehouseAccess(authOf(req), current.warehouseId);
  if (["COMPLETED", "CANCELLED"].includes(current.status)) throw new AppError(409, "A completed or cancelled sale cannot be deleted");
  if (current.status === "RESERVED") throw new AppError(409, "Release the reservation with a reason before cancelling this sale");
  if (current.status !== "DRAFT") throw new AppError(409, "Sales in fulfillment must be managed through the fulfillment workflow");
  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const latest = await tx.sale.findUnique({ where: { id }, select: { status: true } });
    if (!latest || latest.status !== current.status) throw new AppError(409, "Sale status changed; reload and try again");
    if (await tx.payment.count({ where: { saleId: id, status: { not: "VOID" } } }) || await tx.creditApplication.count({ where: { saleId: id } })) throw new AppError(409, "This sale has financial entries and cannot be cancelled");
    return tx.sale.update({ where: { id }, data: { status: "CANCELLED" }, include: saleInclude });
  });
  await notifyByPermission({ permission: "sales.read", type: "SALE_CANCELLED", title: "Sale cancelled", message: `${data.number} was cancelled and any reservation was released.`, entity: "Sale", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Sale cancelled successfully", data });
}));

router.get("/adjustments", requirePermission("adjustments.read"), asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
  const clauses: any[] = [];
  const base = scopedWarehouseFilter(authOf(req));
  if (base) clauses.push(base);
  if (search) clauses.push({ OR: [{ number: { contains: search, mode: "insensitive" } }, { reason: { contains: search, mode: "insensitive" } }, { items: { some: { product: { OR: [{ name: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] } } } }] });
  const status = typeof req.query.status === "string" ? req.query.status : "";
  if (["DRAFT", "REVISION", "POSTED", "CANCELLED"].includes(status)) clauses.push({ status });
  const dates = dateRange(req.query as Record<string, unknown>, "adjustmentDate"); if (dates) clauses.push(dates);
  const where = clauses.length ? { AND: clauses } : undefined;
  const [data, total] = await Promise.all([prisma.stockAdjustment.findMany({ where, include: { warehouse: true, createdBy: { select: { id: true, fullName: true } }, approvedBy: { select: { id: true, fullName: true } }, items: { include: { product: { select: { id: true, sku: true, name: true } } } } }, orderBy: { adjustmentDate: "desc" }, skip, take }), prisma.stockAdjustment.count({ where })]);
  res.json({ success: true, data, meta: pageMeta(page, pageSize, total) });
}));

router.post("/adjustments/:id/approve", requirePermission("adjustments.approve"), asyncHandler(async (req, res) => {
  const data = await approveAdjustment(z.uuid().parse(req.params.id), authOf(req).userId, authOf(req));
  await notifyByPermission({ permission: "adjustments.read", type: "ADJUSTMENT_POSTED", title: "Adjustment posted", message: `${data.number} was approved and posted.`, entity: "StockAdjustment", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Adjustment approved and posted successfully", data });
}));

router.post("/adjustments", requirePermission("adjustments.write"), asyncHandler(async (req, res) => {
  const input: AdjustmentInput = adjustmentSchema.parse(req.body);
  if (input.status === "POSTED") throw new AppError(409, "Create the adjustment as draft, then approve it before posting");
  const userId = authOf(req).userId;
  const data = await prisma.$transaction(async (tx) => {
    await ensureScopedWarehouse(tx, input.warehouseId, authOf(req));
    await ensureProducts(tx, input.items.map((item) => item.productId));
    const adjustment = await tx.stockAdjustment.create({ data: { number: input.number, warehouseId: input.warehouseId, createdById: userId, type: input.type, status: input.status ?? "DRAFT", reason: input.reason, items: { create: input.items } }, include: { warehouse: true, items: true } });
    return adjustment;
  });
  await notifyByPermission({ permission: "adjustments.read", type: "ADJUSTMENT_CREATED", title: "New stock adjustment", message: `${data.number} was created for ${data.warehouse.name}.`, entity: "StockAdjustment", entityId: data.id, warehouseId: data.warehouseId });
  res.status(201).json({ success: true, message: "Adjustment created successfully", data });
}));

router.post("/adjustments/:id/revise", requirePermission("adjustments.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id); const input = adjustmentSchema.parse(req.body); const auth = authOf(req);
  if (input.status && input.status !== "DRAFT") throw new AppError(400, "Revision must be submitted for review");
  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StockAdjustment" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const before = await tx.stockAdjustment.findUnique({ where: { id }, include: { items: true } });
    if (!before) throw new AppError(404, "Adjustment not found");
    assertWarehouseAccess(auth, before.warehouseId);
    if (before.status !== "REVISION") throw new AppError(409, "Adjustment is not awaiting revision");
    if (before.createdById !== auth.userId) throw new AppError(403, "Only the creator can revise this document");
    if (before.number !== input.number) throw new AppError(400, "Document number cannot be changed");
    await ensureScopedWarehouse(tx, input.warehouseId, auth); await ensureProducts(tx, input.items.map((item) => item.productId));
    for (const item of input.items) {
      await validateRevisionLocations(tx, input.warehouseId, item.productId, item.locationId, item.batchId);
      if (input.type === "INCREASE" && !item.batchId && (await tx.product.findUniqueOrThrow({ where: { id: item.productId }, select: { trackBatch: true } })).trackBatch) throw new AppError(400, "Batch is required for a batch-tracked product");
    }
    await tx.stockAdjustmentItem.deleteMany({ where: { adjustmentId: id } });
    const after = await tx.stockAdjustment.update({ where: { id }, data: { warehouseId: input.warehouseId, type: input.type, reason: input.reason, status: "DRAFT", items: { create: input.items } }, include: { items: true } });
    await writeAuditLog({ userId: auth.userId, action: "RESUBMIT", entity: "StockAdjustment", entityId: id, beforeData: before, afterData: after }, tx as never); return after;
  });
  try { await notifyByPermission({ permission: "adjustments.approve", type: "ADJUSTMENT_REVISED", title: "Adjustment resubmitted", message: `${data.number} requires review.`, entity: "StockAdjustment", entityId: id, warehouseId: data.warehouseId }); } catch (error) { console.error("Unable to send revision notification", error); }
  res.json({ success: true, data });
}));

router.patch("/adjustments/:id", requirePermission("adjustments.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const input = editStatusSchema.pick({ status: true }).parse(req.body);
  const userId = authOf(req).userId;
  const current = await prisma.stockAdjustment.findUnique({ where: { id }, include: { items: true } });
  if (!current) throw new AppError(404, "Adjustment not found");
  await ensureScopedWarehouse(prisma, current.warehouseId, authOf(req));
  if (current.status === "REVISION") throw new AppError(409, "Use the revision action to resubmit this adjustment");
  const nextStatus = input.status ?? current.status;
  if (input.status && input.status !== current.status) await ensureTransitionAllowed(current.status, input.status, ["DRAFT", "CANCELLED"]);

  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StockAdjustment" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const latest = await tx.stockAdjustment.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (latest.status !== current.status) throw new AppError(409, "Adjustment changed; reload and try again");
    return tx.stockAdjustment.update({ where: { id }, data: { status: nextStatus as never }, include: { warehouse: true, items: true } });
  });
  await notifyByPermission({ permission: "adjustments.read", type: "ADJUSTMENT_STATUS", title: "Adjustment status updated", message: `${data.number} is now ${data.status.toLowerCase()}.`, entity: "StockAdjustment", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Adjustment updated successfully", data });
}));

router.delete("/adjustments/:id", requirePermission("adjustments.delete"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const current = await prisma.stockAdjustment.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "Adjustment not found");
  assertWarehouseAccess(authOf(req), current.warehouseId);
  if (["POSTED", "CANCELLED"].includes(current.status)) throw new AppError(409, "A posted or cancelled adjustment cannot be deleted");
  const changed = await prisma.stockAdjustment.updateMany({ where: { id, status: current.status }, data: { status: "CANCELLED" } });
  if (changed.count !== 1) throw new AppError(409, "Adjustment changed; reload before cancelling");
  const data = await prisma.stockAdjustment.findUniqueOrThrow({ where: { id }, include: { warehouse: true, items: true } });
  await notifyByPermission({ permission: "adjustments.read", type: "ADJUSTMENT_CANCELLED", title: "Adjustment cancelled", message: `${data.number} was cancelled.`, entity: "StockAdjustment", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Adjustment cancelled successfully", data });
}));

router.get("/transfers", requirePermission("transfers.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const scope = warehouseScope(auth);
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
  const clauses: any[] = [];
  if (scope) clauses.push({ OR: [{ fromWarehouseId: { in: scope } }, { toWarehouseId: { in: scope } }] });
  if (search) clauses.push({ OR: [{ number: { contains: search, mode: "insensitive" } }, { fromWarehouse: { name: { contains: search, mode: "insensitive" } } }, { toWarehouse: { name: { contains: search, mode: "insensitive" } } }, { items: { some: { product: { OR: [{ name: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] } } } }] });
  const status = typeof req.query.status === "string" ? req.query.status : "";
  if (["DRAFT", "REVISION", "IN_TRANSIT", "COMPLETED", "CANCELLED"].includes(status)) clauses.push({ status });
  const dates = dateRange(req.query as Record<string, unknown>, "transferDate"); if (dates) clauses.push(dates);
  const where = clauses.length ? { AND: clauses } : undefined;
  const [data, total] = await Promise.all([prisma.stockTransfer.findMany({ where, include: { fromWarehouse: true, toWarehouse: true, createdBy: { select: { id: true, fullName: true } }, approvedBy: { select: { id: true, fullName: true } }, items: { include: { product: { select: { id: true, sku: true, name: true } } } } }, orderBy: { transferDate: "desc" }, skip, take }), prisma.stockTransfer.count({ where })]);
  res.json({ success: true, data, meta: pageMeta(page, pageSize, total) });
}));

router.post("/transfers/:id/approve", requirePermission("transfers.approve"), asyncHandler(async (req, res) => {
  const data = await approveTransfer(z.uuid().parse(req.params.id), authOf(req).userId, authOf(req));
  await notifyByPermission({ permission: "transfers.read", type: "TRANSFER_IN_TRANSIT", title: "Transfer approved", message: `${data.number} is now in transit.`, entity: "StockTransfer", entityId: data.id, warehouseId: data.fromWarehouseId });
  res.json({ success: true, message: "Transfer approved and sent in transit", data });
}));

router.post("/transfers", requirePermission("transfers.write"), asyncHandler(async (req, res) => {
  const input: TransferInput = transferSchema.parse(req.body);
  if (input.status && input.status !== "DRAFT") throw new AppError(409, "Create the transfer as draft, then approve it before completing");
  const userId = authOf(req).userId;
  const data = await prisma.$transaction(async (tx) => {
    await ensureScopedWarehouse(tx, input.fromWarehouseId, authOf(req));
    await ensureWarehouse(tx, input.toWarehouseId);
    await ensureProducts(tx, input.items.map((item) => item.productId));
    const transfer = await tx.stockTransfer.create({ data: { number: input.number, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId, createdById: userId, status: input.status ?? "DRAFT", notes: input.notes ?? null, items: { create: input.items } }, include: { items: true } });
    return transfer;
  });
  await notifyByPermission({ permission: "transfers.read", type: "TRANSFER_CREATED", title: "New stock transfer", message: `${data.number} was created.`, entity: "StockTransfer", entityId: data.id, warehouseId: data.fromWarehouseId });
  res.status(201).json({ success: true, message: "Transfer created successfully", data });
}));

router.post("/transfers/:id/revise", requirePermission("transfers.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id); const input = transferSchema.parse(req.body); const auth = authOf(req);
  if (input.status && input.status !== "DRAFT") throw new AppError(400, "Revision must be submitted for review");
  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StockTransfer" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const before = await tx.stockTransfer.findUnique({ where: { id }, include: { items: true } });
    if (!before) throw new AppError(404, "Transfer not found");
    assertWarehouseAccess(auth, before.fromWarehouseId);
    if (before.status !== "REVISION") throw new AppError(409, "Transfer is not awaiting revision");
    if (before.createdById !== auth.userId) throw new AppError(403, "Only the creator can revise this document");
    if (before.number !== input.number) throw new AppError(400, "Document number cannot be changed");
    await ensureScopedWarehouse(tx, input.fromWarehouseId, auth); await ensureWarehouse(tx, input.toWarehouseId); await ensureProducts(tx, input.items.map((item) => item.productId));
    for (const item of input.items) {
      await validateRevisionLocations(tx, input.fromWarehouseId, item.productId, item.sourceLocationId, item.batchId);
      await validateRevisionLocations(tx, input.toWarehouseId, item.productId, item.destinationLocationId);
    }
    await tx.stockTransferItem.deleteMany({ where: { transferId: id } });
    const after = await tx.stockTransfer.update({ where: { id }, data: { fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId, notes: input.notes, status: "DRAFT", items: { create: input.items } }, include: { items: true } });
    await writeAuditLog({ userId: auth.userId, action: "RESUBMIT", entity: "StockTransfer", entityId: id, beforeData: before, afterData: after }, tx as never); return after;
  });
  try { await notifyByPermission({ permission: "transfers.approve", type: "TRANSFER_REVISED", title: "Transfer resubmitted", message: `${data.number} requires review.`, entity: "StockTransfer", entityId: id, warehouseId: data.fromWarehouseId }); } catch (error) { console.error("Unable to send revision notification", error); }
  res.json({ success: true, data });
}));

router.patch("/transfers/:id", requirePermission("transfers.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const input = editStatusSchema.pick({ status: true, notes: true }).parse(req.body);
  const userId = authOf(req).userId;
  const current = await prisma.stockTransfer.findUnique({ where: { id }, include: { items: true } });
  if (!current) throw new AppError(404, "Transfer not found");
  await ensureScopedWarehouse(prisma, current.fromWarehouseId, authOf(req));
  if (current.status === "REVISION") throw new AppError(409, "Use the revision action to resubmit this transfer");
  const nextStatus = input.status ?? current.status;
  if (input.status && input.status !== current.status) await ensureTransitionAllowed(current.status, input.status, ["DRAFT", "COMPLETED", "CANCELLED"]);
  if (nextStatus === "COMPLETED" && current.status !== "IN_TRANSIT") throw new AppError(409, "Transfer must be approved before completion");

  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StockTransfer" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const latest = await tx.stockTransfer.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (latest.status !== current.status) throw new AppError(409, "Transfer changed; reload and try again");
    if (nextStatus === "COMPLETED" && current.status !== "COMPLETED") {
      for (const item of current.items) {
        const moved = await moveStock(tx, item, current.fromWarehouseId, current.toWarehouseId);
        const outbound = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: current.fromWarehouseId, quantity: -item.quantity, movementType: "TRANSFER_OUT", transferId: id, createdById: userId } });
        const inbound = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: current.toWarehouseId, quantity: item.quantity, movementType: "TRANSFER_IN", transferId: id, createdById: userId } });
        await linkMovementAllocations(tx, outbound.id, moved.sourceAllocations, -1);
        await linkMovementAllocations(tx, inbound.id, moved.destinationAllocations, 1);
      }
    }
    return tx.stockTransfer.update({ where: { id }, data: { status: nextStatus as never, notes: input.notes }, include: { fromWarehouse: true, toWarehouse: true, items: true } });
  });
  await notifyByPermission({ permission: "transfers.read", type: "TRANSFER_STATUS", title: "Transfer status updated", message: `${data.number} is now ${data.status.toLowerCase()}.`, entity: "StockTransfer", entityId: data.id, warehouseId: data.fromWarehouseId });
  res.json({ success: true, message: "Transfer updated successfully", data });
}));

router.delete("/transfers/:id", requirePermission("transfers.delete"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const current = await prisma.stockTransfer.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "Transfer not found");
  assertWarehouseAccess(authOf(req), current.fromWarehouseId);
  if (["COMPLETED", "CANCELLED"].includes(current.status)) throw new AppError(409, "A completed or cancelled transfer cannot be deleted");
  const changed = await prisma.stockTransfer.updateMany({ where: { id, status: current.status }, data: { status: "CANCELLED" } });
  if (changed.count !== 1) throw new AppError(409, "Transfer changed; reload before cancelling");
  const data = await prisma.stockTransfer.findUniqueOrThrow({ where: { id }, include: { fromWarehouse: true, toWarehouse: true, items: true } });
  await notifyByPermission({ permission: "transfers.read", type: "TRANSFER_CANCELLED", title: "Transfer cancelled", message: `${data.number} was cancelled.`, entity: "StockTransfer", entityId: data.id, warehouseId: data.fromWarehouseId });
  res.json({ success: true, message: "Transfer cancelled successfully", data });
}));

export default router;
