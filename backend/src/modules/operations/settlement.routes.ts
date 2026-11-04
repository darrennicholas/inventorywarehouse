import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess } from "../../rbac/warehouse-scope.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { financialSummary, lockFinancialDocument, returnSettlementSummary } from "./settlement.service.ts";

const router = Router();
const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).refine((value) => new Prisma.Decimal(value).gt(0), "Amount must be positive with at most two decimals");
async function authorize(id: string, auth: ReturnType<typeof authOf>) {
  const doc = await prisma.returnOrder.findUnique({ where: { id } }); if (!doc) throw new AppError(404, "Return not found");
  assertWarehouseAccess(auth, doc.warehouseId);
  if (!auth.permissions.includes(doc.type === "PURCHASE" ? "purchase-returns.read" : "sales-returns.read")) throw new AppError(403, "You cannot access this return");
  return doc;
}
router.get("/return-settlements/:id", requirePermission("payments.read"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id); const doc = await authorize(id, authOf(req));
  const data = await prisma.$transaction(async (tx) => { await lockFinancialDocument(tx, doc.type, (doc.purchaseOrderId ?? doc.saleId)!); return returnSettlementSummary(tx, id); });
  // Do not expose invoice or full relations to users who only read returns/payments.
  res.json({ success: true, data: { ...data, summary: { originalTotal: data.summary.originalTotal, returnedValue: data.summary.returnedValue, outstanding: data.summary.outstanding, refundable: data.summary.refundable } } });
}));
router.post("/return-settlements/:id", requirePermission("payments.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id); const auth = authOf(req); const snapshot = await authorize(id, auth);
  const permission = snapshot.type === "PURCHASE" ? "purchase-returns.approve" : "sales-returns.approve";
  if (!auth.permissions.includes(permission)) throw new AppError(403, "Return approval permission is required to settle a return");
  const input = z.object({ kind: z.enum(["REFUND", "CREDIT"]), amount: money, reference: z.string().trim().min(3).max(120), notes: z.string().trim().min(5).max(1000) }).strict().parse(req.body);
  const data = await prisma.$transaction(async (tx) => {
    await lockFinancialDocument(tx, snapshot.type, (snapshot.purchaseOrderId ?? snapshot.saleId)!);
    await tx.$queryRaw`SELECT "id" FROM "ReturnOrder" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const doc = await tx.returnOrder.findUniqueOrThrow({ where: { id } });
    if (doc.status !== "POSTED") throw new AppError(409, "Only posted returns may be settled");
    const summary = await returnSettlementSummary(tx, id); const amount = new Prisma.Decimal(input.amount);
    if (amount.gt(summary.available)) throw new AppError(409, "Amount exceeds the return entitlement or refundable paid balance; unpaid returns reduce the original bill automatically");
    if (input.kind === "REFUND") {
      const previous = await tx.returnSettlement.findMany({ where: { kind: "REFUND", returnOrder: snapshot.type === "PURCHASE" ? { purchaseOrderId: snapshot.purchaseOrderId } : { saleId: snapshot.saleId } }, select: { amount: true, isReversal: true } });
      const netRefunded = previous.reduce((sum, row) => sum.plus(row.isReversal ? row.amount.negated() : row.amount), new Prisma.Decimal(0));
      if (amount.gt(summary.summary.cashPaid.minus(netRefunded))) throw new AppError(409, "Cash refunds cannot exceed cash actually paid; use credit for credit-funded balances");
    }
    const data = await tx.returnSettlement.create({ data: { returnOrderId: id, ...input, amount, createdById: auth.userId } });
    await writeAuditLog({ userId: auth.userId, action: input.kind, entity: "ReturnOrder", entityId: id, afterData: data }, tx as never);
    return data;
  });
  await notifyByPermission({ permission: "payments.read", type: "RETURN_SETTLED", title: "Return settlement recorded", message: `${snapshot.number}: ${input.kind} ${input.amount}.`, entity: "ReturnOrder", entityId: id, warehouseId: snapshot.warehouseId });
  res.status(201).json({ success: true, data });
}));
router.post("/return-settlements/:id/reverse", requirePermission("payments.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id); const auth = authOf(req); const settlement = await prisma.returnSettlement.findUnique({ where: { id } });
  if (!settlement) throw new AppError(404, "Settlement not found");
  const snapshot = await authorize(settlement.returnOrderId, auth);
  if (!auth.permissions.includes(snapshot.type === "PURCHASE" ? "purchase-returns.approve" : "sales-returns.approve")) throw new AppError(403, "Return approval permission is required to reverse a settlement");
  const input = z.object({ reference: z.string().trim().min(3).max(120), notes: z.string().trim().min(10).max(1000) }).strict().parse(req.body);
  const reversal = await prisma.$transaction(async (tx) => {
    await lockFinancialDocument(tx, snapshot.type, (snapshot.purchaseOrderId ?? snapshot.saleId)!);
    await tx.$queryRaw`SELECT "id" FROM "ReturnOrder" WHERE "id" = ${snapshot.id}::uuid FOR UPDATE`;
    const original = await tx.returnSettlement.findUnique({ where: { id }, include: { applications: true, reversal: true } });
    if (!original || original.returnOrderId !== snapshot.id || original.isReversal) throw new AppError(404, "Original settlement not found");
    if (original.reversal) throw new AppError(409, "Settlement has already been reversed");
    if (original.kind === "CREDIT" && original.applications.length) throw new AppError(409, "A credit already applied to invoices cannot be reversed");
    const row = await tx.returnSettlement.create({ data: { returnOrderId: snapshot.id, kind: original.kind, amount: original.amount, isReversal: true, reversesSettlementId: original.id, reference: input.reference, notes: input.notes, createdById: auth.userId } });
    await writeAuditLog({ userId: auth.userId, action: "REVERSE_SETTLEMENT", entity: "ReturnOrder", entityId: snapshot.id, beforeData: original, afterData: row }, tx as never);
    return row;
  });
  await notifyByPermission({ permission: "payments.read", type: "RETURN_SETTLEMENT_REVERSED", title: "Settlement reversal recorded", message: `${snapshot.number}: ${reversal.kind} ${reversal.amount}.`, entity: "ReturnOrder", entityId: snapshot.id, warehouseId: snapshot.warehouseId });
  res.status(201).json({ success: true, data: reversal });
}));
router.get("/credits/:id/targets", requirePermission("payments.read"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id); const auth = authOf(req);
  const credit = await prisma.returnSettlement.findUnique({ where: { id } });
  if (!credit || credit.kind !== "CREDIT" || credit.isReversal || await prisma.returnSettlement.findUnique({ where: { reversesSettlementId: id } })) throw new AppError(404, "Credit not found or no longer available");
  const doc = await authorize(credit.returnOrderId, auth);
  if (!auth.permissions.includes(doc.type === "PURCHASE" ? "purchases.read" : "sales.read")) throw new AppError(403, "Invoice read permission is required");
  const source = doc.type === "PURCHASE" ? await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: doc.purchaseOrderId! } }) : await prisma.sale.findUniqueOrThrow({ where: { id: doc.saleId! } });
  const candidates = doc.type === "PURCHASE" && "supplierId" in source
    ? await prisma.purchaseOrder.findMany({ where: { supplierId: source.supplierId, id: { not: source.id }, status: { notIn: ["DRAFT", "CANCELLED"] } }, select: { id: true, number: true, warehouseId: true }, orderBy: { orderDate: "desc" }, take: 100 })
    : "customerId" in source && source.customerId ? await prisma.sale.findMany({ where: { customerId: source.customerId, id: { not: source.id }, status: { notIn: ["DRAFT", "CANCELLED"] } }, select: { id: true, number: true, warehouseId: true }, orderBy: { saleDate: "desc" }, take: 100 }) : [];
  const accessible = candidates.filter((row) => { try { assertWarehouseAccess(auth, row.warehouseId); return true; } catch { return false; } });
  res.json({ success: true, data: accessible, limit: 100 });
}));
router.post("/credits/:id/apply", requirePermission("payments.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id); const input = z.object({ targetId: z.uuid(), amount: money }).strict().parse(req.body); const auth = authOf(req);
  const snapshot = await prisma.returnSettlement.findUnique({ where: { id }, include: { returnOrder: true } }); if (!snapshot || snapshot.kind !== "CREDIT") throw new AppError(404, "Credit not found");
  const doc = await authorize(snapshot.returnOrderId, auth); const type = doc.type;
  if (!auth.permissions.includes(type === "PURCHASE" ? "purchases.read" : "sales.read")) throw new AppError(403, "Source and target document read permission is required");
  const sourceId = (doc.purchaseOrderId ?? doc.saleId)!; if (sourceId === input.targetId) throw new AppError(400, "Credit must be applied to a different invoice");
  const data = await prisma.$transaction(async (tx) => {
    for (const invoiceId of [sourceId, input.targetId].sort()) await lockFinancialDocument(tx, type, invoiceId);
    await tx.$queryRaw`SELECT "id" FROM "ReturnSettlement" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const credit = await tx.returnSettlement.findUniqueOrThrow({ where: { id }, include: { reversal: true } });
    if (credit.isReversal || credit.reversal) throw new AppError(409, "This credit has been reversed");
    const source = type === "PURCHASE" ? await tx.purchaseOrder.findUniqueOrThrow({ where: { id: sourceId } }) : await tx.sale.findUniqueOrThrow({ where: { id: sourceId } });
    const target = type === "PURCHASE" ? await tx.purchaseOrder.findUnique({ where: { id: input.targetId } }) : await tx.sale.findUnique({ where: { id: input.targetId } });
    if (!target) throw new AppError(404, "Target invoice not found"); assertWarehouseAccess(auth, target.warehouseId);
    if (["CANCELLED", "DRAFT"].includes(target.status)) throw new AppError(409, "Target invoice must be active and no longer a draft");
    const sameParty = "supplierId" in source && "supplierId" in target ? source.supplierId === target.supplierId : "customerId" in source && "customerId" in target && source.customerId && source.customerId === target.customerId;
    if (!sameParty) throw new AppError(400, "Credit may only be applied to invoices of the same supplier/customer");
    const used = await tx.creditApplication.aggregate({ where: { settlementId: id }, _sum: { amount: true } }); const amount = new Prisma.Decimal(input.amount);
    if (amount.gt(credit.amount.minus(used._sum.amount ?? 0))) throw new AppError(409, "Insufficient remaining credit");
    if (amount.gt((await financialSummary(tx, type, input.targetId)).outstanding)) throw new AppError(409, "Credit exceeds target outstanding balance");
    const data = await tx.creditApplication.create({ data: { settlementId: id, ...(type === "PURCHASE" ? { purchaseOrderId: target.id } : { saleId: target.id }), amount, createdById: auth.userId } });
    await writeAuditLog({ userId: auth.userId, action: "APPLY_CREDIT", entity: type === "PURCHASE" ? "PurchaseOrder" : "Sale", entityId: target.id, afterData: data }, tx as never);
    return data;
  });
  res.status(201).json({ success: true, data });
}));
export default router;
