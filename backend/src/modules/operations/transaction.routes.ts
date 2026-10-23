import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import { prisma } from "../../lib/prisma.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess, scopedWarehouseFilter, warehouseScope } from "../../rbac/warehouse-scope.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { consumeSaleReservations, releaseSaleReservations, reserveSaleStock, updateExpiredBatches } from "./inventory.service.ts";
import { linkMovementAllocations, postStockIn, postStockOut } from "./stock-allocation.service.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { assertApprovalAuthority } from "../approvals/approval-policy.service.ts";
import { pageMeta, pagination } from "../../utils/pagination.ts";
import {
  adjustmentSchema,
  expenseSchema,
  paymentSchema,
  purchaseSchema,
  purchaseReceiveSchema,
  saleSchema,
  transferSchema,
  type AdjustmentInput,
  type ExpenseInput,
  type PaymentInput,
  type PurchaseInput,
  type PurchaseReceiveInput,
  type SaleInput,
  type TransferInput,
} from "./operations.validation.ts";

// Transaction-domain router. Mounted by operations.routes.ts.
const router = Router();

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

async function ensureLocation(tx: any, warehouseId: string, requestedLocationId?: string | null) {
  if (requestedLocationId) {
    const location = await tx.warehouseLocation.findFirst({ where: { id: requestedLocationId, warehouseId, isActive: true } });
    if (!location) throw new AppError(400, "Location is invalid or inactive for this warehouse");
    return location;
  }
  const location = await tx.warehouseLocation.findFirst({ where: { warehouseId, isActive: true }, orderBy: { code: "asc" } });
  if (location) return location;
  return tx.warehouseLocation.create({ data: { warehouseId, code: "UNASSIGNED", name: "Unassigned / Legacy Stock", isActive: true } });
}

async function ensureReceiptBatch(tx: any, input: { productId: string; warehouseId: string; batchNumber?: string | null; productionDate?: Date | null; expiryDate?: Date | null; locationId: string }, trackBatch: boolean) {
  if (!trackBatch && input.batchNumber) throw new AppError(400, "Non-batch product cannot use a batch number");
  if (trackBatch && !input.batchNumber) throw new AppError(400, `Batch number is required for ${input.productId}`);
  if (!input.batchNumber) return null;
  return tx.productBatch.upsert({
    where: { productId_warehouseId_batchNumber: { productId: input.productId, warehouseId: input.warehouseId, batchNumber: input.batchNumber } },
    create: { productId: input.productId, warehouseId: input.warehouseId, locationId: input.locationId, batchNumber: input.batchNumber, productionDate: input.productionDate ?? null, expiryDate: input.expiryDate ?? null, quantityOnHand: 0, reservedQuantity: 0, status: "ACTIVE" },
    update: { productionDate: input.productionDate ?? undefined, expiryDate: input.expiryDate ?? undefined, locationId: input.locationId, status: "ACTIVE" },
  });
}

async function linkSaleMovement(tx: any, movementId: string, saleId: string, productId: string) {
  const reservations = await tx.stockReservation.findMany({ where: { saleId, productId }, select: { locationBalanceId: true, batchId: true, quantity: true } });
  await linkMovementAllocations(tx, movementId, reservations.filter((row: { locationBalanceId: string | null }) => row.locationBalanceId).map((row: { locationBalanceId: string | null; batchId: string | null; quantity: number }) => ({ locationBalanceId: row.locationBalanceId!, locationId: "", batchId: row.batchId, quantity: row.quantity })), -1);
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
      const destinationBatch = await tx.productBatch.upsert({
        where: { productId_warehouseId_batchNumber: { productId: item.productId, warehouseId: toWarehouseId, batchNumber: sourceBatch.batchNumber } },
        create: { productId: item.productId, warehouseId: toWarehouseId, locationId: destinationLocation.id, batchNumber: sourceBatch.batchNumber, productionDate: sourceBatch.productionDate, expiryDate: sourceBatch.expiryDate, quantityOnHand: 0, reservedQuantity: 0, status: "ACTIVE" },
        update: { locationId: destinationLocation.id, productionDate: sourceBatch.productionDate, expiryDate: sourceBatch.expiryDate, status: "ACTIVE" },
      });
      destinationBatchId = destinationBatch.id;
    }
    destinationAllocations.push(await postStockIn(tx, { productId: item.productId, warehouseId: toWarehouseId, locationId: destinationLocation.id, batchId: destinationBatchId, quantity: source.quantity }));
  }
  return { sourceAllocations, destinationAllocations };
}

function requestedWarehouseId(req: { query: Record<string, unknown> }) {
  return typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
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

const expenseEditSchema = z.object({
  category: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  amount: z.coerce.number().min(0).optional(),
  warehouseId: z.uuid().nullable().optional(),
  expenseDate: z.coerce.date().optional(),
  isPaid: z.boolean().optional(),
}).strict();

const paymentEditSchema = z.object({
  method: z.enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD", "E_WALLET", "OTHER"]).optional(),
  status: z.enum(["PENDING", "PAID", "VOID"]).optional(),
  paymentDate: z.coerce.date().optional(),
  referenceNo: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
}).strict();

const relocationSchema = z.object({
  warehouseId: z.uuid(),
  fromLocationId: z.uuid(),
  toLocationId: z.uuid(),
  reason: z.string().trim().max(500).nullable().optional(),
  items: z.array(z.object({ productId: z.uuid(), batchId: z.uuid().nullable().optional(), quantity: z.coerce.number().int().positive().max(1_000_000) }).strict()).min(1).max(100),
}).strict().refine((value) => value.fromLocationId !== value.toLocationId, { message: "Source and destination locations must be different", path: ["toLocationId"] });

async function ensureTransitionAllowed(currentStatus: string, nextStatus: string, allowed: string[]) {
  if (!allowed.includes(nextStatus)) throw new AppError(400, `Invalid status: ${nextStatus}`);
  if (["RECEIVED", "COMPLETED", "POSTED", "CANCELLED"].includes(currentStatus)) {
    throw new AppError(409, "A posted transaction cannot be edited");
  }
}

async function estimateStockValue(tx: any, items: Array<{ productId: string; quantity: number }>) {
  let total = 0;
  for (const item of items) {
    const latestCost = await tx.purchaseOrderItem.findFirst({
      where: { productId: item.productId, purchaseOrder: { status: { in: ["PARTIALLY_RECEIVED", "RECEIVED"] } } },
      select: { unitPrice: true },
      orderBy: { purchaseOrder: { orderDate: "desc" } },
    });
    total += item.quantity * Number(latestCost?.unitPrice ?? 0);
  }
  return total;
}

async function approvePurchase(id: string, userId: string, auth: ReturnType<typeof authOf>) {
  return prisma.$transaction(async (tx) => {
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
    const current = await tx.stockAdjustment.findUnique({ where: { id }, include: { items: true } });
    if (!current) throw new AppError(404, "Adjustment not found");
    await ensureScopedWarehouse(tx, current.warehouseId, auth);
    if (current.status !== "DRAFT") throw new AppError(409, "Only draft adjustments can be approved");
    await assertApprovalAuthority(tx, "ADJUSTMENT", await estimateStockValue(tx, current.items), auth, current.createdById);
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
    const current = await tx.stockTransfer.findUnique({ where: { id } });
    if (!current) throw new AppError(404, "Transfer not found");
    await ensureScopedWarehouse(tx, current.fromWarehouseId, auth);
    if (current.status !== "DRAFT") throw new AppError(409, "Only draft transfers can be approved");
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
      const product = await tx.product.findUnique({ where: { id: requestedItem.productId }, select: { trackBatch: true } });
      if (!product) throw new AppError(404, `Product ${requestedItem.productId} not found`);
      const location = await ensureLocation(tx, current.warehouseId, requestedItem.locationId);
      const batchNumber = requestedItem.batchNumber ?? orderItem.batchNumber;
      const expiryDate = requestedItem.expiryDate ?? orderItem.expiryDate;
      const productionDate = requestedItem.productionDate ?? orderItem.productionDate;
      const batch = await ensureReceiptBatch(tx, { productId: requestedItem.productId, warehouseId: current.warehouseId, batchNumber, expiryDate, productionDate, locationId: location.id }, product.trackBatch);
      const allocation = requestedItem.quantity > 0 ? await postStockIn(tx, { productId: requestedItem.productId, warehouseId: current.warehouseId, locationId: location.id, batchId: batch?.id ?? null, quantity: requestedItem.quantity }) : null;
      if (allocation) {
        const movement = await tx.stockMovement.create({ data: { productId: requestedItem.productId, warehouseId: current.warehouseId, quantity: requestedItem.quantity, movementType: "PURCHASE_RECEIPT", unitCost: orderItem.unitPrice, purchaseOrderId: id, createdById: userId, note: "Purchase receiving" } });
        await linkMovementAllocations(tx, movement.id, [allocation], 1);
      }
      receiptItems.push({ purchaseOrderItemId: orderItem.id, productId: requestedItem.productId, locationId: location.id, batchId: batch?.id ?? null, quantity: requestedItem.quantity, damagedQuantity: requestedItem.damagedQuantity, notes: requestedItem.notes ?? null });
      await tx.purchaseOrderItem.update({ where: { id: orderItem.id }, data: { receivedQuantity: { increment: requestedItem.quantity + requestedItem.damagedQuantity }, ...(batchNumber ? { batchNumber } : {}), ...(expiryDate !== undefined ? { expiryDate } : {}), ...(productionDate !== undefined ? { productionDate } : {}) } });
    }

    const receipt = await tx.goodsReceipt.create({ data: { number: receiptNumber, purchaseOrderId: id, warehouseId: current.warehouseId, receivedById: userId, notes: input.notes ?? null, items: { create: receiptItems } } });
    const allReceived = current.items.every((item) => item.receivedQuantity + (requested.find((row) => row.productId === item.productId)?.quantity ?? 0) + (requested.find((row) => row.productId === item.productId)?.damagedQuantity ?? 0) >= item.quantity);
    const updated = await tx.purchaseOrder.update({ where: { id }, data: { status: allReceived ? "RECEIVED" : "PARTIALLY_RECEIVED" }, include: purchaseInclude });
    await writeAuditLog({ userId, action: "RECEIVE", entity: "PurchaseOrder", entityId: id, beforeData: current, afterData: updated }, tx as never);
    return { ...updated, receiptId: receipt.id, receiptNumber: receipt.number };
  });
}

router.get("/dashboard-summary", requirePermission("dashboard.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const scope = warehouseScope(auth);
  const since = new Date();
  since.setMonth(since.getMonth() - 5, 1);
  since.setHours(0, 0, 0, 0);

  const [purchases, sales, expenses, balances] = await Promise.all([
    prisma.purchaseOrder.findMany({ where: { orderDate: { gte: since }, status: { not: "CANCELLED" }, ...scopedWarehouseFilter(auth) }, select: { orderDate: true, total: true } }),
    prisma.sale.findMany({ where: { saleDate: { gte: since }, status: "COMPLETED", ...scopedWarehouseFilter(auth) }, select: { saleDate: true, total: true } }),
    prisma.expense.findMany({ where: { expenseDate: { gte: since }, ...scopedWarehouseFilter(auth) }, select: { expenseDate: true, amount: true } }),
    prisma.inventoryBalance.findMany({ where: scope ? { warehouseId: { in: scope } } : undefined, select: { quantityOnHand: true, reservedQuantity: true, product: { select: { id: true, sku: true, name: true, minStock: true } }, warehouse: { select: { id: true, name: true } } } }),
  ]);

  const months = Array.from({ length: 6 }, (_, index) => {
    const value = new Date(since.getFullYear(), since.getMonth() + index, 1);
    return { value, label: value.toLocaleDateString("id-ID", { month: "short" }), purchases: 0, sales: 0, expenses: 0 };
  });
  const monthIndex = (value: Date) => months.findIndex((month) => month.value.getFullYear() === value.getFullYear() && month.value.getMonth() === value.getMonth());
  for (const row of purchases) { const index = monthIndex(row.orderDate); if (index >= 0) months[index].purchases += Number(row.total); }
  for (const row of sales) { const index = monthIndex(row.saleDate); if (index >= 0) months[index].sales += Number(row.total); }
  for (const row of expenses) { const index = monthIndex(row.expenseDate); if (index >= 0) months[index].expenses += Number(row.amount); }

  const productTotals = new Map<string, { id: string; sku: string; name: string; quantity: number; minStock: number }>();
  const warehouseTotals = new Map<string, { id: string; name: string; quantity: number }>();
  const lowStock = balances.filter((row) => row.quantityOnHand - row.reservedQuantity <= row.product.minStock).map((row) => ({ productId: row.product.id, sku: row.product.sku, productName: row.product.name, warehouseId: row.warehouse.id, warehouseName: row.warehouse.name, quantityOnHand: row.quantityOnHand, reservedQuantity: row.reservedQuantity, availableQuantity: row.quantityOnHand - row.reservedQuantity, minStock: row.product.minStock, reorderQuantity: Math.max(row.product.minStock * 2 - (row.quantityOnHand - row.reservedQuantity), row.product.minStock) }));
  for (const row of balances) {
    const currentProduct = productTotals.get(row.product.id) ?? { id: row.product.id, sku: row.product.sku, name: row.product.name, quantity: 0, minStock: row.product.minStock };
    currentProduct.quantity += row.quantityOnHand - row.reservedQuantity;
    productTotals.set(row.product.id, currentProduct);
    const currentWarehouse = warehouseTotals.get(row.warehouse.id) ?? { id: row.warehouse.id, name: row.warehouse.name, quantity: 0 };
    currentWarehouse.quantity += row.quantityOnHand - row.reservedQuantity;
    warehouseTotals.set(row.warehouse.id, currentWarehouse);
  }

  res.json({ success: true, data: {
    kpis: {
      purchaseValue: purchases.reduce((sum, row) => sum + Number(row.total), 0),
      salesValue: sales.reduce((sum, row) => sum + Number(row.total), 0),
      expenseValue: expenses.reduce((sum, row) => sum + Number(row.amount), 0),
      stockUnits: balances.reduce((sum, row) => sum + row.quantityOnHand - row.reservedQuantity, 0),
      lowStockLines: lowStock.length,
    },
    monthly: months.map(({ label, purchases: purchaseValue, sales: salesValue, expenses: expenseValue }) => ({ label, purchases: purchaseValue, sales: salesValue, expenses: expenseValue })),
    topProducts: [...productTotals.values()].sort((left, right) => right.quantity - left.quantity).slice(0, 6),
    warehouseStock: [...warehouseTotals.values()].sort((left, right) => right.quantity - left.quantity),
    lowStock: lowStock.slice(0, 12),
  } });
}));

router.get("/options", requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const scope = warehouseScope(auth);
  const [products, warehouses, suppliers, customers, purchaseOrders, sales, expenses, locations, batches] = await Promise.all([
    prisma.product.findMany({ where: { isActive: true }, select: { id: true, sku: true, barcode: true, name: true, trackBatch: true }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { isActive: true, ...(scope ? { id: { in: scope } } : {}) }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    prisma.customer.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    prisma.purchaseOrder.findMany({ where: scope ? { warehouseId: { in: scope } } : undefined, select: { id: true, number: true }, orderBy: { orderDate: "desc" }, take: 100 }),
    prisma.sale.findMany({ where: scope ? { warehouseId: { in: scope } } : undefined, select: { id: true, number: true }, orderBy: { saleDate: "desc" }, take: 100 }),
    prisma.expense.findMany({ where: scope ? { warehouseId: { in: scope } } : undefined, select: { id: true, number: true }, orderBy: { expenseDate: "desc" }, take: 100 }),
    prisma.warehouseLocation.findMany({ where: { isActive: true, ...(scope ? { warehouseId: { in: scope } } : {}) }, select: { id: true, warehouseId: true, code: true, name: true, locationType: true, }, orderBy: { code: "asc" } }),
    prisma.productBatch.findMany({ where: { status: "ACTIVE", quantityOnHand: { gt: 0 }, ...(scope ? { warehouseId: { in: scope } } : {}) }, select: { id: true, productId: true, warehouseId: true, batchNumber: true, product: { select: { sku: true, name: true } } }, orderBy: [{ expiryDate: "asc" }, { batchNumber: "asc" }], take: 500 }),
  ]);
  res.json({ success: true, data: { products, warehouses, suppliers, customers, purchaseOrders, sales, expenses, locations, batches } });
}));

router.get("/purchases", requirePermission("purchases.read"), asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const where = scopedWarehouseFilter(authOf(req));
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
        items: { create: input.items.map((item) => ({ ...item, total: item.quantity * item.unitPrice, receivedQuantity: input.status === "RECEIVED" ? item.quantity : 0 })) },
      },
      include: purchaseInclude,
    });

    if (input.status === "RECEIVED") {
      for (const item of input.items) {
        const location = await ensureLocation(tx, input.warehouseId);
        const product = await tx.product.findUnique({ where: { id: item.productId }, select: { trackBatch: true } });
        const batch = await ensureReceiptBatch(tx, { productId: item.productId, warehouseId: input.warehouseId, batchNumber: item.batchNumber, productionDate: item.productionDate, expiryDate: item.expiryDate, locationId: location.id }, Boolean(product?.trackBatch));
        const allocation = await postStockIn(tx, { productId: item.productId, warehouseId: input.warehouseId, locationId: location.id, batchId: batch?.id ?? null, quantity: item.quantity });
        const movement = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: input.warehouseId, quantity: item.quantity, movementType: "PURCHASE_RECEIPT", unitCost: item.unitPrice, purchaseOrderId: purchase.id, createdById: userId } });
        await linkMovementAllocations(tx, movement.id, [allocation], 1);
      }
    }
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
  if (nextStatus === "RECEIVED" && current.status !== "APPROVED") throw new AppError(409, "Purchase must be approved before receiving");

  const data = await prisma.$transaction(async (tx) => {
    if (nextStatus === "RECEIVED" && current.status !== "RECEIVED") {
      for (const item of current.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId }, select: { trackBatch: true } });
        if (product?.trackBatch && !item.batchNumber) throw new AppError(400, `Batch number is required for ${item.productId}; use the receiving action`);
        const location = await ensureLocation(tx, current.warehouseId);
        const batch = await ensureReceiptBatch(tx, { productId: item.productId, warehouseId: current.warehouseId, batchNumber: item.batchNumber, productionDate: item.productionDate, expiryDate: item.expiryDate, locationId: location.id }, Boolean(product?.trackBatch));
        const allocation = await postStockIn(tx, { productId: item.productId, warehouseId: current.warehouseId, locationId: location.id, batchId: batch?.id ?? null, quantity: item.quantity });
        const movement = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: current.warehouseId, quantity: item.quantity, movementType: "PURCHASE_RECEIPT", unitCost: item.unitPrice, purchaseOrderId: id, createdById: userId } });
        await linkMovementAllocations(tx, movement.id, [allocation], 1);
      }
      for (const item of current.items) {
        await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQuantity: item.quantity } });
      }
    }
    return tx.purchaseOrder.update({ where: { id }, data: { status: nextStatus as never, notes: input.notes, expectedDate: input.expectedDate }, include: purchaseInclude });
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
  const data = await prisma.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" as never } , include: purchaseInclude });
  await notifyByPermission({ permission: "purchases.read", type: "PURCHASE_CANCELLED", title: "Purchase cancelled", message: `${data.number} was cancelled.`, entity: "PurchaseOrder", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Purchase cancelled successfully", data });
}));

router.get("/sales", requirePermission("sales.read"), asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const where = scopedWarehouseFilter(authOf(req));
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

    if (input.status === "COMPLETED") {
      await reserveSaleStock(tx, sale.id, input.warehouseId, userId, sale.items.map((item) => ({ id: item.id, productId: item.productId, quantity: item.quantity })));
      await consumeSaleReservations(tx, sale.id);
      for (const item of input.items) {
        const movement = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: input.warehouseId, quantity: -item.quantity, movementType: "SALE_ISSUE", unitCost: item.unitPrice, saleId: sale.id, createdById: userId } });
        await linkSaleMovement(tx, movement.id, sale.id, item.productId);
      }
    } else if (input.status === "RESERVED") {
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

router.patch("/sales/:id", requirePermission("sales.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const input = editStatusSchema.pick({ status: true, notes: true }).parse(req.body);
  const userId = authOf(req).userId;
  const current = await prisma.sale.findUnique({ where: { id }, include: { items: true } });
  if (!current) throw new AppError(404, "Sale not found");
  await ensureScopedWarehouse(prisma, current.warehouseId, authOf(req));
  const nextStatus = input.status ?? current.status;
  if (input.status && input.status !== current.status) await ensureTransitionAllowed(current.status, input.status, ["DRAFT", "RESERVED", "COMPLETED", "CANCELLED"]);

  const data = await prisma.$transaction(async (tx) => {
    if (nextStatus === "RESERVED" && current.status === "DRAFT") {
      await reserveSaleStock(tx, id, current.warehouseId, userId, current.items.map((item) => ({ id: item.id, productId: item.productId, quantity: item.quantity })));
    }
    if (nextStatus === "DRAFT" && current.status === "RESERVED") {
      await releaseSaleReservations(tx, id);
    }
    if (nextStatus === "CANCELLED" && current.status === "RESERVED") {
      await releaseSaleReservations(tx, id, "CANCELLED");
    }
    if (nextStatus === "COMPLETED" && current.status === "RESERVED") {
      await consumeSaleReservations(tx, id);
      for (const item of current.items) {
        const movement = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: current.warehouseId, quantity: -item.quantity, movementType: "SALE_ISSUE", unitCost: item.unitPrice, saleId: id, createdById: userId, note: "Reserved stock consumed" } });
        await linkSaleMovement(tx, movement.id, id, item.productId);
      }
    } else if (nextStatus === "COMPLETED" && current.status === "DRAFT") {
      await reserveSaleStock(tx, id, current.warehouseId, userId, current.items.map((item) => ({ id: item.id, productId: item.productId, quantity: item.quantity })));
      await consumeSaleReservations(tx, id);
      for (const item of current.items) {
        const movement = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: current.warehouseId, quantity: -item.quantity, movementType: "SALE_ISSUE", unitCost: item.unitPrice, saleId: id, createdById: userId } });
        await linkSaleMovement(tx, movement.id, id, item.productId);
      }
    }
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
  const data = await prisma.$transaction(async (tx) => {
    if (current.status === "RESERVED") await releaseSaleReservations(tx, id, "CANCELLED");
    return tx.sale.update({ where: { id }, data: { status: "CANCELLED" }, include: saleInclude });
  });
  await notifyByPermission({ permission: "sales.read", type: "SALE_CANCELLED", title: "Sale cancelled", message: `${data.number} was cancelled and any reservation was released.`, entity: "Sale", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Sale cancelled successfully", data });
}));

router.get("/adjustments", requirePermission("adjustments.read"), asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const where = scopedWarehouseFilter(authOf(req));
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
    if (input.status === "POSTED") {
      for (const item of input.items) {
        const quantity = input.type === "INCREASE" ? item.quantity : -item.quantity;
        const allocations = input.type === "INCREASE"
          ? [await postStockIn(tx, { productId: item.productId, warehouseId: input.warehouseId, locationId: item.locationId, batchId: item.batchId, quantity: item.quantity })]
          : await postStockOut(tx, item.productId, input.warehouseId, item.quantity, { locationId: item.locationId, batchId: item.batchId });
        const movement = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: input.warehouseId, quantity, movementType: input.type === "INCREASE" ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", adjustmentId: adjustment.id, createdById: userId, note: input.reason } });
        await linkMovementAllocations(tx, movement.id, allocations, input.type === "INCREASE" ? 1 : -1);
      }
    }
    return adjustment;
  });
  await notifyByPermission({ permission: "adjustments.read", type: "ADJUSTMENT_CREATED", title: "New stock adjustment", message: `${data.number} was created for ${data.warehouse.name}.`, entity: "StockAdjustment", entityId: data.id, warehouseId: data.warehouseId });
  res.status(201).json({ success: true, message: "Adjustment created successfully", data });
}));

router.patch("/adjustments/:id", requirePermission("adjustments.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const input = editStatusSchema.pick({ status: true }).parse(req.body);
  const userId = authOf(req).userId;
  const current = await prisma.stockAdjustment.findUnique({ where: { id }, include: { items: true } });
  if (!current) throw new AppError(404, "Adjustment not found");
  await ensureScopedWarehouse(prisma, current.warehouseId, authOf(req));
  const nextStatus = input.status ?? current.status;
  if (input.status && input.status !== current.status) await ensureTransitionAllowed(current.status, input.status, ["DRAFT", "CANCELLED"]);

  const data = await prisma.$transaction(async (tx) => {
    if (nextStatus === "POSTED" && current.status !== "POSTED") {
      for (const item of current.items) {
        const quantity = current.type === "INCREASE" ? item.quantity : -item.quantity;
        const allocations = current.type === "INCREASE"
          ? [await postStockIn(tx, { productId: item.productId, warehouseId: current.warehouseId, locationId: item.locationId, batchId: item.batchId, quantity: item.quantity })]
          : await postStockOut(tx, item.productId, current.warehouseId, item.quantity, { locationId: item.locationId, batchId: item.batchId });
        const movement = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: current.warehouseId, quantity, movementType: current.type === "INCREASE" ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", adjustmentId: id, createdById: userId, note: current.reason } });
        await linkMovementAllocations(tx, movement.id, allocations, current.type === "INCREASE" ? 1 : -1);
      }
    }
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
  const data = await prisma.stockAdjustment.update({ where: { id }, data: { status: "CANCELLED" as never }, include: { warehouse: true, items: true } });
  await notifyByPermission({ permission: "adjustments.read", type: "ADJUSTMENT_CANCELLED", title: "Adjustment cancelled", message: `${data.number} was cancelled.`, entity: "StockAdjustment", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Adjustment cancelled successfully", data });
}));

router.get("/transfers", requirePermission("transfers.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const scope = warehouseScope(auth);
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const where = scope ? { OR: [{ fromWarehouseId: { in: scope } }, { toWarehouseId: { in: scope } }] } : undefined;
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
  if (input.status === "COMPLETED") throw new AppError(409, "Create the transfer as draft, then approve it before completing");
  const userId = authOf(req).userId;
  const data = await prisma.$transaction(async (tx) => {
    await ensureScopedWarehouse(tx, input.fromWarehouseId, authOf(req));
    await ensureWarehouse(tx, input.toWarehouseId);
    await ensureProducts(tx, input.items.map((item) => item.productId));
    const transfer = await tx.stockTransfer.create({ data: { number: input.number, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId, createdById: userId, status: input.status ?? "DRAFT", notes: input.notes ?? null, items: { create: input.items } }, include: { items: true } });
    if (input.status === "COMPLETED") {
      for (const item of input.items) {
        const moved = await moveStock(tx, item, input.fromWarehouseId, input.toWarehouseId);
        const outbound = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: input.fromWarehouseId, quantity: -item.quantity, movementType: "TRANSFER_OUT", transferId: transfer.id, createdById: userId } });
        const inbound = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: input.toWarehouseId, quantity: item.quantity, movementType: "TRANSFER_IN", transferId: transfer.id, createdById: userId } });
        await linkMovementAllocations(tx, outbound.id, moved.sourceAllocations, -1);
        await linkMovementAllocations(tx, inbound.id, moved.destinationAllocations, 1);
      }
    }
    return transfer;
  });
  await notifyByPermission({ permission: "transfers.read", type: "TRANSFER_CREATED", title: "New stock transfer", message: `${data.number} was created.`, entity: "StockTransfer", entityId: data.id, warehouseId: data.fromWarehouseId });
  res.status(201).json({ success: true, message: "Transfer created successfully", data });
}));

router.patch("/transfers/:id", requirePermission("transfers.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const input = editStatusSchema.pick({ status: true, notes: true }).parse(req.body);
  const userId = authOf(req).userId;
  const current = await prisma.stockTransfer.findUnique({ where: { id }, include: { items: true } });
  if (!current) throw new AppError(404, "Transfer not found");
  await ensureScopedWarehouse(prisma, current.fromWarehouseId, authOf(req));
  const nextStatus = input.status ?? current.status;
  if (input.status && input.status !== current.status) await ensureTransitionAllowed(current.status, input.status, ["DRAFT", "COMPLETED", "CANCELLED"]);
  if (nextStatus === "COMPLETED" && current.status !== "IN_TRANSIT") throw new AppError(409, "Transfer must be approved before completion");

  const data = await prisma.$transaction(async (tx) => {
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
  const data = await prisma.stockTransfer.update({ where: { id }, data: { status: "CANCELLED" as never }, include: { fromWarehouse: true, toWarehouse: true, items: true } });
  await notifyByPermission({ permission: "transfers.read", type: "TRANSFER_CANCELLED", title: "Transfer cancelled", message: `${data.number} was cancelled.`, entity: "StockTransfer", entityId: data.id, warehouseId: data.fromWarehouseId });
  res.json({ success: true, message: "Transfer cancelled successfully", data });
}));

router.get("/expenses", requirePermission("expenses.read"), asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const where = scopedWarehouseFilter(authOf(req));
  const [data, total] = await Promise.all([prisma.expense.findMany({ where, include: { warehouse: true, createdBy: { select: { id: true, fullName: true } } }, orderBy: { expenseDate: "desc" }, skip, take }), prisma.expense.count({ where })]);
  res.json({ success: true, data, meta: pageMeta(page, pageSize, total) });
}));

router.post("/expenses", requirePermission("expenses.write"), asyncHandler(async (req, res) => {
  const input: ExpenseInput = expenseSchema.parse(req.body);
  if (input.warehouseId) assertWarehouseAccess(authOf(req), input.warehouseId);
  const data = await prisma.expense.create({ data: { ...input, createdById: authOf(req).userId, warehouseId: input.warehouseId ?? null, description: input.description ?? null } });
  await notifyByPermission({ permission: "expenses.read", type: "EXPENSE_CREATED", title: "New expense recorded", message: `${data.number} was recorded for ${data.amount}.`, entity: "Expense", entityId: data.id, warehouseId: data.warehouseId ?? undefined });
  res.status(201).json({ success: true, message: "Expense created successfully", data });
}));

router.patch("/expenses/:id", requirePermission("expenses.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const input = expenseEditSchema.parse(req.body);
  if (input.warehouseId) await ensureWarehouse(prisma, input.warehouseId);
  const current = await prisma.expense.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "Expense not found");
  if (current.warehouseId) assertWarehouseAccess(authOf(req), current.warehouseId);
  if (input.warehouseId) assertWarehouseAccess(authOf(req), input.warehouseId);
  const data = await prisma.expense.update({ where: { id }, data: input, include: { warehouse: true, createdBy: { select: { id: true, fullName: true } } } });
  await notifyByPermission({ permission: "expenses.read", type: "EXPENSE_UPDATED", title: "Expense updated", message: `${data.number} was updated.`, entity: "Expense", entityId: data.id, warehouseId: data.warehouseId ?? undefined });
  res.json({ success: true, message: "Expense updated successfully", data });
}));

router.delete("/expenses/:id", requirePermission("expenses.delete"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const current = await prisma.expense.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "Expense not found");
  if (current.isPaid) throw new AppError(409, "Paid expenses cannot be deleted");
  await prisma.expense.delete({ where: { id } });
  await notifyByPermission({ permission: "expenses.read", type: "EXPENSE_DELETED", title: "Expense removed", message: `${current.number} was deleted.`, entity: "Expense", entityId: current.id, warehouseId: current.warehouseId ?? undefined });
  res.json({ success: true, message: "Expense deleted successfully" });
}));

router.get("/payments", requirePermission("payments.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const scope = warehouseScope(auth);
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const where = scope ? { OR: [{ purchaseOrder: { warehouseId: { in: scope } } }, { sale: { warehouseId: { in: scope } } }, { expense: { warehouseId: { in: scope } } }] } : undefined;
  const [data, total] = await Promise.all([prisma.payment.findMany({ where, include: { purchaseOrder: { select: { number: true } }, sale: { select: { number: true } }, expense: { select: { number: true } }, paidBy: { select: { fullName: true } } }, orderBy: { paymentDate: "desc" }, skip, take }), prisma.payment.count({ where })]);
  res.json({ success: true, data, meta: pageMeta(page, pageSize, total) });
}));

router.post("/payments", requirePermission("payments.write"), asyncHandler(async (req, res) => {
  const input: PaymentInput = paymentSchema.parse(req.body);
  const relationCount = [input.purchaseOrderId, input.saleId, input.expenseId].filter(Boolean).length;
  if (relationCount !== 1) throw new AppError(400, "A payment must be linked to exactly one purchase, sale, or expense");
  const data = await prisma.payment.create({ data: { ...input, paidById: authOf(req).userId, purchaseOrderId: input.purchaseOrderId ?? null, saleId: input.saleId ?? null, expenseId: input.expenseId ?? null, referenceNo: input.referenceNo ?? null, notes: input.notes ?? null } });
  await notifyByPermission({ permission: "payments.read", type: "PAYMENT_CREATED", title: "Payment recorded", message: `${data.number} was recorded as ${data.status.toLowerCase()}.`, entity: "Payment", entityId: data.id });
  res.status(201).json({ success: true, message: "Payment recorded successfully", data });
}));

router.patch("/payments/:id", requirePermission("payments.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const input = paymentEditSchema.parse(req.body);
  const data = await prisma.payment.update({ where: { id }, data: input, include: { paidBy: { select: { id: true, fullName: true } } } });
  await notifyByPermission({ permission: "payments.read", type: "PAYMENT_UPDATED", title: "Payment updated", message: `${data.number} was updated.`, entity: "Payment", entityId: data.id });
  res.json({ success: true, message: "Payment updated successfully", data });
}));

router.delete("/payments/:id", requirePermission("payments.delete"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const current = await prisma.payment.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "Payment not found");
  const data = await prisma.payment.update({ where: { id }, data: { status: "VOID" as never }, include: { paidBy: { select: { id: true, fullName: true } } } });
  await notifyByPermission({ permission: "payments.read", type: "PAYMENT_VOID", title: "Payment voided", message: `${data.number} was voided.`, entity: "Payment", entityId: data.id });
  res.json({ success: true, message: "Payment voided successfully", data });
}));

async function stockReportRows(auth: ReturnType<typeof authOf>, warehouseId?: string, productId?: string) {
  const balances = await prisma.inventoryBalance.findMany({ where: { ...scopedWarehouseFilter(auth, warehouseId), ...(productId ? { productId } : {}) }, include: { product: { select: { id: true, sku: true, barcode: true, name: true, minStock: true, maxStock: true, reorderLeadDays: true, unit: { select: { code: true } } } }, warehouse: { select: { id: true, code: true, name: true } }, location: { select: { id: true, code: true, name: true, zone: true, rack: true, shelf: true, bin: true } } }, orderBy: [{ warehouse: { name: "asc" } }, { product: { name: "asc" } }] });
  return balances.map((balance) => {
    const availableQuantity = balance.quantityOnHand - balance.reservedQuantity;
    const targetStock = balance.product.maxStock ?? balance.product.minStock * 2;
    return { ...balance, availableQuantity, isLowStock: availableQuantity <= balance.product.minStock, reorderQuantity: Math.max(targetStock - availableQuantity, balance.product.minStock) };
  });
}

router.get("/batches", requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  await updateExpiredBatches();
  const auth = authOf(req);
  const warehouseId = requestedWarehouseId(req);
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
  const rows = await prisma.productBatch.findMany({ where: { ...scopedWarehouseFilter(auth, warehouseId), ...(productId ? { productId } : {}) }, include: { product: { select: { id: true, sku: true, name: true } }, warehouse: { select: { id: true, name: true } }, location: { select: { id: true, code: true, name: true } } }, orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }] });
  res.json({ success: true, data: rows.map((row) => ({ ...row, availableQuantity: row.quantityOnHand - row.reservedQuantity, daysToExpiry: row.expiryDate ? Math.ceil((row.expiryDate.getTime() - Date.now()) / 86400000) : null })) });
}));

router.get("/expiry-report", requirePermission("reports.read"), asyncHandler(async (req, res) => {
  await updateExpiredBatches();
  const auth = authOf(req);
  const days = Math.min(Math.max(Number(req.query.days ?? 90), 1), 365);
  const until = new Date(Date.now() + days * 86400000);
  const rows = await prisma.productBatch.findMany({ where: { ...scopedWarehouseFilter(auth, requestedWarehouseId(req)), expiryDate: { lte: until }, quantityOnHand: { gt: 0 } }, include: { product: { select: { id: true, sku: true, name: true } }, warehouse: { select: { id: true, name: true } }, location: { select: { code: true, name: true } } }, orderBy: { expiryDate: "asc" } });
  res.json({ success: true, data: rows.map((row) => ({ ...row, availableQuantity: row.quantityOnHand - row.reservedQuantity, daysToExpiry: row.expiryDate ? Math.ceil((row.expiryDate.getTime() - Date.now()) / 86400000) : null })) });
}));

router.get("/reorder-suggestions", requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const rows = (await stockReportRows(auth, requestedWarehouseId(req))).filter((row) => row.isLowStock);
  res.json({ success: true, data: rows.slice(0, 100) });
}));

router.get("/inventory-analytics", requirePermission("reports.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const warehouseId = requestedWarehouseId(req);
  const rows = await stockReportRows(auth, warehouseId);
  const productRows = new Map<string, { product: typeof rows[number]["product"]; availableQuantity: number; quantityOnHand: number; reservedQuantity: number }>();
  for (const row of rows) {
    const current = productRows.get(row.productId) ?? { product: row.product, availableQuantity: 0, quantityOnHand: 0, reservedQuantity: 0 };
    current.availableQuantity += row.availableQuantity;
    current.quantityOnHand += row.quantityOnHand;
    current.reservedQuantity += row.reservedQuantity;
    productRows.set(row.productId, current);
  }
  const productIds = [...productRows.keys()];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
  const movements = productIds.length ? await prisma.stockMovement.findMany({
    where: { productId: { in: productIds }, ...scopedWarehouseFilter(auth, warehouseId) },
    select: { productId: true, movementType: true, quantity: true, occurredAt: true },
    orderBy: { occurredAt: "desc" },
  }) : [];
  const usage30Days = new Map<string, number>();
  const lastMovement = new Map<string, Date>();
  for (const movement of movements) {
    if (!lastMovement.has(movement.productId)) lastMovement.set(movement.productId, movement.occurredAt);
    if (movement.movementType === "SALE_ISSUE" && movement.occurredAt >= thirtyDaysAgo) {
      usage30Days.set(movement.productId, (usage30Days.get(movement.productId) ?? 0) + Math.abs(movement.quantity));
    }
  }
  const latestCosts = new Map<string, number>();
  await Promise.all(productIds.map(async (productId) => {
    const latest = await prisma.purchaseOrderItem.findFirst({ where: { productId, purchaseOrder: { status: { in: ["PARTIALLY_RECEIVED", "RECEIVED"] } } }, select: { unitPrice: true }, orderBy: { purchaseOrder: { orderDate: "desc" } } });
    latestCosts.set(productId, Number(latest?.unitPrice ?? 0));
  }));
  const now = Date.now();
  const products = [...productRows.entries()].map(([productId, row]) => {
    const averageDailyUsage = (usage30Days.get(productId) ?? 0) / 30;
    const unitCost = latestCosts.get(productId) ?? 0;
    const daysSinceMovement = lastMovement.get(productId) ? Math.floor((now - lastMovement.get(productId)!.getTime()) / 86_400_000) : null;
    const targetStock = row.product.maxStock ?? row.product.minStock * 2;
    const daysUntilReorder = averageDailyUsage > 0 ? Math.max(0, (row.availableQuantity - row.product.minStock) / averageDailyUsage) : null;
    const suggestedPurchaseDate = daysUntilReorder === null ? null : new Date(now + Math.max(0, daysUntilReorder - row.product.reorderLeadDays) * 86_400_000);
    return {
      productId,
      sku: row.product.sku,
      name: row.product.name,
      quantityOnHand: row.quantityOnHand,
      availableQuantity: row.availableQuantity,
      reservedQuantity: row.reservedQuantity,
      minStock: row.product.minStock,
      maxStock: row.product.maxStock,
      unitCost,
      valuation: row.quantityOnHand * unitCost,
      averageDailyUsage: Math.round(averageDailyUsage * 100) / 100,
      daysSinceMovement,
      isDeadStock: row.quantityOnHand > 0 && (daysSinceMovement === null || daysSinceMovement >= 90),
      isSlowMoving: row.quantityOnHand > 0 && averageDailyUsage > 0 && averageDailyUsage < Math.max(1, row.product.minStock / 30),
      reorderQuantity: Math.max(targetStock - row.availableQuantity, row.product.minStock),
      suggestedPurchaseDate,
    };
  }).sort((left, right) => right.valuation - left.valuation);
  const aging = [30, 60, 90].map((threshold, index, thresholds) => ({
    label: index === 0 ? `0-${threshold} days` : `${thresholds[index - 1] + 1}-${threshold} days`,
    quantity: products.filter((product) => product.daysSinceMovement !== null && product.daysSinceMovement > (thresholds[index - 1] ?? -1) && product.daysSinceMovement <= threshold).reduce((sum, product) => sum + product.quantityOnHand, 0),
  }));
  aging.push({ label: "90+ days / no movement", quantity: products.filter((product) => product.isDeadStock).reduce((sum, product) => sum + product.quantityOnHand, 0) });
  const reorder = products.filter((product) => product.availableQuantity <= product.minStock).map((product) => ({ productId: product.productId, productName: product.name, available: product.availableQuantity, targetStock: product.maxStock ?? product.minStock * 2, suggestedQuantity: product.reorderQuantity, suggestedPurchaseDate: product.suggestedPurchaseDate }));
  const deadStock = products.filter((product) => product.isDeadStock).map((product) => ({ productId: product.productId, productName: product.name, quantity: product.quantityOnHand, daysSinceMovement: product.daysSinceMovement, valuation: product.valuation }));
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const inventoryValue = products.reduce((sum, product) => sum + product.valuation, 0);
  res.json({ success: true, data: { kpis: { inventoryValue, inventoryValuation: inventoryValue, deadStockValue: deadStock.reduce((sum, product) => sum + product.valuation, 0), slowMovingCount: products.filter((product) => product.isSlowMoving).length, reorderCount: reorder.length }, products: products.slice(skip, skip + take), aging, reorder: reorder.slice(0, 100), deadStock: deadStock.slice(0, 100) }, meta: pageMeta(page, pageSize, products.length) });
}));

router.get("/stock-lookup", requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const barcode = typeof req.query.barcode === "string" ? req.query.barcode.trim() : "";
  const sku = typeof req.query.sku === "string" ? req.query.sku.trim() : "";
  if (!barcode && !sku) throw new AppError(400, "Provide a barcode or SKU");
  const product = await prisma.product.findFirst({ where: { isActive: true, OR: [barcode ? { barcode } : undefined, sku ? { sku } : undefined].filter(Boolean) as { barcode?: string; sku?: string }[] }, select: { id: true, sku: true, barcode: true, name: true, minStock: true, unit: { select: { code: true } } } });
  if (!product) throw new AppError(404, "Product not found");
  const balances = await stockReportRows(authOf(req), requestedWarehouseId(req), product.id);
  res.json({ success: true, data: { product, balances } });
}));

router.get("/warehouse-occupancy/:warehouseId", requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const warehouseId = z.uuid().parse(req.params.warehouseId);
  assertWarehouseAccess(authOf(req), warehouseId);
  const locations = await prisma.warehouseLocation.findMany({
    where: { warehouseId },
    include: { inventoryLocationBalances: { select: { productId: true, quantityOnHand: true, reservedQuantity: true } } },
    orderBy: { code: "asc" },
  });
  const data = locations.map((location) => {
    const unitsOnHand = location.inventoryLocationBalances.reduce((sum, balance) => sum + balance.quantityOnHand, 0);
    const reservedUnits = location.inventoryLocationBalances.reduce((sum, balance) => sum + balance.reservedQuantity, 0);
    return {
      id: location.id,
      code: location.code,
      name: location.name,
      zone: location.zone,
      rack: location.rack,
      shelf: location.shelf,
      bin: location.bin,
      locationType: location.locationType,
      capacity: location.capacity,
      unitsOnHand,
      reservedUnits,
      productLines: new Set(location.inventoryLocationBalances.map((balance) => balance.productId)).size,
      occupancyPercent: location.capacity && location.capacity > 0 ? Math.round((unitsOnHand / location.capacity) * 10000) / 100 : null,
    };
  });
  res.json({ success: true, data });
}));

router.post("/internal-relocations", requirePermission("inventory.relocate"), asyncHandler(async (req, res) => {
  const input = relocationSchema.parse(req.body);
  const auth = authOf(req);
  assertWarehouseAccess(auth, input.warehouseId);
  const data = await prisma.$transaction(async (tx) => {
    const [source, destination] = await Promise.all([
      tx.warehouseLocation.findFirst({ where: { id: input.fromLocationId, warehouseId: input.warehouseId, isActive: true, locationType: "STORAGE" } }),
      tx.warehouseLocation.findFirst({ where: { id: input.toLocationId, warehouseId: input.warehouseId, isActive: true, locationType: "STORAGE" } }),
    ]);
    if (!source || !destination) throw new AppError(400, "Relocation requires two active STORAGE locations in the selected warehouse");
    const relocation = await tx.stockRelocation.create({
      data: {
        number: `REL-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
        warehouseId: input.warehouseId,
        fromLocationId: source.id,
        toLocationId: destination.id,
        createdById: auth.userId,
        reason: input.reason ?? null,
      },
    });
    for (const item of input.items) {
      const outboundAllocations = await postStockOut(tx, item.productId, input.warehouseId, item.quantity, { locationId: source.id, batchId: item.batchId ?? null });
      for (const allocation of outboundAllocations) {
        const inboundAllocation = await postStockIn(tx, { productId: item.productId, warehouseId: input.warehouseId, locationId: destination.id, batchId: allocation.batchId, quantity: allocation.quantity });
        const outbound = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: input.warehouseId, quantity: -allocation.quantity, movementType: "RELOCATION_OUT", createdById: auth.userId, note: `Internal relocation ${relocation.number}: ${source.code} to ${destination.code}` } });
        const inbound = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: input.warehouseId, quantity: allocation.quantity, movementType: "RELOCATION_IN", createdById: auth.userId, note: `Internal relocation ${relocation.number}: ${source.code} to ${destination.code}` } });
        await linkMovementAllocations(tx, outbound.id, [allocation], -1);
        await linkMovementAllocations(tx, inbound.id, [inboundAllocation], 1);
        await tx.stockRelocationItem.create({ data: { relocationId: relocation.id, productId: item.productId, batchId: allocation.batchId, quantity: allocation.quantity } });
      }
    }
    const complete = await tx.stockRelocation.findUniqueOrThrow({ where: { id: relocation.id }, include: { fromLocation: { select: { code: true, name: true } }, toLocation: { select: { code: true, name: true } }, items: { include: { product: { select: { sku: true, name: true } } } } } });
    await writeAuditLog({ userId: auth.userId, action: "RELOCATE", entity: "StockRelocation", entityId: complete.id, afterData: complete }, tx as never);
    return complete;
  }, { timeout: 20_000 });
  await notifyByPermission({ permission: "inventory.read", type: "INTERNAL_RELOCATION", title: "Internal relocation completed", message: `${data.number} moved stock from ${data.fromLocation.code} to ${data.toLocation.code}.`, entity: "StockRelocation", entityId: data.id, warehouseId: input.warehouseId });
  res.status(201).json({ success: true, message: "Internal relocation completed", data });
}));

router.get("/stock-report", requirePermission("reports.read"), asyncHandler(async (req, res) => {
  const rows = await stockReportRows(authOf(req), requestedWarehouseId(req), typeof req.query.productId === "string" ? req.query.productId : undefined);
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  res.json({ success: true, data: rows.slice(skip, skip + take), meta: pageMeta(page, pageSize, rows.length) });
}));

router.get("/stock-report.csv", requirePermission("reports.read"), asyncHandler(async (req, res) => {
  const rows = await stockReportRows(authOf(req), requestedWarehouseId(req), typeof req.query.productId === "string" ? req.query.productId : undefined);
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = [
    ["SKU", "Barcode", "Product", "Warehouse", "Location", "On Hand", "Reserved", "Available", "Minimum", "Reorder Quantity", "Health"].map(escape).join(","),
    ...rows.map((row) => [row.product.sku, row.product.barcode, row.product.name, row.warehouse.name, row.location?.code ?? "", row.quantityOnHand, row.reservedQuantity, row.availableQuantity, row.product.minStock, row.reorderQuantity, row.isLowStock ? "LOW_STOCK" : "HEALTHY"].map(escape).join(",")),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="stock-report-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`\uFEFF${lines.join("\n")}`);
}));

export default router;
