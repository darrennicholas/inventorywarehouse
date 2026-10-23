import { randomUUID } from "node:crypto";

import { Prisma } from "../../generated/prisma/client.ts";
import { AppError } from "../../utils/AppError.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import type { InventoryTx, StockAllocation } from "./stock-allocation.service.ts";
import { allocateAvailableStock, changeLocationReservation, consumeLocationReservation } from "./stock-allocation.service.ts";

const reservationTtlMinutes = Math.max(5, Number(process.env.STOCKFLOW_RESERVATION_TTL_MINUTES ?? 60));

/** Legacy aggregate writer kept for hardening tests and old data repair tools. */
export async function changeStock(tx: InventoryTx, productId: string, warehouseId: string, delta: number) {
  if (!Number.isSafeInteger(delta) || delta === 0) throw new AppError(400, "Stock delta must be a nonzero safe integer");
  const rows = delta < 0
    ? await tx.$queryRaw<Array<{ id: string; quantityOnHand: number }>>(Prisma.sql`
        UPDATE "InventoryBalance" SET "quantityOnHand" = "quantityOnHand" + ${delta}, "updatedAt" = NOW()
        WHERE "productId" = ${productId}::uuid AND "warehouseId" = ${warehouseId}::uuid
          AND "quantityOnHand" + ${delta} >= 0 AND "quantityOnHand" + ${delta} >= "reservedQuantity"
        RETURNING "id", "quantityOnHand"
      `)
    : await tx.$queryRaw<Array<{ id: string; quantityOnHand: number }>>(Prisma.sql`
        INSERT INTO "InventoryBalance" ("id", "productId", "warehouseId", "quantityOnHand", "reservedQuantity", "updatedAt")
        VALUES (${randomUUID()}::uuid, ${productId}::uuid, ${warehouseId}::uuid, ${delta}, 0, NOW())
        ON CONFLICT ("productId", "warehouseId") DO UPDATE SET
          "quantityOnHand" = "InventoryBalance"."quantityOnHand" + EXCLUDED."quantityOnHand", "updatedAt" = NOW()
        RETURNING "id", "quantityOnHand"
      `);
  if (rows.length !== 1) throw new AppError(409, `Insufficient stock for ${productId}`);
  return rows[0];
}

type ReservationLine = { id: string; productId: string; quantity: number };

function reservationExpiry() {
  return new Date(Date.now() + reservationTtlMinutes * 60_000);
}

export async function reserveSaleStock(tx: InventoryTx, saleId: string, warehouseId: string, userId: string, items: ReservationLine[]) {
  const existing = await tx.stockReservation.count({ where: { saleId, status: "ACTIVE" } });
  if (existing > 0) throw new AppError(409, "This sale already has an active reservation");

  for (const item of items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new AppError(400, "Invalid sale quantity");
    const product = await tx.product.findUnique({ where: { id: item.productId }, select: { trackBatch: true } });
    if (!product) throw new AppError(404, `Product ${item.productId} not found`);
    const aggregate = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "InventoryBalance" SET "reservedQuantity" = "reservedQuantity" + ${item.quantity}, "updatedAt" = NOW()
      WHERE "productId" = ${item.productId}::uuid AND "warehouseId" = ${warehouseId}::uuid
        AND "quantityOnHand" - "reservedQuantity" >= ${item.quantity}
      RETURNING "id"
    `);
    if (aggregate.length !== 1) throw new AppError(409, `Insufficient available stock for ${item.productId}`);

    const allocations = await allocateAvailableStock(tx, item.productId, warehouseId, item.quantity);
    for (const allocation of allocations) {
      await changeLocationReservation(tx, allocation.locationBalanceId, allocation.quantity);
      if (allocation.batchId) {
        const batch = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          UPDATE "ProductBatch" SET "reservedQuantity" = "reservedQuantity" + ${allocation.quantity}, "updatedAt" = NOW()
          WHERE "id" = ${allocation.batchId}::uuid AND "quantityOnHand" - "reservedQuantity" >= ${allocation.quantity}
          RETURNING "id"
        `);
        if (batch.length !== 1) throw new AppError(409, "Batch reservation failed");
      }
      await tx.stockReservation.create({ data: { saleId, saleItemId: item.id, productId: item.productId, warehouseId, batchId: allocation.batchId, locationBalanceId: allocation.locationBalanceId, quantity: allocation.quantity, reservedById: userId, expiresAt: reservationExpiry() } });
    }
  }
}

export async function releaseSaleReservations(tx: InventoryTx, saleId: string, status: "RELEASED" | "CANCELLED" = "RELEASED", releaseReason = "Reservation released") {
  const reservations = await tx.stockReservation.findMany({ where: { saleId, status: "ACTIVE" }, orderBy: { id: "asc" } });
  for (const reservation of reservations) {
    if (reservation.batchId) {
      const updated = await tx.productBatch.updateMany({ where: { id: reservation.batchId, reservedQuantity: { gte: reservation.quantity } }, data: { reservedQuantity: { decrement: reservation.quantity } } });
      if (updated.count !== 1) throw new AppError(409, "Batch reservation release failed");
    }
    if (reservation.locationBalanceId) await changeLocationReservation(tx, reservation.locationBalanceId, -reservation.quantity);
    const aggregate = await tx.inventoryBalance.updateMany({ where: { productId: reservation.productId, warehouseId: reservation.warehouseId, reservedQuantity: { gte: reservation.quantity } }, data: { reservedQuantity: { decrement: reservation.quantity } } });
    if (aggregate.count !== 1) throw new AppError(409, "Warehouse reservation release failed");
    await tx.stockReservation.update({ where: { id: reservation.id }, data: { status, releasedAt: new Date(), releaseReason } });
  }
}

/** Consume only the requested quantity for a shipment, preserving the rest of
 * an active reservation for later partial shipments. Allocations are returned
 * so the shipment movement remains traceable to location and batch. */
export async function consumeSaleReservationsForItems(
  tx: InventoryTx,
  saleId: string,
  items: Array<{ saleItemId: string; quantity: number }>,
): Promise<StockAllocation[]> {
  const allocations: StockAllocation[] = [];
  for (const item of items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new AppError(400, "Shipment quantity must be a positive integer");
    let remaining = item.quantity;
    const reservations = await tx.stockReservation.findMany({
      where: { saleId, saleItemId: item.saleItemId, status: "ACTIVE" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    for (const reservation of reservations) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, reservation.quantity);
      const locationBalance = reservation.locationBalanceId
        ? await tx.inventoryLocationBalance.findUnique({ where: { id: reservation.locationBalanceId }, select: { id: true, locationId: true } })
        : null;
      if (!locationBalance) throw new AppError(409, "Shipment reservation is missing a location allocation");
      if (reservation.batchId) {
        const batch = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          UPDATE "ProductBatch"
          SET "quantityOnHand" = "quantityOnHand" - ${take},
              "reservedQuantity" = "reservedQuantity" - ${take},
              "status" = CASE WHEN "quantityOnHand" - ${take} = 0 THEN 'DEPLETED'::"BatchStatus" ELSE "status" END,
              "updatedAt" = NOW()
          WHERE "id" = ${reservation.batchId}::uuid
            AND "quantityOnHand" >= ${take}
            AND "reservedQuantity" >= ${take}
          RETURNING "id"
        `);
        if (batch.length !== 1) throw new AppError(409, "Reserved batch cannot be consumed");
      }
      await consumeLocationReservation(tx, locationBalance.id, take);
      const aggregate = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE "InventoryBalance"
        SET "quantityOnHand" = "quantityOnHand" - ${take},
            "reservedQuantity" = "reservedQuantity" - ${take},
            "updatedAt" = NOW()
        WHERE "productId" = ${reservation.productId}::uuid
          AND "warehouseId" = ${reservation.warehouseId}::uuid
          AND "quantityOnHand" >= ${take}
          AND "reservedQuantity" >= ${take}
        RETURNING "id"
      `);
      if (aggregate.length !== 1) throw new AppError(409, "Reserved warehouse stock cannot be consumed");
      if (take === reservation.quantity) {
        await tx.stockReservation.update({ where: { id: reservation.id }, data: { status: "CONSUMED", consumedAt: new Date(), expiresAt: null } });
      } else {
        await tx.stockReservation.update({ where: { id: reservation.id }, data: { quantity: { decrement: take } } });
      }
      allocations.push({ locationBalanceId: locationBalance.id, locationId: locationBalance.locationId, batchId: reservation.batchId, quantity: take });
      remaining -= take;
    }
    if (remaining > 0) throw new AppError(409, `Reserved stock is insufficient for sale item ${item.saleItemId}`);
  }
  return allocations;
}

export async function consumeSaleReservations(tx: InventoryTx, saleId: string) {
  const reservations = await tx.stockReservation.findMany({ where: { saleId, status: "ACTIVE" }, orderBy: { id: "asc" } });
  for (const reservation of reservations) {
    if (reservation.batchId) {
      const batch = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE "ProductBatch" SET "quantityOnHand" = "quantityOnHand" - ${reservation.quantity}, "reservedQuantity" = "reservedQuantity" - ${reservation.quantity},
          "status" = CASE WHEN "quantityOnHand" - ${reservation.quantity} = 0 THEN 'DEPLETED'::"BatchStatus" ELSE "status" END, "updatedAt" = NOW()
        WHERE "id" = ${reservation.batchId}::uuid AND "quantityOnHand" >= ${reservation.quantity} AND "reservedQuantity" >= ${reservation.quantity}
        RETURNING "id"
      `);
      if (batch.length !== 1) throw new AppError(409, "Reserved batch cannot be consumed");
    }
    if (reservation.locationBalanceId) await consumeLocationReservation(tx, reservation.locationBalanceId, reservation.quantity);
    const aggregate = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "InventoryBalance" SET "quantityOnHand" = "quantityOnHand" - ${reservation.quantity}, "reservedQuantity" = "reservedQuantity" - ${reservation.quantity}, "updatedAt" = NOW()
      WHERE "productId" = ${reservation.productId}::uuid AND "warehouseId" = ${reservation.warehouseId}::uuid
        AND "quantityOnHand" >= ${reservation.quantity} AND "reservedQuantity" >= ${reservation.quantity}
      RETURNING "id"
    `);
    if (aggregate.length !== 1) throw new AppError(409, "Reserved warehouse stock cannot be consumed");
    await tx.stockReservation.update({ where: { id: reservation.id }, data: { status: "CONSUMED", consumedAt: new Date(), expiresAt: null } });
  }
}

export async function releaseExpiredReservations() {
  const { prisma } = await import("../../lib/prisma.ts");
  const candidates = await prisma.stockReservation.findMany({ where: { status: "ACTIVE", expiresAt: { lte: new Date() } }, select: { saleId: true }, distinct: ["saleId"] });
  const expiredSales: Array<{ id: string; number: string; warehouseId: string }> = [];
  let released = 0;
  for (const candidate of candidates) {
    await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id: candidate.saleId }, select: { id: true, number: true, warehouseId: true, status: true } });
      if (!sale || sale.status !== "RESERVED") return;
      await releaseSaleReservations(tx, sale.id, "RELEASED", "Reservation expired");
      await tx.sale.update({ where: { id: sale.id }, data: { status: "DRAFT" } });
      expiredSales.push({ id: sale.id, number: sale.number, warehouseId: sale.warehouseId });
      released += 1;
    });
  }
  for (const sale of expiredSales) {
    await notifyByPermission({ permission: "sales.read", type: "SALE_RESERVATION_EXPIRED", title: "Sale reservation expired", message: `${sale.number} reservation expired and the stock was released.`, entity: "Sale", entityId: sale.id, warehouseId: sale.warehouseId });
  }
  return released;
}

export async function updateExpiredBatches(tx: InventoryTx | null = null) {
  const client = tx ?? (await import("../../lib/prisma.ts")).prisma;
  await client.productBatch.updateMany({ where: { expiryDate: { lt: new Date() }, status: "ACTIVE", quantityOnHand: { gt: 0 } }, data: { status: "EXPIRED" } });
}
