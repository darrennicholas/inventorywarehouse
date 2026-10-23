import { randomUUID } from "node:crypto";

import { Prisma } from "../../generated/prisma/client.ts";
import { AppError } from "../../utils/AppError.ts";
import { linkMovementAllocations } from "../operations/stock-allocation.service.ts";
import { consumeSaleReservationsForItems } from "../operations/inventory.service.ts";
import type {
  CreateShipmentInput,
  FulfillmentListQuery,
  PickShipmentInput,
  ShipShipmentInput,
} from "./fulfillment.validation.ts";

export type FulfillmentTx = Prisma.TransactionClient;

export const shipmentInclude = {
  sale: {
    select: {
      id: true,
      number: true,
      status: true,
      customer: { select: { id: true, code: true, name: true, address: true } },
      items: {
        select: {
          id: true,
          productId: true,
          quantity: true,
          product: { select: { id: true, sku: true, barcode: true, name: true } },
        },
      },
    },
  },
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  items: {
    include: {
      product: { select: { id: true, sku: true, barcode: true, name: true } },
      saleItem: { select: { id: true, saleId: true, quantity: true } },
      pickedBy: { select: { id: true, fullName: true } },
      packedBy: { select: { id: true, fullName: true } },
    },
  },
} as const;

export type ShipmentDetail = Prisma.SaleShipmentGetPayload<{ include: typeof shipmentInclude }>;

function fail(status: number, message: string): never {
  throw new AppError(status, message);
}

function shipmentNumber() {
  return `SHP-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function getShipmentForRoute(tx: FulfillmentTx, id: string) {
  const shipment = await tx.saleShipment.findUnique({ where: { id }, include: shipmentInclude });
  if (!shipment) fail(404, "Shipment not found");
  return shipment;
}

async function lockShipmentAndSale(tx: FulfillmentTx, id: string) {
  const snapshot = await tx.saleShipment.findUnique({ where: { id }, select: { id: true, saleId: true } });
  if (!snapshot) fail(404, "Shipment not found");
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Sale" WHERE "id" = ${snapshot.saleId}::uuid FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SaleShipment" WHERE "id" = ${id}::uuid FOR UPDATE`);
  return getShipmentForRoute(tx, id);
}

async function shippedQuantityByItem(tx: FulfillmentTx, saleId: string) {
  const rows = await tx.saleShipmentItem.findMany({
    where: { shipment: { saleId, status: { in: ["SHIPPED", "COMPLETED"] } } },
    select: { saleItemId: true, quantity: true },
  });
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.saleItemId, (totals.get(row.saleItemId) ?? 0) + row.quantity);
  return totals;
}

async function setSaleProgress(
  tx: FulfillmentTx,
  saleId: string,
  fallback: "RESERVED" | "PICKING" | "PACKED" | "SHIPPED" = "RESERVED",
  completeWhenAllShipmentsCompleted = false,
) {
  const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { items: { select: { id: true, quantity: true } } } });
  if (!sale) fail(404, "Sale not found");
  const shipped = await shippedQuantityByItem(tx, saleId);
  const shipmentStatuses = await tx.saleShipment.findMany({
    where: { saleId, status: { not: "CANCELLED" } },
    select: { status: true },
  });
  const totalOrdered = sale.items.reduce((sum, item) => sum + item.quantity, 0);
  const totalShipped = sale.items.reduce((sum, item) => sum + (shipped.get(item.id) ?? 0), 0);
  const hasPackedShipment = shipmentStatuses.some((item) => item.status === "PACKED");
  const hasPickingShipment = shipmentStatuses.some((item) => item.status === "PICKING");
  const nextStatus = totalShipped >= totalOrdered
    ? completeWhenAllShipmentsCompleted ? "COMPLETED" : "SHIPPED"
    : totalShipped > 0
      ? "PARTIALLY_SHIPPED"
      : hasPackedShipment
        ? "PACKED"
        : hasPickingShipment
          ? "PICKING"
          : fallback;
  return tx.sale.update({ where: { id: saleId }, data: { status: nextStatus } });
}

export async function listFulfillments(tx: FulfillmentTx, query: FulfillmentListQuery, warehouseIds?: string[]) {
  const where: Prisma.SaleShipmentWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.saleId ? { saleId: query.saleId } : {}),
    ...(query.search ? { OR: [{ number: { contains: query.search, mode: "insensitive" } }, { sale: { number: { contains: query.search, mode: "insensitive" } } }] } : {}),
    warehouseId: query.warehouseId && warehouseIds
      ? { equals: query.warehouseId, in: warehouseIds }
      : query.warehouseId
        ? query.warehouseId
        : warehouseIds ? { in: warehouseIds } : undefined,
  };
  const [data, total] = await Promise.all([
    tx.saleShipment.findMany({ where, include: shipmentInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    tx.saleShipment.count({ where }),
  ]);
  return { data, total, page: query.page, pageSize: query.pageSize };
}

export async function listFulfillmentSales(tx: FulfillmentTx, warehouseIds?: string[]) {
  return tx.sale.findMany({
    where: {
      status: { in: ["RESERVED", "PICKING", "PACKED", "PARTIALLY_SHIPPED"] },
      ...(warehouseIds ? { warehouseId: { in: warehouseIds } } : {}),
    },
    include: {
      customer: { select: { id: true, code: true, name: true, address: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      items: { include: { product: { select: { id: true, sku: true, barcode: true, name: true } } } },
    },
    orderBy: { saleDate: "desc" },
    take: 200,
  });
}

export async function createShipment(tx: FulfillmentTx, saleId: string, input: CreateShipmentInput, userId: string) {
  // Serialize shipment creation per sale. Without this lock, two users could
  // create shipments against the same reservation at the same time.
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Sale" WHERE "id" = ${saleId}::uuid FOR UPDATE`);
  const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { items: true, customer: { select: { address: true } } } });
  if (!sale) fail(404, "Sale not found");
  if (!["RESERVED", "PICKING", "PACKED", "PARTIALLY_SHIPPED"].includes(sale.status)) {
    fail(409, "Sale must have reserved stock before creating a shipment");
  }

  const requested = new Map(input.items.map((item) => [item.saleItemId, item]));
  if (requested.size !== input.items.length) fail(400, "A sale item can only appear once per shipment");
  const shipped = await shippedQuantityByItem(tx, saleId);
  const openShipmentItems = await tx.saleShipmentItem.findMany({
    where: {
      shipment: { saleId, status: { in: ["PICKING", "PACKED"] } },
    },
    select: { saleItemId: true, quantity: true },
  });
  const openCommitted = new Map<string, number>();
  for (const row of openShipmentItems) openCommitted.set(row.saleItemId, (openCommitted.get(row.saleItemId) ?? 0) + row.quantity);
  const activeReservations = await tx.stockReservation.findMany({ where: { saleId, status: "ACTIVE" }, select: { saleItemId: true, quantity: true } });
  const reserved = new Map<string, number>();
  for (const row of activeReservations) reserved.set(row.saleItemId, (reserved.get(row.saleItemId) ?? 0) + row.quantity);

  for (const item of input.items) {
    const saleItem = sale.items.find((candidate) => candidate.id === item.saleItemId);
    if (!saleItem) fail(400, "Shipment item is not part of this sale");
    const alreadyShipped = shipped.get(item.saleItemId) ?? 0;
    const alreadyCommitted = openCommitted.get(item.saleItemId) ?? 0;
    if (alreadyShipped + alreadyCommitted + item.quantity > saleItem.quantity) fail(409, `Shipment quantity exceeds remaining quantity for ${item.saleItemId}`);
    if ((reserved.get(item.saleItemId) ?? 0) < alreadyCommitted + item.quantity) fail(409, `Reserved stock is insufficient for ${item.saleItemId}`);
  }

  const created = await tx.saleShipment.create({
    data: {
      number: input.number ?? shipmentNumber(),
      saleId,
      warehouseId: sale.warehouseId,
      createdById: userId,
      shippingAddress: input.shippingAddress ?? sale.customer?.address ?? null,
      notes: input.notes ?? null,
      items: { create: input.items.map((item) => ({ saleItemId: item.saleItemId, productId: sale.items.find((line) => line.id === item.saleItemId)!.productId, quantity: item.quantity, notes: item.notes ?? null })) },
    },
    include: shipmentInclude,
  });
  await tx.sale.update({ where: { id: saleId }, data: { status: "PICKING" } });
  return created;
}

export async function pickShipment(tx: FulfillmentTx, id: string, input: PickShipmentInput, userId: string) {
  const shipment = await lockShipmentAndSale(tx, id);
  if (shipment.status !== "PICKING") fail(409, "Only PICKING shipments can be picked");
  const requested = input.items?.length ? new Map(input.items.map((item) => [item.shipmentItemId, item.quantity])) : new Map(shipment.items.map((item) => [item.id, item.quantity]));
  for (const item of shipment.items) {
    const quantity = requested.get(item.id);
    if (quantity === undefined) continue;
    if (quantity < 1 || quantity > item.quantity) fail(400, "Picked quantity must be within the shipment quantity");
    await tx.saleShipmentItem.update({ where: { id: item.id }, data: { pickedQuantity: quantity, pickedById: userId, pickedAt: new Date() } });
  }
  const updated = await tx.saleShipment.update({ where: { id }, data: { pickedAt: new Date() }, include: shipmentInclude });
  return updated;
}

export async function packShipment(tx: FulfillmentTx, id: string, userId: string) {
  const shipment = await lockShipmentAndSale(tx, id);
  if (shipment.status !== "PICKING") fail(409, "Only PICKING shipments can be packed");
  if (shipment.items.some((item) => item.pickedQuantity !== item.quantity)) fail(409, "All shipment items must be picked before packing");
  const items = await tx.saleShipmentItem.findMany({ where: { shipmentId: id }, select: { id: true, quantity: true } });
  for (const item of items) await tx.saleShipmentItem.update({ where: { id: item.id }, data: { packedQuantity: item.quantity, packedById: userId, packedAt: new Date() } });
  await tx.saleShipment.update({ where: { id }, data: { status: "PACKED", packedAt: new Date() } });
  await tx.sale.update({ where: { id: shipment.saleId }, data: { status: "PACKED" } });
  return getShipmentForRoute(tx, id);
}

export async function shipShipment(tx: FulfillmentTx, id: string, input: ShipShipmentInput, userId: string) {
  const shipment = await lockShipmentAndSale(tx, id);
  if (shipment.status !== "PACKED") fail(409, "Only PACKED shipments can be shipped");
  if (shipment.items.some((item) => item.packedQuantity !== item.quantity)) fail(409, "All shipment items must be packed before shipping");

  for (const item of shipment.items) {
    const allocations = await consumeSaleReservationsForItems(tx, shipment.saleId, [{ saleItemId: item.saleItemId, quantity: item.quantity }]);
    const movement = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: shipment.warehouseId, quantity: -item.quantity, movementType: "SALE_ISSUE", saleId: shipment.saleId, createdById: userId, note: `Shipment ${shipment.number}` } });
    await linkMovementAllocations(tx, movement.id, allocations, -1);
  }
  await tx.saleShipment.update({ where: { id }, data: { status: "SHIPPED", courier: input.courier, trackingNumber: input.trackingNumber, shippingAddress: input.shippingAddress ?? shipment.shippingAddress, notes: input.notes ?? shipment.notes, shippedAt: new Date() } });
  await setSaleProgress(tx, shipment.saleId, "PACKED");
  return getShipmentForRoute(tx, id);
}

export async function completeShipment(tx: FulfillmentTx, id: string) {
  const shipment = await lockShipmentAndSale(tx, id);
  if (shipment.status !== "SHIPPED") fail(409, "Only SHIPPED shipments can be completed");
  await tx.saleShipment.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
  const outstandingShipments = await tx.saleShipment.count({
    where: { saleId: shipment.saleId, status: { in: ["PICKING", "PACKED", "SHIPPED"] } },
  });
  await setSaleProgress(tx, shipment.saleId, "SHIPPED", outstandingShipments === 0);
  return getShipmentForRoute(tx, id);
}

export async function cancelShipment(tx: FulfillmentTx, id: string) {
  const shipment = await lockShipmentAndSale(tx, id);
  if (!["PICKING", "PACKED"].includes(shipment.status)) fail(409, "Only unshipped shipments can be cancelled");
  await tx.saleShipment.update({ where: { id }, data: { status: "CANCELLED" } });
  await setSaleProgress(tx, shipment.saleId, "RESERVED");
  return getShipmentForRoute(tx, id);
}
