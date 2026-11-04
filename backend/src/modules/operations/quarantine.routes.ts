import { Router } from "express";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "../../lib/prisma.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess, scopedWarehouseFilter } from "../../rbac/warehouse-scope.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { assertApprovalAuthority } from "../approvals/approval-policy.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { lockCostBalance } from "./costing.service.ts";
import { ensureLocationBalance, linkMovementAllocations } from "./stock-allocation.service.ts";
import { assertInventoryInvariant } from "./inventory-invariant.service.ts";
const router = Router();
const detail = { source: { include: { product: { select: { name: true, sku: true } }, location: true, warehouse: { select: { name: true } }, batch: true } }, destination: true, createdBy: { select: { fullName: true } }, approvedBy: { select: { fullName: true } } } as const;
router.get("/quarantine", requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req); const warehouseId = typeof req.query.warehouseId === "string" ? z.uuid().parse(req.query.warehouseId) : undefined;
  const scope = scopedWarehouseFilter(auth, warehouseId);
  const rows = await prisma.inventoryLocationBalance.findMany({ where: { ...scope, quantityOnHand: { gt: 0 }, location: { locationType: { in: ["QUARANTINE", "DAMAGED"] } } }, include: { product: { select: { sku: true, name: true } }, location: { select: { code: true, name: true } }, warehouse: { select: { name: true } }, batch: { select: { batchNumber: true, expiryDate: true, status: true } } }, orderBy: { updatedAt: "desc" }, take: 100 });
  const decisions = await prisma.quarantineDecision.findMany({ where: { source: scope }, include: detail, orderBy: { createdAt: "desc" }, take: 100 });
  const locations = await prisma.warehouseLocation.findMany({ where: { ...scope, isActive: true, locationType: "STORAGE" }, select: { id: true, warehouseId: true, code: true, name: true } });
  const purchaseSources = auth.permissions.includes("purchases.read") ? await prisma.purchaseOrderItem.findMany({ where: { receivedQuantity: { gt: 0 }, purchaseOrder: scope, productId: { in: [...new Set(rows.map((row) => row.productId))] } }, select: { id: true, productId: true, purchaseOrder: { select: { number: true, warehouseId: true } } }, take: 200, orderBy: { purchaseOrder: { orderDate: "desc" } } }) : [];
  res.json({ success: true, data: { rows, decisions, locations, purchaseSources, limit: 100 } });
}));
router.post("/quarantine", requirePermission("inventory.write"), asyncHandler(async (req, res) => {
  const input = z.object({ locationBalanceId: z.uuid(), destinationLocationId: z.uuid().nullable().optional(), purchaseOrderItemId: z.uuid().nullable().optional(), quantity: z.number().int().positive(), action: z.enum(["RELEASE", "SCRAP", "RETURN_SUPPLIER"]), reason: z.string().trim().min(10).max(1000) }).strict().parse(req.body);
  const auth = authOf(req); const source = await prisma.inventoryLocationBalance.findUnique({ where: { id: input.locationBalanceId }, include: { location: true } });
  if (!source) throw new AppError(404, "Quarantine balance not found"); assertWarehouseAccess(auth, source.warehouseId);
  if (!["QUARANTINE", "DAMAGED"].includes(source.location.locationType)) throw new AppError(400, "Only quarantine or damaged locations can use this workflow");
  if (input.quantity > source.quantityOnHand - source.reservedQuantity) throw new AppError(409, "Quantity exceeds unreserved quarantine stock");
  if (input.action === "RELEASE" && !input.destinationLocationId) throw new AppError(400, "Choose an active storage destination");
  if (input.action === "RETURN_SUPPLIER" && (!input.purchaseOrderItemId || !auth.permissions.includes("purchase-returns.write") || !auth.permissions.includes("purchases.read"))) throw new AppError(403, "Supplier return requires source purchase and purchase-return write permission");
  const data = await prisma.$transaction(async (tx) => { const row = await tx.quarantineDecision.create({ data: { ...input, destinationLocationId: input.action === "RELEASE" ? input.destinationLocationId : null, purchaseOrderItemId: input.action === "RETURN_SUPPLIER" ? input.purchaseOrderItemId : null, createdById: auth.userId } }); await writeAuditLog({ userId: auth.userId, action: "QUARANTINE_REQUEST", entity: "QuarantineDecision", entityId: row.id, afterData: row }, tx as never); return row; });
  await notifyByPermission({ permission: "adjustments.approve", type: "QUARANTINE_REVIEW", title: "Quarantine decision awaiting review", message: `${input.action}: ${input.quantity} units.`, entity: "QuarantineDecision", entityId: data.id, warehouseId: source.warehouseId });
  res.status(201).json({ success: true, data });
}));
router.post("/quarantine/:id/review", requirePermission("adjustments.approve"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id); const input = z.object({ approve: z.boolean(), notes: z.string().trim().min(10).max(1000) }).strict().parse(req.body); const auth = authOf(req);
  const snapshot = await prisma.quarantineDecision.findUnique({ where: { id }, include: { purchaseOrderItem: true } }); if (!snapshot) throw new AppError(404, "Decision not found");
  const data = await prisma.$transaction(async (tx) => {
    if (snapshot.purchaseOrderItem) await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${snapshot.purchaseOrderItem.purchaseOrderId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "QuarantineDecision" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const doc = await tx.quarantineDecision.findUniqueOrThrow({ where: { id }, include: detail });
    assertWarehouseAccess(auth, doc.source.warehouseId);
    if (doc.status !== "PENDING") throw new AppError(409, "Decision has already been reviewed");
    if (doc.createdById === auth.userId) throw new AppError(403, "Creator cannot review their own quarantine decision");
    const balance = await lockCostBalance(tx, doc.source.productId, doc.source.warehouseId);
    const policyValue = balance.averageUnitCost?.mul(doc.quantity) ?? null;
    if (policyValue === null && auth.roleCode !== "ADMIN") throw new AppError(409, "Opening cost must be recorded before applying approval amount limits");
    await assertApprovalAuthority(tx, "ADJUSTMENT", Number(policyValue ?? 0), auth, doc.createdById);
    if (!input.approve) {
      const data = await tx.quarantineDecision.update({ where: { id }, data: { status: "REJECTED", approvedById: auth.userId, reviewedAt: new Date(), reviewNotes: input.notes } });
      await writeAuditLog({ userId: auth.userId, action: "QUARANTINE_REJECT", entity: "QuarantineDecision", entityId: id, afterData: data }, tx as never); return data;
    }
    if (!doc.source.location.isActive || !["QUARANTINE", "DAMAGED"].includes(doc.source.location.locationType)) throw new AppError(409, "Source location is no longer eligible");
    if (doc.action === "RETURN_SUPPLIER" && !auth.permissions.includes("purchase-returns.approve")) throw new AppError(403, "Purchase-return approval permission is required");
    if (doc.source.batchId) await tx.$queryRaw`SELECT "id" FROM "ProductBatch" WHERE "id" = ${doc.source.batchId}::uuid FOR UPDATE`;
    const batch = doc.source.batchId ? await tx.productBatch.findUniqueOrThrow({ where: { id: doc.source.batchId } }) : null;
    if (doc.action === "RELEASE" && batch && (batch.status === "EXPIRED" || (batch.expiryDate && batch.expiryDate <= new Date()) || (batch.status === "QUARANTINED" && (batch.quantityOnHand !== doc.quantity || batch.reservedQuantity !== 0)))) throw new AppError(409, "Expired batch cannot be released; a globally quarantined batch must be reviewed in full and unreserved");
    const changed = await tx.$queryRaw<Array<{ id: string }>>`UPDATE "InventoryLocationBalance" SET "quantityOnHand"="quantityOnHand"-${doc.quantity}, "updatedAt"=NOW() WHERE "id"=${doc.locationBalanceId}::uuid AND "quantityOnHand"-"reservedQuantity">=${doc.quantity} RETURNING "id"`;
    if (changed.length !== 1) throw new AppError(409, "Quarantine stock changed; reload and review again");
    let returnOrderId: string | null = null;
    if (doc.action === "RELEASE") {
      const location = await tx.warehouseLocation.findFirst({ where: { id: doc.destinationLocationId!, warehouseId: doc.source.warehouseId, isActive: true, locationType: "STORAGE" } });
      if (!location) throw new AppError(400, "Destination must be active storage in the same warehouse");
      const destination = await ensureLocationBalance(tx, { productId: doc.source.productId, warehouseId: doc.source.warehouseId, locationId: location.id, batchId: doc.source.batchId });
      await tx.inventoryLocationBalance.update({ where: { id: destination.id }, data: { quantityOnHand: { increment: doc.quantity } } });
      if (batch && batch.status !== "ACTIVE") await tx.productBatch.update({ where: { id: batch.id }, data: { status: "ACTIVE" } });
      for (const sign of [-1, 1] as const) { const movement = await tx.stockMovement.create({ data: { productId: doc.source.productId, warehouseId: doc.source.warehouseId, quantity: doc.quantity * sign, movementType: sign === -1 ? "RELOCATION_OUT" : "RELOCATION_IN", createdById: auth.userId, note: `Quarantine release ${id}: ${input.notes}` } }); await linkMovementAllocations(tx, movement.id, [{ locationBalanceId: sign === -1 ? doc.locationBalanceId : destination.id, locationId: sign === -1 ? doc.source.locationId : location.id, batchId: doc.source.batchId, quantity: doc.quantity, unitCost: balance.averageUnitCost }], sign); }
    } else {
      if (doc.action === "RETURN_SUPPLIER") {
        const source = await tx.purchaseOrderItem.findUnique({ where: { id: doc.purchaseOrderItemId! }, include: { purchaseOrder: true } });
        if (!source || source.productId !== doc.source.productId || source.purchaseOrder.warehouseId !== doc.source.warehouseId) throw new AppError(400, "Purchase source must match product and warehouse");
        await assertApprovalAuthority(tx, "RETURN", source.unitPrice.mul(doc.quantity).toNumber(), auth, doc.createdById);
        const receipts = await tx.goodsReceiptItem.aggregate({ where: { purchaseOrderItemId: source.id, ...(doc.source.batchId ? { batchId: doc.source.batchId } : {}), goodsReceipt: { status: "POSTED" } }, _sum: { quantity: true, damagedQuantity: true } });
        const previous = await tx.returnOrderItem.aggregate({ where: { purchaseOrderItemId: source.id, ...(doc.source.batchId ? { batchId: doc.source.batchId } : {}), returnOrder: { status: { in: ["APPROVED", "POSTED"] } } }, _sum: { quantity: true } });
        if (doc.quantity + (previous._sum.quantity ?? 0) > (receipts._sum.quantity ?? 0) + (receipts._sum.damagedQuantity ?? 0)) throw new AppError(409, "Supplier return exceeds documented receipts remaining for this purchase/batch");
        const allPrevious = await tx.returnOrderItem.aggregate({ where: { purchaseOrderItemId: source.id, returnOrder: { status: { in: ["APPROVED", "POSTED"] } } }, _sum: { quantity: true } });
        if (doc.quantity + (allPrevious._sum.quantity ?? 0) > source.receivedQuantity) throw new AppError(409, "Supplier returns exceed total received quantity");
        const ret = await tx.returnOrder.create({ data: { number: `PR-Q-${id.slice(0, 8).toUpperCase()}`, type: "PURCHASE", purchaseOrderId: source.purchaseOrderId, warehouseId: doc.source.warehouseId, createdById: doc.createdById, approvedById: auth.userId, status: "POSTED", reason: doc.reason, notes: input.notes, approvedAt: new Date(), postedAt: new Date(), items: { create: { productId: doc.source.productId, purchaseOrderItemId: source.id, locationId: doc.source.locationId, batchId: doc.source.batchId, quantity: doc.quantity, condition: batch?.expiryDate && batch.expiryDate <= new Date() ? "EXPIRED" : "DAMAGED", disposition: "RESTOCK", notes: "Outbound quarantine return to supplier" } } } }); returnOrderId = ret.id;
        await writeAuditLog({ userId: auth.userId, action: "POST", entity: "ReturnOrder", entityId: ret.id, afterData: ret }, tx as never);
      }
      const agg = await tx.inventoryBalance.updateMany({ where: { id: balance.id, quantityOnHand: { gte: doc.quantity + balance.reservedQuantity } }, data: { quantityOnHand: { decrement: doc.quantity } } }); if (agg.count !== 1) throw new AppError(409, "Warehouse balance changed");
      if (batch) { const updated = await tx.productBatch.updateMany({ where: { id: batch.id, quantityOnHand: { gte: doc.quantity + batch.reservedQuantity } }, data: { quantityOnHand: { decrement: doc.quantity }, ...(batch.quantityOnHand === doc.quantity ? { status: "DEPLETED" as const } : {}) } }); if (updated.count !== 1) throw new AppError(409, "Batch stock changed"); }
      const movement = await tx.stockMovement.create({ data: { productId: doc.source.productId, warehouseId: doc.source.warehouseId, quantity: -doc.quantity, movementType: doc.action === "SCRAP" ? "ADJUSTMENT_OUT" : "PURCHASE_RETURN", returnOrderId, createdById: auth.userId, note: `Quarantine ${doc.action} ${id}: ${input.notes}` } });
      await linkMovementAllocations(tx, movement.id, [{ locationBalanceId: doc.locationBalanceId, locationId: doc.source.locationId, batchId: doc.source.batchId, quantity: doc.quantity, unitCost: balance.averageUnitCost }], -1);
    }
    await assertInventoryInvariant(tx, doc.source.productId, doc.source.warehouseId);
    const updated = await tx.quarantineDecision.update({ where: { id }, data: { status: "APPROVED", approvedById: auth.userId, reviewedAt: new Date(), reviewNotes: input.notes, returnOrderId } });
    await writeAuditLog({ userId: auth.userId, action: "QUARANTINE_APPROVE", entity: "QuarantineDecision", entityId: id, afterData: updated }, tx as never);
    return updated;
  }, { timeout: 20000 });
  const source = await prisma.inventoryLocationBalance.findUniqueOrThrow({ where: { id: data.locationBalanceId }, select: { warehouseId: true } });
  await notifyByPermission({ permission: "inventory.read", type: "QUARANTINE_REVIEWED", title: "Quarantine decision reviewed", message: `${data.action}: ${data.quantity} units · ${data.status}.`, entity: "QuarantineDecision", entityId: data.id, warehouseId: source.warehouseId });
  res.json({ success: true, data });
}));
export default router;
