import { Router } from "express";
import { Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "../../lib/prisma.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess, scopedWarehouseFilter } from "../../rbac/warehouse-scope.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { pageMeta, pagination } from "../../utils/pagination.ts";
import { ensureProducts, ensureScopedWarehouse } from "./transaction-domain.service.ts";
import { purchaseEditSchema, purchaseListQuerySchema, purchaseSchema, purchaseReceiveSchema, transactionIdParamsSchema, type PurchaseInput, type PurchaseReceiveInput } from "./operations.validation.ts";
import { dateRange, sumItems } from "./transaction-query.ts";
import { approvePurchase, purchaseInclude, receivePurchase } from "./purchase.service.ts";
import { ensureTransitionAllowed } from "./transaction-support.service.ts";

const router = Router();
router.get("/purchases", requirePermission("purchases.read"), asyncHandler(async (req, res) => {
  const query = purchaseListQuerySchema.parse(req.query);
  const { page, pageSize, skip, take } = pagination(query);
  const { search, status } = query;
  const clauses: Prisma.PurchaseOrderWhereInput[] = [];
  const base = scopedWarehouseFilter(authOf(req));
  if (base) clauses.push(base);
  if (search) clauses.push({ OR: [{ number: { contains: search, mode: "insensitive" } }, { supplier: { name: { contains: search, mode: "insensitive" } } }, { items: { some: { product: { OR: [{ name: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] } } } }] });
  if (status) clauses.push({ status });
  const dates = dateRange(query, "orderDate"); if (dates) clauses.push(dates);
  const where = clauses.length ? { AND: clauses } : undefined;
  const [data, total] = await Promise.all([prisma.purchaseOrder.findMany({ where, include: purchaseInclude, orderBy: { orderDate: "desc" }, skip, take }), prisma.purchaseOrder.count({ where })]);
  res.json({ success: true, data, meta: pageMeta(page, pageSize, total) });
}));

router.post("/purchases/:id/approve", requirePermission("purchases.approve"), asyncHandler(async (req, res) => {
  const data = await approvePurchase(transactionIdParamsSchema.parse(req.params).id, authOf(req).userId, authOf(req));
  await notifyByPermission({ permission: "purchases.read", type: "PURCHASE_STATUS", title: "Purchase approved", message: `${data.number} has been approved for receiving.`, entity: "PurchaseOrder", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Purchase approved successfully", data });
}));

router.post("/purchases/:id/receive", requirePermission("purchases.write"), asyncHandler(async (req, res) => {
  const input = purchaseReceiveSchema.parse(req.body ?? {});
  const auth = authOf(req);
  const data = await receivePurchase(transactionIdParamsSchema.parse(req.params).id, input, auth.userId, auth);
  const statusLabel = data.status === "RECEIVED" ? "diterima seluruhnya" : "diterima sebagian";
  await notifyByPermission({ permission: "purchases.read", type: "PURCHASE_RECEIVED", title: "Penerimaan pembelian dicatat", message: `${data.number} ${statusLabel}.`, entity: "PurchaseOrder", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: data.status === "RECEIVED" ? "Seluruh barang pada pesanan berhasil diterima." : "Penerimaan sebagian barang berhasil dicatat.", data });
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
    await writeAuditLog({ userId, action: "CREATE", entity: "PurchaseOrder", entityId: purchase.id, afterData: purchase, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    if (purchase.status === "PENDING") await writeAuditLog({ userId, action: "SUBMIT", entity: "PurchaseOrder", entityId: purchase.id, afterData: { status: purchase.status } }, tx as never);
    await writeAuditLog({ userId, action: "PRICE_SNAPSHOT", entity: "PurchaseOrderItem", entityId: purchase.id, afterData: purchase.items.map((item) => ({ productId: item.productId, unitPrice: item.unitPrice, quantity: item.quantity })), requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);

    return purchase;
  });

  await notifyByPermission({ permission: "purchases.read", type: "PURCHASE_CREATED", title: "New purchase order", message: `${data.number} was created with status ${data.status.toLowerCase()}.`, entity: "PurchaseOrder", entityId: data.id, warehouseId: data.warehouseId });

  res.status(201).json({ success: true, message: "Purchase created successfully", data });
}));

router.patch("/purchases/:id", requirePermission("purchases.write"), asyncHandler(async (req, res) => {
  const id = transactionIdParamsSchema.parse(req.params).id;
  const input = purchaseEditSchema.parse(req.body);
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
    if (input.status !== undefined || input.notes !== undefined || input.expectedDate !== undefined) await writeAuditLog({ userId, action: "UPDATE", entity: "PurchaseOrder", entityId: id, beforeData: current, afterData: updated, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "purchases.read", type: "PURCHASE_STATUS", title: "Purchase status updated", message: `${data.number} is now ${data.status.toLowerCase().replaceAll("_", " ")}.`, entity: "PurchaseOrder", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Purchase updated successfully", data });
}));

router.delete("/purchases/:id", requirePermission("purchases.delete"), asyncHandler(async (req, res) => {
  const id = transactionIdParamsSchema.parse(req.params).id;
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

export default router;
