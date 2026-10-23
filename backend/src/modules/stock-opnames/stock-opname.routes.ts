import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess, scopedWarehouseFilter } from "../../rbac/warehouse-scope.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { AppError } from "../../utils/AppError.ts";
import { postStockIn, postStockOut, linkMovementAllocations } from "../operations/stock-allocation.service.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { assertApprovalAuthority } from "../approvals/approval-policy.service.ts";

const router = Router();
const idSchema = z.uuid();
const createSchema = z.object({
  number: z.string().trim().min(3).max(40),
  warehouseId: z.uuid(),
  notes: z.string().trim().max(1000).nullable().optional(),
  productIds: z.array(z.uuid()).max(500).optional(),
}).strict();
const countSchema = z.object({ physicalQuantity: z.coerce.number().int().min(0), notes: z.string().trim().max(500).nullable().optional() }).strict();

const detailInclude = {
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  lines: { include: { product: { select: { id: true, sku: true, barcode: true, name: true, minStock: true, unit: { select: { code: true } } } } }, orderBy: { product: { name: "asc" } } },
} as const;

router.get("/", requirePermission("stock-opnames.read"), asyncHandler(async (req, res) => {
  const data = await prisma.stockTakeSession.findMany({ where: scopedWarehouseFilter(authOf(req)), include: detailInclude, orderBy: { startedAt: "desc" } });
  res.json({ success: true, data });
}));

router.get("/:id", requirePermission("stock-opnames.read"), asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const data = await prisma.stockTakeSession.findUnique({ where: { id }, include: detailInclude });
  if (!data) throw new AppError(404, "Stock opname session not found");
  assertWarehouseAccess(authOf(req), data.warehouseId);
  res.json({ success: true, data });
}));

router.post("/", requirePermission("stock-opnames.write"), asyncHandler(async (req, res) => {
  const input = createSchema.parse(req.body);
  const auth = authOf(req);
  assertWarehouseAccess(auth, input.warehouseId);
  const userId = auth.userId;
  const data = await prisma.$transaction(async (tx) => {
    const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId }, select: { id: true, isActive: true } });
    if (!warehouse?.isActive) throw new AppError(400, "Warehouse is invalid or inactive");
    const balances = await tx.inventoryBalance.findMany({
      where: { warehouseId: input.warehouseId, ...(input.productIds?.length ? { productId: { in: input.productIds } } : {}) },
      select: { productId: true, quantityOnHand: true },
    });
    const products = input.productIds?.length
      ? await tx.product.findMany({ where: { id: { in: input.productIds }, isActive: true }, select: { id: true } })
      : await tx.product.findMany({ where: { isActive: true }, select: { id: true } });
    const balanceMap = new Map(balances.map((row) => [row.productId, row.quantityOnHand]));
    const session = await tx.stockTakeSession.create({
      data: {
        number: input.number,
        warehouseId: input.warehouseId,
        createdById: userId,
        status: "COUNTING",
        notes: input.notes ?? null,
        lines: { create: products.map((product) => ({ productId: product.id, systemQuantity: balanceMap.get(product.id) ?? 0 })) },
      },
      include: detailInclude,
    });
    await writeAuditLog({ userId, action: "CREATE", entity: "StockTakeSession", entityId: session.id, afterData: session }, tx as never);
    return session;
  });
  await notifyByPermission({ permission: "stock-opnames.read", type: "STOCK_TAKE_CREATED", title: "Stock opname started", message: `${data.number} is ready for counting.`, entity: "StockTakeSession", entityId: data.id, warehouseId: data.warehouseId });
  res.status(201).json({ success: true, message: "Stock opname session created", data });
}));

router.patch("/:id/lines/:lineId", requirePermission("stock-opnames.write"), asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const lineId = idSchema.parse(req.params.lineId);
  const input = countSchema.parse(req.body);
  const userId = authOf(req).userId;
  const session = await prisma.stockTakeSession.findUnique({ where: { id }, select: { status: true, warehouseId: true } });
  if (!session) throw new AppError(404, "Stock opname session not found");
  assertWarehouseAccess(authOf(req), session.warehouseId);
  if (!["COUNTING", "DRAFT"].includes(session.status)) throw new AppError(409, "This session is no longer countable");
  const line = await prisma.stockTakeLine.findFirst({ where: { id: lineId, sessionId: id } });
  if (!line) throw new AppError(404, "Stock opname line not found");
  const updated = await prisma.stockTakeLine.update({ where: { id: lineId }, data: { physicalQuantity: input.physicalQuantity, variance: input.physicalQuantity - line.systemQuantity, notes: input.notes ?? null, countedAt: new Date() }, include: { product: { select: { sku: true, name: true } } } });
  await writeAuditLog({ userId, action: "COUNT", entity: "StockTakeLine", entityId: lineId, beforeData: line, afterData: updated });
  await notifyByPermission({ permission: "stock-opnames.read", type: "STOCK_TAKE_COUNTED", title: "Stock opname count updated", message: `${updated.product.name} count was recorded.`, entity: "StockTakeLine", entityId: updated.id, warehouseId: session.warehouseId });
  res.json({ success: true, data: updated });
}));

router.post("/:id/submit", requirePermission("stock-opnames.write"), asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const userId = authOf(req).userId;
  const data = await prisma.$transaction(async (tx) => {
    const session = await tx.stockTakeSession.findUnique({ where: { id }, include: { lines: true } });
    if (!session) throw new AppError(404, "Stock opname session not found");
    assertWarehouseAccess(authOf(req), session.warehouseId);
    if (session.status !== "COUNTING") throw new AppError(409, "Only counting sessions can be submitted");
    if (session.lines.some((line) => line.physicalQuantity === null)) throw new AppError(400, "Every product line must be counted before submission");
    const updated = await tx.stockTakeSession.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date() }, include: detailInclude });
    await writeAuditLog({ userId, action: "SUBMIT", entity: "StockTakeSession", entityId: id, beforeData: session, afterData: updated }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "stock-opnames.read", type: "STOCK_TAKE_SUBMITTED", title: "Stock opname submitted", message: `${data.number} is waiting for approval.`, entity: "StockTakeSession", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Stock opname submitted for approval", data });
}));

router.post("/:id/approve", requirePermission("stock-opnames.approve"), asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const auth = authOf(req);
  const userId = auth.userId;
  const data = await prisma.$transaction(async (tx) => {
    const session = await tx.stockTakeSession.findUnique({ where: { id }, include: { lines: true } });
    if (!session) throw new AppError(404, "Stock opname session not found");
    assertWarehouseAccess(authOf(req), session.warehouseId);
    if (session.status !== "SUBMITTED") throw new AppError(409, "Only submitted sessions can be approved");
    let varianceValue = 0;
    for (const line of session.lines) {
      const latestCost = await tx.purchaseOrderItem.findFirst({
        where: { productId: line.productId, purchaseOrder: { status: { in: ["PARTIALLY_RECEIVED", "RECEIVED"] } } },
        select: { unitPrice: true },
        orderBy: { purchaseOrder: { orderDate: "desc" } },
      });
      varianceValue += Math.abs((line.physicalQuantity ?? line.systemQuantity) - line.systemQuantity) * Number(latestCost?.unitPrice ?? 0);
    }
    await assertApprovalAuthority(tx, "STOCK_OPNAME", varianceValue, auth, session.createdById);
    for (const line of session.lines) {
      const variance = (line.physicalQuantity ?? line.systemQuantity) - line.systemQuantity;
      if (!variance) continue;
      const product = await tx.product.findUnique({ where: { id: line.productId }, select: { trackBatch: true } });
      const batch = product?.trackBatch ? await tx.productBatch.findFirst({ where: { productId: line.productId, warehouseId: session.warehouseId, status: "ACTIVE" }, orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }] }) : null;
      if (product?.trackBatch && !batch) throw new AppError(409, `Batch allocation is required for stock opname variance of ${line.productId}`);
      const locationId = batch?.locationId ?? (await tx.warehouseLocation.findFirst({ where: { warehouseId: session.warehouseId, isActive: true }, orderBy: { code: "asc" } }))?.id;
      const allocations = variance > 0
        ? [await postStockIn(tx, { productId: line.productId, warehouseId: session.warehouseId, locationId, batchId: batch?.id ?? null, quantity: variance })]
        : await postStockOut(tx, line.productId, session.warehouseId, Math.abs(variance));
      const movement = await tx.stockMovement.create({ data: { productId: line.productId, warehouseId: session.warehouseId, quantity: variance, movementType: variance > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", createdById: userId, note: `Stock opname ${session.number}` } });
      await linkMovementAllocations(tx, movement.id, allocations, variance > 0 ? 1 : -1);
    }
    const updated = await tx.stockTakeSession.update({ where: { id }, data: { status: "APPROVED", approvedById: userId, approvedAt: new Date() }, include: detailInclude });
    await writeAuditLog({ userId, action: "APPROVE", entity: "StockTakeSession", entityId: id, beforeData: session, afterData: updated }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "stock-opnames.read", type: "STOCK_TAKE_APPROVED", title: "Stock opname approved", message: `${data.number} was approved and inventory was adjusted.`, entity: "StockTakeSession", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Stock opname approved and inventory adjusted", data });
}));

export default router;
