import { Router } from "express";
import { Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "../../lib/prisma.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess, scopedWarehouseFilter } from "../../rbac/warehouse-scope.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { releaseSaleReservations, reserveSaleStock } from "./inventory.service.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { pageMeta, pagination } from "../../utils/pagination.ts";
import { ensureProducts, ensureScopedWarehouse } from "./transaction-domain.service.ts";
import { saleEditSchema, saleListQuerySchema, saleSchema, transactionIdParamsSchema, transactionReasonSchema, type SaleInput } from "./operations.validation.ts";
import { dateRange, sumItems } from "./transaction-query.ts";
import { saleInclude, ensureTransitionAllowed } from "./transaction-support.service.ts";

const router = Router();
router.get("/sales", requirePermission("sales.read"), asyncHandler(async (req, res) => {
  const query = saleListQuerySchema.parse(req.query);
  const { page, pageSize, skip, take } = pagination(query);
  const { search, status } = query;
  const base = scopedWarehouseFilter(authOf(req));
  const clauses: Prisma.SaleWhereInput[] = [];
  if (base) clauses.push(base);
  if (search) clauses.push({ OR: [{ number: { contains: search, mode: "insensitive" } }, { customer: { name: { contains: search, mode: "insensitive" } } }, { items: { some: { product: { OR: [{ name: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] } } } }] });
  if (status) clauses.push({ status });
  const dates = dateRange(query, "saleDate"); if (dates) clauses.push(dates);
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
    await writeAuditLog({ userId, action: "CREATE", entity: "Sale", entityId: sale.id, afterData: sale, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    await writeAuditLog({ userId, action: "PRICE_SNAPSHOT", entity: "SaleItem", entityId: sale.id, afterData: sale.items.map((item) => ({ productId: item.productId, unitPrice: item.unitPrice, quantity: item.quantity })), requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    return sale;
  });

  await notifyByPermission({ permission: "sales.read", type: "SALE_CREATED", title: "New sale created", message: `${data.number} was created with status ${data.status.toLowerCase()}.`, entity: "Sale", entityId: data.id, warehouseId: data.warehouseId });

  res.status(201).json({ success: true, message: "Sale created successfully", data });
}));

router.post("/sales/:id/reserve", requirePermission("sales.write"), asyncHandler(async (req, res) => {
  const id = transactionIdParamsSchema.parse(req.params).id;
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
  const id = transactionIdParamsSchema.parse(req.params).id; const { reason } = transactionReasonSchema.parse(req.body); const auth = authOf(req);
  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const current = await tx.sale.findUnique({ where: { id } });
    if (!current) throw new AppError(404, "Sale not found");
    await ensureScopedWarehouse(tx, current.warehouseId, auth);
    if (current.status !== "RESERVED") throw new AppError(409, "Only a reserved sale can release its reservation");
    const shipments = await tx.saleShipment.count({ where: { saleId: id, status: { not: "CANCELLED" } } });
    if (shipments) throw new AppError(409, "Cancel or complete all active shipments before releasing stock", undefined, "ACTIVE_SHIPMENTS");
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
  const id = transactionIdParamsSchema.parse(req.params).id;
  const input = saleEditSchema.parse(req.body);
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
    const latest = await tx.sale.findUnique({ where: { id } });
    if (!latest || latest.status !== current.status) throw new AppError(409, "Sale status changed; reload and try again", undefined, "TRANSACTION_CONFLICT");
    if (nextStatus === "RESERVED" && current.status === "DRAFT") {
      await reserveSaleStock(tx, id, current.warehouseId, userId, current.items.map((item) => ({ id: item.id, productId: item.productId, quantity: item.quantity })));
    }
    if (nextStatus === "CANCELLED" && (await tx.payment.count({ where: { saleId: id, status: { not: "VOID" } } }) || await tx.creditApplication.count({ where: { saleId: id } }))) throw new AppError(409, "This sale has financial entries and cannot be cancelled");
    const updated = await tx.sale.update({ where: { id }, data: { status: nextStatus as never, notes: input.notes }, include: saleInclude });
    if (input.status !== undefined || input.notes !== undefined) await writeAuditLog({ userId, action: "UPDATE", entity: "Sale", entityId: id, beforeData: current, afterData: updated, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "sales.read", type: "SALE_STATUS", title: "Sale status updated", message: `${data.number} is now ${data.status.toLowerCase()}.`, entity: "Sale", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Sale updated successfully", data });
}));

router.delete("/sales/:id", requirePermission("sales.delete"), asyncHandler(async (req, res) => {
  const id = transactionIdParamsSchema.parse(req.params).id;
  const current = await prisma.sale.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "Sale not found");
  assertWarehouseAccess(authOf(req), current.warehouseId);
  if (["COMPLETED", "CANCELLED"].includes(current.status)) throw new AppError(409, "A completed or cancelled sale cannot be deleted");
  if (current.status === "RESERVED") throw new AppError(409, "Release the reservation with a reason before cancelling this sale");
  if (current.status !== "DRAFT") throw new AppError(409, "Sales in fulfillment must be managed through the fulfillment workflow");
  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const latest = await tx.sale.findUnique({ where: { id }, select: { status: true } });
    if (!latest || latest.status !== current.status) throw new AppError(409, "Sale status changed; reload and try again", undefined, "TRANSACTION_CONFLICT");
    if (await tx.payment.count({ where: { saleId: id, status: { not: "VOID" } } }) || await tx.creditApplication.count({ where: { saleId: id } })) throw new AppError(409, "This sale has financial entries and cannot be cancelled");
    const updated = await tx.sale.update({ where: { id }, data: { status: "CANCELLED" }, include: saleInclude });
    await writeAuditLog({ userId: authOf(req).userId, action: "CANCEL", entity: "Sale", entityId: id, beforeData: latest, afterData: updated, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "sales.read", type: "SALE_CANCELLED", title: "Sale cancelled", message: `${data.number} was cancelled and any reservation was released.`, entity: "Sale", entityId: data.id, warehouseId: data.warehouseId });
  res.json({ success: true, message: "Sale cancelled successfully", data });
}));

export default router;
