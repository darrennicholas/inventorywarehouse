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
  if (!shipment) fail(404, "Pengiriman tidak ditemukan.");
  return shipment;
}

async function lockShipmentAndSale(tx: FulfillmentTx, id: string) {
  const snapshot = await tx.saleShipment.findUnique({ where: { id }, select: { id: true, saleId: true } });
  if (!snapshot) fail(404, "Pengiriman tidak ditemukan.");
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
  if (!sale) fail(404, "Penjualan tidak ditemukan.");
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
  const summaryWhere: Prisma.SaleShipmentWhereInput = {
    ...(query.saleId ? { saleId: query.saleId } : {}),
    ...(query.search ? { OR: [{ number: { contains: query.search, mode: "insensitive" } }, { sale: { number: { contains: query.search, mode: "insensitive" } } }] } : {}),
    warehouseId: query.warehouseId && warehouseIds
      ? { equals: query.warehouseId, in: warehouseIds }
      : query.warehouseId
        ? query.warehouseId
        : warehouseIds ? { in: warehouseIds } : undefined,
  };
  const where: Prisma.SaleShipmentWhereInput = { ...summaryWhere, ...(query.status ? { status: query.status } : {}) };
  const [data, total, groupedStatuses] = await Promise.all([
    tx.saleShipment.findMany({ where, include: shipmentInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    tx.saleShipment.count({ where }),
    tx.saleShipment.groupBy({ by: ["status"], where: summaryWhere, _count: { _all: true } }),
  ]);
  const summary = { PICKING: 0, PACKED: 0, SHIPPED: 0, COMPLETED: 0, CANCELLED: 0 };
  for (const item of groupedStatuses) summary[item.status] = item._count._all;
  return { data, total, page: query.page, pageSize: query.pageSize, summary };
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
  if (!sale) fail(404, "Penjualan tidak ditemukan.");
  if (!["RESERVED", "PICKING", "PACKED", "PARTIALLY_SHIPPED"].includes(sale.status)) {
    fail(409, "Stok penjualan harus dipesan sebelum pengiriman dapat dibuat.");
  }

  const requested = new Map(input.items.map((item) => [item.saleItemId, item]));
  if (requested.size !== input.items.length) fail(400, "Barang penjualan yang sama hanya boleh dicantumkan satu kali dalam pengiriman.");
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
    if (!saleItem) fail(400, "Barang pengiriman bukan bagian dari penjualan ini.");
    const alreadyShipped = shipped.get(item.saleItemId) ?? 0;
    const alreadyCommitted = openCommitted.get(item.saleItemId) ?? 0;
    if (alreadyShipped + alreadyCommitted + item.quantity > saleItem.quantity) fail(409, `Jumlah pengiriman melebihi sisa jumlah barang ${item.saleItemId}.`);
    if ((reserved.get(item.saleItemId) ?? 0) < alreadyCommitted + item.quantity) fail(409, `Stok yang dipesan tidak mencukupi untuk barang ${item.saleItemId}.`);
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
  await setSaleProgress(tx, saleId, "PICKING");
  return created;
}

export async function pickShipment(tx: FulfillmentTx, id: string, input: PickShipmentInput, userId: string) {
  const shipment = await lockShipmentAndSale(tx, id);
  if (shipment.status !== "PICKING") fail(409, "Barang hanya dapat diambil saat status pengiriman Sedang diambil.");
  const requested = input.items?.length ? new Map(input.items.map((item) => [item.shipmentItemId, item.quantity])) : new Map(shipment.items.map((item) => [item.id, item.quantity]));
  for (const item of shipment.items) {
    const quantity = requested.get(item.id);
    if (quantity === undefined) continue;
    if (quantity < 0 || quantity > item.quantity) fail(400, "Jumlah barang yang diambil harus antara nol dan jumlah pengiriman.");
    await tx.saleShipmentItem.update({ where: { id: item.id }, data: { pickedQuantity: quantity, pickedById: userId, pickedAt: new Date() } });
  }
  const updated = await tx.saleShipment.update({ where: { id }, data: { pickedAt: new Date() }, include: shipmentInclude });
  return updated;
}

export async function packShipment(tx: FulfillmentTx, id: string, userId: string) {
  const shipment = await lockShipmentAndSale(tx, id);
  if (shipment.status !== "PICKING") fail(409, "Pengiriman hanya dapat dikemas saat statusnya Sedang diambil.");
  if (shipment.items.some((item) => item.pickedQuantity !== item.quantity)) fail(409, "Semua barang harus diambil sebelum pengiriman dikemas.");
  const items = await tx.saleShipmentItem.findMany({ where: { shipmentId: id }, select: { id: true, quantity: true } });
  for (const item of items) await tx.saleShipmentItem.update({ where: { id: item.id }, data: { packedQuantity: item.quantity, packedById: userId, packedAt: new Date() } });
  await tx.saleShipment.update({ where: { id }, data: { status: "PACKED", packedAt: new Date() } });
  await setSaleProgress(tx, shipment.saleId, "PACKED");
  return getShipmentForRoute(tx, id);
}

export async function shipShipment(tx: FulfillmentTx, id: string, input: ShipShipmentInput, userId: string) {
  const shipment = await lockShipmentAndSale(tx, id);
  if (shipment.status !== "PACKED") fail(409, "Pengiriman hanya dapat dikirim setelah statusnya Siap dikirim.");
  if (shipment.items.some((item) => item.packedQuantity !== item.quantity)) fail(409, "Semua barang harus dikemas sebelum dikirim.");

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
  if (shipment.status !== "SHIPPED") fail(409, "Pengiriman hanya dapat diselesaikan setelah berstatus Dalam perjalanan.");
  await tx.saleShipment.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
  const outstandingShipments = await tx.saleShipment.count({
    where: { saleId: shipment.saleId, status: { in: ["PICKING", "PACKED", "SHIPPED"] } },
  });
  await setSaleProgress(tx, shipment.saleId, "SHIPPED", outstandingShipments === 0);
  return getShipmentForRoute(tx, id);
}

export async function cancelShipment(tx: FulfillmentTx, id: string) {
  const shipment = await lockShipmentAndSale(tx, id);
  if (!["PICKING", "PACKED"].includes(shipment.status)) fail(409, "Hanya pengiriman yang belum dikirim yang dapat dibatalkan.");
  await tx.saleShipment.update({ where: { id }, data: { status: "CANCELLED" } });
  await setSaleProgress(tx, shipment.saleId, "RESERVED");
  return getShipmentForRoute(tx, id);
}
