import { Prisma } from "../../generated/prisma/client.ts";
import { AppError } from "../../utils/AppError.ts";

export async function lockCostBalance(tx: Prisma.TransactionClient, productId: string, warehouseId: string) {
  await tx.inventoryBalance.upsert({ where: { productId_warehouseId: { productId, warehouseId } }, create: { productId, warehouseId }, update: {} });
  await tx.$queryRaw`SELECT "id" FROM "InventoryBalance" WHERE "productId" = ${productId}::uuid AND "warehouseId" = ${warehouseId}::uuid FOR UPDATE`;
  return tx.inventoryBalance.findUniqueOrThrow({ where: { productId_warehouseId: { productId, warehouseId } } });
}

export function incomingAverage(oldQuantity: number, oldCost: Prisma.Decimal | null, quantity: number, incomingCost: Prisma.Decimal | null) {
  if (incomingCost === null || (oldQuantity > 0 && oldCost === null)) return null;
  return new Prisma.Decimal(oldCost ?? 0).mul(oldQuantity).plus(incomingCost.mul(quantity)).div(oldQuantity + quantity).toDecimalPlaces(6);
}

export async function receiveCost(tx: Prisma.TransactionClient, productId: string, warehouseId: string, quantity: number, unitCost?: Prisma.Decimal | number | string | null) {
  const balance = await lockCostBalance(tx, productId, warehouseId);
  const incoming = unitCost === undefined ? balance.averageUnitCost : unitCost === null ? null : new Prisma.Decimal(unitCost);
  if (incoming?.isNegative()) throw new AppError(400, "Unit cost cannot be negative");
  const averageUnitCost = incomingAverage(balance.quantityOnHand, balance.averageUnitCost, quantity, incoming);
  await tx.inventoryBalance.update({ where: { id: balance.id }, data: { averageUnitCost } });
  return incoming;
}

export async function originalSaleCost(tx: Prisma.TransactionClient, saleId: string, productId: string) {
  const rows = await tx.stockMovement.findMany({ where: { saleId, productId, movementType: "SALE_ISSUE", quantity: { lt: 0 } }, select: { quantity: true, unitCost: true, costMethod: true } });
  if (!rows.length || rows.some((row) => row.unitCost === null || row.costMethod !== "WAC")) return null;
  const qty = rows.reduce((sum, row) => sum + Math.abs(row.quantity), 0);
  return rows.reduce((sum, row) => sum.plus(row.unitCost!.mul(Math.abs(row.quantity))), new Prisma.Decimal(0)).div(qty).toDecimalPlaces(6);
}
