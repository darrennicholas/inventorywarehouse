import { Prisma } from "../../generated/prisma/client.ts";
import { AppError } from "../../utils/AppError.ts";

export type InventoryTx = Prisma.TransactionClient;

export async function assertInventoryInvariant(tx: InventoryTx, productId: string, warehouseId: string) {
  const aggregate = await tx.inventoryBalance.findUnique({ where: { productId_warehouseId: { productId, warehouseId } }, select: { quantityOnHand: true, reservedQuantity: true } });
  if (!aggregate) return;
  if (aggregate.quantityOnHand < 0 || aggregate.reservedQuantity < 0 || aggregate.reservedQuantity > aggregate.quantityOnHand) throw new AppError(409, "Inventory balance invariant violated");
  const details = await tx.inventoryLocationBalance.findMany({ where: { productId, warehouseId }, select: { quantityOnHand: true, reservedQuantity: true } });
  if (!details.length) return;
  const quantity = details.reduce((sum, row) => sum + row.quantityOnHand, 0);
  const reserved = details.reduce((sum, row) => sum + row.reservedQuantity, 0);
  if (quantity !== aggregate.quantityOnHand || reserved !== aggregate.reservedQuantity) throw new AppError(409, "Detailed inventory does not match warehouse inventory");
}
