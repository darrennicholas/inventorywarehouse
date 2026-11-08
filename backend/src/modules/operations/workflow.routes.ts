import { Router } from "express";
import { z } from "zod";
import type { Prisma, ApprovalSubject } from "../../generated/prisma/client.ts";
import { prisma } from "../../lib/prisma.ts";
import { authOf } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess, warehouseScope } from "../../rbac/warehouse-scope.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { AppError } from "../../utils/AppError.ts";
import { assertApprovalAuthority } from "../approvals/approval-policy.service.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";

const router = Router();
const paramsSchema = z.object({ kind: z.enum(["purchases", "sales", "adjustments", "transfers", "returns", "opnames"]), id: z.uuid() });
type Kind = z.infer<typeof paramsSchema>["kind"];
type Document = { id: string; number: string; warehouseId: string; destinationWarehouseId?: string; createdById: string; status: string; entity: string; permission: string; subject?: ApprovalSubject; amount: number | null };

async function stockValue(tx: Prisma.TransactionClient, items: { productId: string; quantity: number }[], warehouseId: string) {
  let total = 0;
  for (const item of items) {
    if (!item.quantity) continue;
    const cost = await tx.inventoryBalance.findUnique({ where: { productId_warehouseId: { productId: item.productId, warehouseId } }, select: { averageUnitCost: true } });
    if (cost?.averageUnitCost == null) return null;
    total += Math.abs(item.quantity) * Number(cost.averageUnitCost);
  }
  return total;
}

async function documentFor(tx: Prisma.TransactionClient, kind: Kind, id: string): Promise<Document> {
  if (kind === "sales") {
    const row = await tx.sale.findUnique({ where: { id } });
    if (!row) throw new AppError(404, "Sale not found");
    return { ...row, entity: "Sale", permission: "sales", amount: Number(row.total) };
  }
  if (kind === "purchases") {
    const row = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!row) throw new AppError(404, "Purchase not found");
    return { ...row, entity: "PurchaseOrder", permission: "purchases", subject: "PURCHASE", amount: Number(row.total) };
  }
  if (kind === "adjustments") {
    const row = await tx.stockAdjustment.findUnique({ where: { id }, include: { items: true } });
    if (!row) throw new AppError(404, "Adjustment not found");
    return { ...row, entity: "StockAdjustment", permission: "adjustments", subject: "ADJUSTMENT", amount: await stockValue(tx, row.items, row.warehouseId) };
  }
  if (kind === "transfers") {
    const row = await tx.stockTransfer.findUnique({ where: { id } });
    if (!row) throw new AppError(404, "Transfer not found");
    return { ...row, warehouseId: row.fromWarehouseId, destinationWarehouseId: row.toWarehouseId, entity: "StockTransfer", permission: "transfers", amount: 0 };
  }
  if (kind === "returns") {
    const row = await tx.returnOrder.findUnique({ where: { id }, include: { items: { include: { purchaseOrderItem: { select: { unitPrice: true } }, saleItem: { select: { unitPrice: true } } } } } });
    if (!row) throw new AppError(404, "Return not found");
    const amount = row.items.reduce((sum, item) => sum + item.quantity * Number(item.purchaseOrderItem?.unitPrice ?? item.saleItem?.unitPrice ?? 0), 0);
    return { ...row, entity: "ReturnOrder", permission: row.type === "PURCHASE" ? "purchase-returns" : "sales-returns", subject: "RETURN", amount };
  }
  const row = await tx.stockTakeSession.findUnique({ where: { id }, include: { lines: true } });
  if (!row) throw new AppError(404, "Stock opname not found");
  return { ...row, entity: "StockTakeSession", permission: "stock-opnames", subject: "STOCK_OPNAME", amount: await stockValue(tx, row.lines.map((line) => ({ productId: line.productId, quantity: (line.physicalQuantity ?? line.systemQuantity) - line.systemQuantity })), row.warehouseId) };
}

router.get("/workflow/:kind/:id/history", asyncHandler(async (req, res) => {
  const { kind, id } = paramsSchema.parse(req.params);
  const auth = authOf(req);
  const doc = await documentFor(prisma, kind, id);
  const scope = warehouseScope(auth);
  if (scope && !scope.includes(doc.warehouseId) && (!doc.destinationWarehouseId || !scope.includes(doc.destinationWarehouseId))) throw new AppError(403, "You cannot access another warehouse");
  if (!auth.permissions.includes(`${doc.permission}.read`)) throw new AppError(403, "You cannot view this document");
  const events = await prisma.auditLog.findMany({ where: { entity: doc.entity, entityId: id }, select: { id: true, action: true, createdAt: true, afterData: true, user: { select: { fullName: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 });
  const policy = doc.subject && doc.amount !== null ? await prisma.approvalPolicy.findFirst({ where: { subject: doc.subject, isActive: true, minimumAmount: { lte: doc.amount }, OR: [{ maximumAmount: null }, { maximumAmount: { gte: doc.amount } }] }, include: { approverRole: { select: { name: true } } }, orderBy: { minimumAmount: "desc" } }) : null;
  const reservation = kind === "sales" ? await prisma.stockReservation.aggregate({ where: { saleId: id, status: "ACTIVE" }, _min: { createdAt: true, expiresAt: true }, _sum: { quantity: true } }) : null;
  const reviewRole = doc.amount === null ? "Modal belum diketahui: tetapkan modal awal di Stock Report sebelum persetujuan" : policy ? `${policy.approverRole.name} atau Administrator` : doc.subject ? "Administrator (belum ada kebijakan untuk nilai ini)" : "Role dengan izin persetujuan transfer";
  res.json({ success: true, reviewRole, reservation: reservation ? { createdAt: reservation._min.createdAt, expiresAt: reservation._min.expiresAt, quantity: reservation._sum.quantity ?? 0 } : null, data: events.map((event) => ({ id: event.id, action: event.action, createdAt: event.createdAt, actor: event.user?.fullName ?? "Unknown", reason: ["REJECT", "RELEASE_RESERVATION"].includes(event.action) && event.afterData && typeof event.afterData === "object" && !Array.isArray(event.afterData) && typeof event.afterData.reason === "string" ? event.afterData.reason : null })) });
}));

router.post("/workflow/:kind/:id/reject", asyncHandler(async (req, res) => {
  const { kind, id } = paramsSchema.parse(req.params);
  if (kind === "sales") throw new AppError(400, "Sales do not use approval rejection");
  const { reason } = z.object({ reason: z.string().trim().min(5).max(500) }).strict().parse(req.body);
  const auth = authOf(req);
  const result = await prisma.$transaction(async (tx) => {
    if (kind === "adjustments") await tx.$queryRaw`SELECT "id" FROM "StockAdjustment" WHERE "id" = ${id}::uuid FOR UPDATE`;
    if (kind === "transfers") await tx.$queryRaw`SELECT "id" FROM "StockTransfer" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const doc = await documentFor(tx, kind, id);
    assertWarehouseAccess(auth, doc.warehouseId);
    if (!auth.permissions.includes(`${doc.permission}.approve`)) throw new AppError(403, "You cannot reject this document");
    if (doc.createdById === auth.userId) throw new AppError(403, "The document creator cannot review their own document");
    if (doc.subject && doc.amount !== null) await assertApprovalAuthority(tx, doc.subject, doc.amount, auth, doc.createdById);
    else if (doc.amount === null && auth.roleCode !== "ADMIN") throw new AppError(403, "Unknown-cost documents require administrator review until opening cost is recorded");
    let changed: { count: number }; let status: string;
    if (kind === "purchases") { status = "DRAFT"; changed = await tx.purchaseOrder.updateMany({ where: { id, status: "PENDING" }, data: { status: "DRAFT", approvedById: null, approvedAt: null } }); }
    else if (kind === "returns") { status = "DRAFT"; changed = await tx.returnOrder.updateMany({ where: { id, status: "PENDING" }, data: { status: "DRAFT", approvedById: null, approvedAt: null } }); }
    else if (kind === "adjustments") { status = "REVISION"; changed = await tx.stockAdjustment.updateMany({ where: { id, status: "DRAFT" }, data: { status: "REVISION", approvedById: null, approvedAt: null } }); }
    else if (kind === "transfers") { status = "REVISION"; changed = await tx.stockTransfer.updateMany({ where: { id, status: "DRAFT" }, data: { status: "REVISION", approvedById: null, approvedAt: null } }); }
    else { status = "COUNTING"; changed = await tx.stockTakeSession.updateMany({ where: { id, status: "SUBMITTED" }, data: { status: "COUNTING", submittedAt: null } }); }
    if (changed.count !== 1) throw new AppError(409, "Document is no longer awaiting review");
    await writeAuditLog({ userId: auth.userId, action: "REJECT", entity: doc.entity, entityId: id, beforeData: { status: doc.status }, afterData: { status, reason } }, tx as never);
    return { doc, status };
  });
  try {
    await notifyByPermission({ permission: `${result.doc.permission}.read`, type: "DOCUMENT_REJECTED", title: "Document returned from review", message: `${result.doc.number}: ${reason}`, entity: result.doc.entity, entityId: id, warehouseId: result.doc.warehouseId });
  } catch (error) {
    console.error("Unable to send rejection notification", error);
  }
  res.json({ success: true, data: { status: result.status }, message: "Review rejection recorded" });
}));

export default router;
