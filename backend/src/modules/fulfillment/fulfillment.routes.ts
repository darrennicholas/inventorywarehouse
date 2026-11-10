import { Router, type Request } from "express";
import { z } from "zod";

import { prisma } from "../../lib/prisma.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess, warehouseScope } from "../../rbac/warehouse-scope.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import {
  cancelShipment,
  completeShipment,
  createShipment,
  getShipmentForRoute,
  listFulfillmentSales,
  listFulfillments,
  packShipment,
  pickShipment,
  shipShipment,
} from "./fulfillment.service.ts";
import {
  createShipmentSchema,
  fulfillmentIdParamsSchema,
  fulfillmentListQuerySchema,
  fulfillmentScanQuerySchema,
  pickShipmentSchema,
  shipShipmentSchema,
} from "./fulfillment.validation.ts";

const router = Router();

function idOf(req: Request) {
  return fulfillmentIdParamsSchema.parse(req.params).id;
}

async function shipmentScope(id: string) {
  const shipment = await prisma.saleShipment.findUnique({ where: { id }, select: { id: true, saleId: true, warehouseId: true, number: true } });
  if (!shipment) throw new AppError(404, "Pengiriman tidak ditemukan.");
  return shipment;
}

async function notifyShipment(event: string, data: { id: string; number: string; warehouseId: string; saleId: string }) {
  const eventLabels: Record<string, string> = {
    CREATED: "siap diambil",
    PICKED: "barang berhasil diambil",
    PACKED: "siap dikirim",
    SHIPPED: "sedang dalam perjalanan",
    COMPLETED: "selesai",
    CANCELLED: "dibatalkan",
  };
  const eventLabel = eventLabels[event] ?? "diperbarui";
  await notifyByPermission({
    permission: "fulfillment.read",
    type: `FULFILLMENT_${event}`,
    title: `Pengiriman ${eventLabel}`,
    message: `${data.number}: ${eventLabel}.`,
    entity: "SaleShipment",
    entityId: data.id,
    warehouseId: data.warehouseId,
  });
}

router.get("/", requirePermission("fulfillment.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const query = fulfillmentListQuerySchema.parse(req.query);
  if (query.warehouseId) assertWarehouseAccess(auth, query.warehouseId);
  const data = await prisma.$transaction((tx) => listFulfillments(tx, query, warehouseScope(auth)));
  res.json({ success: true, ...data });
}));

router.get("/scan", requirePermission("fulfillment.pick"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const { code, page } = fulfillmentScanQuerySchema.parse(req.query);
  const pageSize = 50;
  const allowedWarehouses = warehouseScope(auth);
  const where = {
    status: "PICKING" as const,
    ...(allowedWarehouses ? { warehouseId: { in: allowedWarehouses } } : {}),
    items: { some: { product: { OR: [
      { sku: { equals: code, mode: "insensitive" as const } },
      { barcode: { equals: code, mode: "insensitive" as const } },
    ] } } },
  };
  const foundShipments = await prisma.saleShipment.findMany({ where, select: {
    id: true, number: true, saleId: true, warehouseId: true, status: true, createdAt: true,
    sale: { select: { number: true } },
    warehouse: { select: { name: true } },
    items: { where: { product: { OR: [
      { sku: { equals: code, mode: "insensitive" as const } },
      { barcode: { equals: code, mode: "insensitive" as const } },
    ] } }, select: { id: true, saleItemId: true, productId: true, quantity: true, pickedQuantity: true, packedQuantity: true, product: { select: { id: true, sku: true, barcode: true, name: true } } } },
  }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize + 1 });
  const hasMore = foundShipments.length > pageSize;
  const shipments = foundShipments.slice(0, pageSize);
  const matches = shipments.flatMap((shipment) => shipment.items
    .filter((item) => item.pickedQuantity < item.quantity && (item.product.sku.toLocaleLowerCase() === code.toLocaleLowerCase() || item.product.barcode?.toLocaleLowerCase() === code.toLocaleLowerCase()))
    .map((item) => ({ shipment, item })));
  res.json({ success: true, data: matches, page, pageSize, hasMore });
}));

router.get("/sales", requirePermission("fulfillment.read"), asyncHandler(async (req, res) => {
  const data = await prisma.$transaction((tx) => listFulfillmentSales(tx, warehouseScope(authOf(req))));
  res.json({ success: true, data });
}));

router.get("/:id", requirePermission("fulfillment.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const shipment = await shipmentScope(idOf(req));
  assertWarehouseAccess(auth, shipment.warehouseId);
  const data = await prisma.$transaction((tx) => getShipmentForRoute(tx, shipment.id));
  res.json({ success: true, data });
}));

router.post("/sales/:saleId/shipments", requirePermission("fulfillment.write"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const saleId = z.uuid().parse(req.params.saleId);
  const sale = await prisma.sale.findUnique({ where: { id: saleId }, select: { warehouseId: true } });
  if (!sale) throw new AppError(404, "Penjualan tidak ditemukan.");
  assertWarehouseAccess(auth, sale.warehouseId);
  const input = createShipmentSchema.parse(req.body);
  const data = await prisma.$transaction(async (tx) => {
    const created = await createShipment(tx, saleId, input, auth.userId);
    await writeAuditLog({ userId: auth.userId, action: "CREATE", entity: "SaleShipment", entityId: created.id, afterData: created }, tx as never);
    return created;
  });
  await notifyShipment("CREATED", data);
  res.status(201).json({ success: true, message: "Pengiriman berhasil dibuat dan siap diambil.", data });
}));

router.post("/:id/pick", requirePermission("fulfillment.pick"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const shipment = await shipmentScope(idOf(req));
  assertWarehouseAccess(auth, shipment.warehouseId);
  const input = pickShipmentSchema.parse(req.body ?? {});
  const data = await prisma.$transaction(async (tx) => {
    const updated = await pickShipment(tx, shipment.id, input, auth.userId);
    await writeAuditLog({ userId: auth.userId, action: "PICK", entity: "SaleShipment", entityId: updated.id, afterData: updated }, tx as never);
    return updated;
  });
  await notifyShipment("PICKED", data);
  res.json({ success: true, message: "Pengambilan barang berhasil dicatat.", data });
}));

router.post("/:id/pack", requirePermission("fulfillment.pack"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const shipment = await shipmentScope(idOf(req));
  assertWarehouseAccess(auth, shipment.warehouseId);
  const data = await prisma.$transaction(async (tx) => {
    const updated = await packShipment(tx, shipment.id, auth.userId);
    await writeAuditLog({ userId: auth.userId, action: "PACK", entity: "SaleShipment", entityId: updated.id, afterData: updated }, tx as never);
    return updated;
  });
  await notifyShipment("PACKED", data);
  res.json({ success: true, message: "Pengiriman berhasil dikemas.", data });
}));

router.post("/:id/ship", requirePermission("fulfillment.ship"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const shipment = await shipmentScope(idOf(req));
  assertWarehouseAccess(auth, shipment.warehouseId);
  const input = shipShipmentSchema.parse(req.body);
  const data = await prisma.$transaction(async (tx) => {
    const updated = await shipShipment(tx, shipment.id, input, auth.userId);
    await writeAuditLog({ userId: auth.userId, action: "SHIP", entity: "SaleShipment", entityId: updated.id, afterData: updated }, tx as never);
    return updated;
  }, { timeout: 20_000 });
  await notifyShipment("SHIPPED", data);
  res.json({ success: true, message: "Pengiriman berhasil dikonfirmasi dan stok telah dikeluarkan.", data });
}));

router.post("/:id/complete", requirePermission("fulfillment.write"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const shipment = await shipmentScope(idOf(req));
  assertWarehouseAccess(auth, shipment.warehouseId);
  const data = await prisma.$transaction(async (tx) => {
    const updated = await completeShipment(tx, shipment.id);
    await writeAuditLog({ userId: auth.userId, action: "COMPLETE", entity: "SaleShipment", entityId: updated.id, afterData: updated }, tx as never);
    return updated;
  });
  await notifyShipment("COMPLETED", data);
  res.json({ success: true, message: "Pengiriman berhasil diselesaikan.", data });
}));

router.post("/:id/cancel", requirePermission("fulfillment.write"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const shipment = await shipmentScope(idOf(req));
  assertWarehouseAccess(auth, shipment.warehouseId);
  const data = await prisma.$transaction(async (tx) => {
    const updated = await cancelShipment(tx, shipment.id);
    await writeAuditLog({ userId: auth.userId, action: "CANCEL", entity: "SaleShipment", entityId: updated.id, afterData: updated }, tx as never);
    return updated;
  });
  await notifyShipment("CANCELLED", data);
  res.json({ success: true, message: "Pengiriman berhasil dibatalkan.", data });
}));

export default router;
