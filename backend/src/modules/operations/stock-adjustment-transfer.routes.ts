import { Router } from "express";
import { Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "../../lib/prisma.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess, scopedWarehouseFilter, warehouseScope } from "../../rbac/warehouse-scope.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { linkMovementAllocations, postStockIn, postStockOut } from "./stock-allocation.service.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { pageMeta, pagination } from "../../utils/pagination.ts";
import { ensureProducts, ensureWarehouse, ensureScopedWarehouse, ensureLocation, ensureReceiptBatch, moveStock, validateRevisionLocations } from "./transaction-domain.service.ts";
import { adjustmentEditSchema, adjustmentListQuerySchema, adjustmentSchema, transactionIdParamsSchema, transferEditSchema, transferListQuerySchema, transferSchema, type AdjustmentInput, type TransferInput } from "./operations.validation.ts";
import { dateRange } from "./transaction-query.ts";
import { ensureTransitionAllowed } from "./transaction-support.service.ts";
import { approveAdjustment } from "./stock-adjustment.service.ts";
import { approveTransfer } from "./stock-transfer.service.ts";

const router = Router();
router.get("/adjustments", requirePermission("adjustments.read"), asyncHandler(async (req, res) => {
  const query = adjustmentListQuerySchema.parse(req.query);
  const { page, pageSize, skip, take } = pagination(query);
  const { search, status } = query;
  const clauses: Prisma.StockAdjustmentWhereInput[] = [];
  const base = scopedWarehouseFilter(authOf(req));
  if (base) clauses.push(base);
  if (search) clauses.push({ OR: [{ number: { contains: search, mode: "insensitive" } }, { reason: { contains: search, mode: "insensitive" } }, { items: { some: { product: { OR: [{ name: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] } } } }] });
  if (status) clauses.push({ status });
  const dates = dateRange(query, "adjustmentDate"); if (dates) clauses.push(dates);
  const where = clauses.length ? { AND: clauses } : undefined;
  const [data, total] = await Promise.all([prisma.stockAdjustment.findMany({ where, include: { warehouse: true, createdBy: { select: { id: true, fullName: true } }, approvedBy: { select: { id: true, fullName: true } }, items: { include: { product: { select: { id: true, sku: true, name: true } } } } }, orderBy: { adjustmentDate: "desc" }, skip, take }), prisma.stockAdjustment.count({ where })]);
  res.json({ success: true, data, meta: pageMeta(page, pageSize, total) });
}));

router.post("/adjustments/:id/approve", requirePermission("adjustments.approve"), asyncHandler(async (req, res) => {
  const data = await approveAdjustment(transactionIdParamsSchema.parse(req.params).id, authOf(req).userId, authOf(req));
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
    await writeAuditLog({ userId, action: "CREATE", entity: "StockAdjustment", entityId: adjustment.id, afterData: adjustment, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    return adjustment;
  });
  await notifyByPermission({ permission: "adjustments.read", type: "ADJUSTMENT_CREATED", title: "New stock adjustment", message: `${data.number} was created for ${data.warehouse.name}.`, entity: "StockAdjustment", entityId: data.id, warehouseId: data.warehouseId });
  res.status(201).json({ success: true, message: "Adjustment created successfully", data });
}));

router.post("/adjustments/:id/revise", requirePermission("adjustments.write"), asyncHandler(async (req, res) => {
  const id = transactionIdParamsSchema.parse(req.params).id; const input = adjustmentSchema.parse(req.body); const auth = authOf(req);
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
  const id = transactionIdParamsSchema.parse(req.params).id;
  const input = adjustmentEditSchema.parse(req.body);
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
    const updated = await tx.stockAdjustment.update({ where: { id }, data: { status: nextStatus as never }, include: { warehouse: true, items: true } });
    if (input.status !== undefined) await writeAuditLog({ userId, action: "UPDATE", entity: "StockAdjustment", entityId: id, beforeData: current, afterData: updated, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "adjustments.read", type: "ADJUSTMENT_STATUS", title: "Adjustment status updated", message: `${data.number} is now ${data.status.toLowerCase()}.`, entity: "StockAdjustment", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Adjustment updated successfully", data });
}));

router.delete("/adjustments/:id", requirePermission("adjustments.delete"), asyncHandler(async (req, res) => {
  const id = transactionIdParamsSchema.parse(req.params).id;
  const auth = authOf(req);
  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StockAdjustment" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const current = await tx.stockAdjustment.findUnique({ where: { id }, include: { warehouse: true, items: true } });
    if (!current) throw new AppError(404, "Adjustment not found");
    assertWarehouseAccess(auth, current.warehouseId);
    if (["POSTED", "CANCELLED"].includes(current.status)) throw new AppError(409, "A posted or cancelled adjustment cannot be deleted");
    const changed = await tx.stockAdjustment.updateMany({ where: { id, status: current.status }, data: { status: "CANCELLED" } });
    if (changed.count !== 1) throw new AppError(409, "Adjustment changed; reload before cancelling");
    const updated = await tx.stockAdjustment.findUniqueOrThrow({ where: { id }, include: { warehouse: true, items: true } });
    await writeAuditLog({ userId: auth.userId, action: "CANCEL", entity: "StockAdjustment", entityId: id, beforeData: current, afterData: updated, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "adjustments.read", type: "ADJUSTMENT_CANCELLED", title: "Adjustment cancelled", message: `${data.number} was cancelled.`, entity: "StockAdjustment", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Adjustment cancelled successfully", data });
}));

router.get("/transfers", requirePermission("transfers.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const scope = warehouseScope(auth);
  const query = transferListQuerySchema.parse(req.query);
  const { page, pageSize, skip, take } = pagination(query);
  const { search, status } = query;
  const clauses: Prisma.StockTransferWhereInput[] = [];
  if (scope) clauses.push({ OR: [{ fromWarehouseId: { in: scope } }, { toWarehouseId: { in: scope } }] });
  if (search) clauses.push({ OR: [{ number: { contains: search, mode: "insensitive" } }, { fromWarehouse: { name: { contains: search, mode: "insensitive" } } }, { toWarehouse: { name: { contains: search, mode: "insensitive" } } }, { items: { some: { product: { OR: [{ name: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] } } } }] });
  if (status) clauses.push({ status });
  const dates = dateRange(query, "transferDate"); if (dates) clauses.push(dates);
  const where = clauses.length ? { AND: clauses } : undefined;
  const [data, total] = await Promise.all([prisma.stockTransfer.findMany({ where, include: { fromWarehouse: true, toWarehouse: true, createdBy: { select: { id: true, fullName: true } }, approvedBy: { select: { id: true, fullName: true } }, items: { include: { product: { select: { id: true, sku: true, name: true } } } } }, orderBy: { transferDate: "desc" }, skip, take }), prisma.stockTransfer.count({ where })]);
  res.json({ success: true, data, meta: pageMeta(page, pageSize, total) });
}));

router.post("/transfers/:id/approve", requirePermission("transfers.approve"), asyncHandler(async (req, res) => {
  const data = await approveTransfer(transactionIdParamsSchema.parse(req.params).id, authOf(req).userId, authOf(req));
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
    await writeAuditLog({ userId, action: "CREATE", entity: "StockTransfer", entityId: transfer.id, afterData: transfer, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    return transfer;
  });
  await notifyByPermission({ permission: "transfers.read", type: "TRANSFER_CREATED", title: "New stock transfer", message: `${data.number} was created.`, entity: "StockTransfer", entityId: data.id, warehouseId: data.fromWarehouseId });
  res.status(201).json({ success: true, message: "Transfer created successfully", data });
}));

router.post("/transfers/:id/revise", requirePermission("transfers.write"), asyncHandler(async (req, res) => {
  const id = transactionIdParamsSchema.parse(req.params).id; const input = transferSchema.parse(req.body); const auth = authOf(req);
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
  const id = transactionIdParamsSchema.parse(req.params).id;
  const input = transferEditSchema.parse(req.body);
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
    const updated = await tx.stockTransfer.update({ where: { id }, data: { status: nextStatus as never, notes: input.notes }, include: { fromWarehouse: true, toWarehouse: true, items: true } });
    if (input.status !== undefined || input.notes !== undefined) await writeAuditLog({ userId, action: "UPDATE", entity: "StockTransfer", entityId: id, beforeData: current, afterData: updated, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "transfers.read", type: "TRANSFER_STATUS", title: "Transfer status updated", message: `${data.number} is now ${data.status.toLowerCase()}.`, entity: "StockTransfer", entityId: data.id, warehouseId: data.fromWarehouseId });
  res.json({ success: true, message: "Transfer updated successfully", data });
}));

router.delete("/transfers/:id", requirePermission("transfers.delete"), asyncHandler(async (req, res) => {
  const id = transactionIdParamsSchema.parse(req.params).id;
  const auth = authOf(req);
  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StockTransfer" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const current = await tx.stockTransfer.findUnique({ where: { id }, include: { fromWarehouse: true, toWarehouse: true, items: true } });
    if (!current) throw new AppError(404, "Transfer not found");
    assertWarehouseAccess(auth, current.fromWarehouseId);
    if (["COMPLETED", "CANCELLED"].includes(current.status)) throw new AppError(409, "A completed or cancelled transfer cannot be deleted");
    const changed = await tx.stockTransfer.updateMany({ where: { id, status: current.status }, data: { status: "CANCELLED" } });
    if (changed.count !== 1) throw new AppError(409, "Transfer changed; reload before cancelling");
    const updated = await tx.stockTransfer.findUniqueOrThrow({ where: { id }, include: { fromWarehouse: true, toWarehouse: true, items: true } });
    await writeAuditLog({ userId: auth.userId, action: "CANCEL", entity: "StockTransfer", entityId: id, beforeData: current, afterData: updated, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "transfers.read", type: "TRANSFER_CANCELLED", title: "Transfer cancelled", message: `${data.number} was cancelled.`, entity: "StockTransfer", entityId: data.id, warehouseId: data.fromWarehouseId });
  res.json({ success: true, message: "Transfer cancelled successfully", data });
}));

export default router;
