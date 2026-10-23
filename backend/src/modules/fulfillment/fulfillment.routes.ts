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
  pickShipmentSchema,
  shipShipmentSchema,
} from "./fulfillment.validation.ts";

const router = Router();

function idOf(req: Request) {
  return fulfillmentIdParamsSchema.parse(req.params).id;
}

async function shipmentScope(id: string) {
  const shipment = await prisma.saleShipment.findUnique({ where: { id }, select: { id: true, saleId: true, warehouseId: true, number: true } });
  if (!shipment) throw new AppError(404, "Shipment not found");
  return shipment;
}

async function notifyShipment(event: string, data: { id: string; number: string; warehouseId: string; saleId: string }) {
  await notifyByPermission({
    permission: "fulfillment.read",
    type: `FULFILLMENT_${event}`,
    title: `Shipment ${event.toLowerCase().replaceAll("_", " ")}`,
    message: `${data.number}: ${event.toLowerCase().replaceAll("_", " ")}.`,
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
  if (!sale) throw new AppError(404, "Sale not found");
  assertWarehouseAccess(auth, sale.warehouseId);
  const input = createShipmentSchema.parse(req.body);
  const data = await prisma.$transaction(async (tx) => {
    const created = await createShipment(tx, saleId, input, auth.userId);
    await writeAuditLog({ userId: auth.userId, action: "CREATE", entity: "SaleShipment", entityId: created.id, afterData: created }, tx as never);
    return created;
  });
  await notifyShipment("CREATED", data);
  res.status(201).json({ success: true, message: "Shipment created and ready for picking", data });
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
  res.json({ success: true, message: "Shipment picking recorded", data });
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
  res.json({ success: true, message: "Shipment packed", data });
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
  res.json({ success: true, message: "Shipment shipped and stock issued", data });
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
  res.json({ success: true, message: "Shipment completed", data });
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
  res.json({ success: true, message: "Shipment cancelled", data });
}));

export default router;
