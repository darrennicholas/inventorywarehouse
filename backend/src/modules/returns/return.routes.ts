import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";

import { prisma } from "../../lib/prisma.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess, warehouseScope } from "../../rbac/warehouse-scope.ts";
import type { PermissionKey } from "../../rbac/permissions.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { assertApprovalAuthority } from "../approvals/approval-policy.service.ts";
import {
  ReturnWorkflowError,
  createPurchaseReturn,
  createSalesReturn,
  getReturn,
  getReturns,
  updateDraftReturn,
  submitReturn,
  approveReturn,
  postReturn,
  cancelReturn,
} from "./return.service.ts";
import {
  createPurchaseReturnSchema,
  createSalesReturnSchema,
  updateReturnSchema,
  returnIdParamsSchema,
  returnListQuerySchema,
} from "./return.validation.ts";

const router = Router();
const asId = (req: Request): string => returnIdParamsSchema.parse(req.params).id;

type ReturnType = "PURCHASE" | "SALE";
type ReturnAction = "read" | "write" | "approve" | "delete";
function permissionFor(type: ReturnType, action: ReturnAction): PermissionKey {
  return `${type === "PURCHASE" ? "purchase-returns" : "sales-returns"}.${action}` as PermissionKey;
}

// Map workflow errors to the project's normal HTTP error middleware.
async function execute<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ReturnWorkflowError) {
      throw new AppError(error.statusCode, error.message);
    }
    throw error;
  }
}

// For routes /:id the permission depends on the stored Return type.
// Also verify warehouse scope before responding or mutating.
function authorizeDocument(action: ReturnAction) {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const id = asId(req);
    const doc = await prisma.returnOrder.findUnique({
      where: { id },
      select: { type: true, warehouseId: true },
    });
    if (!doc) throw new AppError(404, "Return not found");
    assertWarehouseAccess(authOf(req), doc.warehouseId);
    requirePermission(permissionFor(doc.type, action))(req, res, next);
  });
}

async function sendAlert(type: ReturnType, event: string, doc: { id: string; number: string; warehouseId: string }) {
  await notifyByPermission({
    permission: permissionFor(type, "read"),
    type: `RETURN_${event}`,
    title: `${type === "PURCHASE" ? "Purchase" : "Sales"} return ${event.toLowerCase().replaceAll("_", " ")}`,
    message: `${doc.number}: ${event.toLowerCase().replaceAll("_", " ")}.`,
    entity: "ReturnOrder",
    entityId: doc.id,
    warehouseId: doc.warehouseId,
  });
}

// Static paths MUST precede /:id.
router.get("/purchase", requirePermission("purchase-returns.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const query = returnListQuerySchema.parse(req.query);
  if (query.warehouseId) assertWarehouseAccess(auth, query.warehouseId);
  const data = await execute(() => prisma.$transaction(tx => getReturns(tx, "PURCHASE", query, warehouseScope(auth) ?? undefined)));
  res.json({ success: true, ...data });
}));

router.get("/sales", requirePermission("sales-returns.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const query = returnListQuerySchema.parse(req.query);
  if (query.warehouseId) assertWarehouseAccess(auth, query.warehouseId);
  const data = await execute(() => prisma.$transaction(tx => getReturns(tx, "SALE", query, warehouseScope(auth) ?? undefined)));
  res.json({ success: true, ...data });
}));
router.post("/purchase", requirePermission("purchase-returns.write"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const input = createPurchaseReturnSchema.parse(req.body);
  assertWarehouseAccess(auth, input.warehouseId);
  const data = await execute(() => prisma.$transaction(async tx => {
    const created = await createPurchaseReturn(tx, input, auth.userId);
    await writeAuditLog({ userId: auth.userId, action: "CREATE", entity: "ReturnOrder", entityId: created.id, afterData: created }, tx as never);
    return created;
  }));
  await sendAlert("PURCHASE", "CREATED", data);
  res.status(201).json({ success: true, message: "Purchase return created", data });
}));

router.post("/sales", requirePermission("sales-returns.write"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const input = createSalesReturnSchema.parse(req.body);
  assertWarehouseAccess(auth, input.warehouseId);
  const data = await execute(() => prisma.$transaction(async tx => {
    const created = await createSalesReturn(tx, input, auth.userId);
    await writeAuditLog({ userId: auth.userId, action: "CREATE", entity: "ReturnOrder", entityId: created.id, afterData: created }, tx as never);
    return created;
  }));
  await sendAlert("SALE", "CREATED", data);
  res.status(201).json({ success: true, message: "Sales return created", data });
}));

router.get("/:id", authorizeDocument("read"), asyncHandler(async (req, res) => {
  const data = await execute(() => prisma.$transaction(tx => getReturn(tx, asId(req))));
  res.json({ success: true, data });
}));

router.put("/:id/inspection", authorizeDocument("write"), asyncHandler(async (req, res) => {
  const id = asId(req); const auth = authOf(req);
  const input = z.object({ status: z.enum(["PENDING", "COMPLETED", "FOLLOW_UP"]), notes: z.string().trim().min(3).max(1000) }).strict().parse(req.body);
  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ReturnOrder" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const doc = await tx.returnOrder.findUnique({ where: { id } });
    if (!doc) throw new AppError(404, "Return not found");
    assertWarehouseAccess(auth, doc.warehouseId);
    if (!["DRAFT", "PENDING", "APPROVED"].includes(doc.status)) throw new AppError(409, "Inspection cannot be changed after posting or cancellation");
    const before = await tx.returnInspection.findUnique({ where: { returnOrderId: id } });
    const updated = await tx.returnInspection.upsert({ where: { returnOrderId: id }, create: { returnOrderId: id, status: input.status, notes: input.notes, inspectedById: auth.userId }, update: { status: input.status, notes: input.notes, inspectedById: auth.userId, inspectedAt: new Date() }, include: { inspectedBy: { select: { id: true, fullName: true } } } });
    await writeAuditLog({ userId: auth.userId, action: "INSPECTION", entity: "ReturnOrder", entityId: id, beforeData: before, afterData: updated }, tx as never);
    return { inspection: updated, doc };
  });
  await sendAlert(data.doc.type, "INSPECTION_UPDATED", data.doc);
  res.json({ success: true, data: data.inspection });
}));

router.put("/:id/items/:itemId/inspection", authorizeDocument("write"), asyncHandler(async (req, res) => {
  const id = asId(req); const itemId = z.uuid().parse(req.params.itemId); const auth = authOf(req);
  const input = z.object({ condition: z.enum(["GOOD", "DAMAGED", "EXPIRED", "DEFECTIVE"]), recommendedDisposition: z.enum(["RESTOCK", "QUARANTINE", "SCRAP"]), notes: z.string().trim().min(3).max(1000) }).strict().parse(req.body);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ReturnOrder" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const doc = await tx.returnOrder.findUnique({ where: { id } }); if (!doc) throw new AppError(404, "Return not found");
    assertWarehouseAccess(auth, doc.warehouseId);
    if (doc.type === "SALE" && input.recommendedDisposition === "RESTOCK" && input.condition !== "GOOD") throw new AppError(400, "Only goods in good condition may be recommended for restock");
    if (!["DRAFT", "PENDING", "APPROVED"].includes(doc.status)) throw new AppError(409, "Inspection cannot be changed after posting or cancellation");
    const item = await tx.returnOrderItem.findFirst({ where: { id: itemId, returnOrderId: id } }); if (!item) throw new AppError(404, "Return item not found");
    const before = await tx.returnItemInspection.findUnique({ where: { returnOrderItemId: itemId } });
    const data = await tx.returnItemInspection.upsert({ where: { returnOrderItemId: itemId }, create: { returnOrderItemId: itemId, ...input, inspectedById: auth.userId }, update: { ...input, inspectedById: auth.userId, inspectedAt: new Date() }, include: { inspectedBy: { select: { fullName: true } } } });
    await writeAuditLog({ userId: auth.userId, action: "ITEM_INSPECTION", entity: "ReturnOrder", entityId: id, beforeData: before, afterData: data }, tx as never);
    return { data, doc };
  });
  await sendAlert(result.doc.type, "ITEM_INSPECTED", result.doc);
  res.json({ success: true, data: result.data });
}));

router.patch("/:id", authorizeDocument("write"), asyncHandler(async (req, res) => {
  const input = updateReturnSchema.parse(req.body);
  const auth = authOf(req);
  const data = await execute(() => prisma.$transaction(async tx => {
    const before = await getReturn(tx, asId(req));
    const updated = await updateDraftReturn(tx, before.id, input);
    await writeAuditLog({ userId: auth.userId, action: "UPDATE", entity: "ReturnOrder", entityId: before.id, beforeData: before, afterData: updated }, tx as never);
    return updated;
  }));
  res.json({ success: true, message: "Return updated", data });
}));

router.post("/:id/submit", authorizeDocument("write"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const data = await execute(() => prisma.$transaction(async tx => {
    const updated = await submitReturn(tx, asId(req));
    await writeAuditLog({ userId: auth.userId, action: "SUBMIT", entity: "ReturnOrder", entityId: updated.id, afterData: updated }, tx as never);
    return updated;
  }));
  await sendAlert(data.type, "SUBMITTED", data);
  res.json({ success: true, message: "Return submitted for approval", data });
}));

router.post("/:id/approve", authorizeDocument("approve"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const data = await execute(() => prisma.$transaction(async tx => {
    const document = await tx.returnOrder.findUnique({
      where: { id: asId(req) },
      include: { items: { include: { purchaseOrderItem: { select: { unitPrice: true } }, saleItem: { select: { unitPrice: true } } } } },
    });
    if (!document) throw new AppError(404, "Return not found");
    const amount = document.items.reduce((total, item) => total + item.quantity * Number(item.purchaseOrderItem?.unitPrice ?? item.saleItem?.unitPrice ?? 0), 0);
    await assertApprovalAuthority(tx, "RETURN", amount, auth, document.createdById);
    const updated = await approveReturn(tx, document.id, auth.userId);
    await writeAuditLog({ userId: auth.userId, action: "APPROVE", entity: "ReturnOrder", entityId: updated.id, afterData: updated }, tx as never);
    return updated;
  }));
  await sendAlert(data.type, "APPROVED", data);
  res.json({ success: true, message: "Return approved", data });
}));

router.post("/:id/post", authorizeDocument("approve"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  // Physical inventory changes, movements and status are ONE transaction.
  const data = await execute(() => prisma.$transaction(async tx => {
    const updated = await postReturn(tx, asId(req), auth.userId);
    await writeAuditLog({ userId: auth.userId, action: "POST", entity: "ReturnOrder", entityId: updated.id, afterData: updated }, tx as never);
    return updated;
  }, { timeout: 20_000 }));
  await sendAlert(data.type, "POSTED", data);
  res.json({ success: true, message: "Return posted", data });
}));

// DELETE = soft cancellation, never physical deletion of posted inventory history.
router.delete("/:id", authorizeDocument("delete"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const data = await execute(() => prisma.$transaction(async tx => {
    const updated = await cancelReturn(tx, asId(req));
    await writeAuditLog({ userId: auth.userId, action: "CANCEL", entity: "ReturnOrder", entityId: updated.id, afterData: updated }, tx as never);
    return updated;
  }));
  await sendAlert(data.type, "CANCELLED", data);
  res.json({ success: true, message: "Return cancelled", data });
}));

export default router;
