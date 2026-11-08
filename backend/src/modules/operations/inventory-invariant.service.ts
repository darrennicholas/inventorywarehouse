import { Prisma } from "../../generated/prisma/client.ts";
import { AppError } from "../../utils/AppError.ts";

export type InventoryTx = Prisma.TransactionClient;

export async function assertInventoryInvariant(tx: InventoryTx, productId: string, warehouseId: string) {
  const aggregate = await tx.inventoryBalance.findUnique({ where: { productId_warehouseId: { productId, warehouseId } }, select: { quantityOnHand: true, reservedQuantity: true } });
  if (!aggregate) return;
  if (aggregate.quantityOnHand < 0 || aggregate.reservedQuantity < 0 || aggregate.reservedQuantity > aggregate.quantityOnHand) throw new AppError(409, "Inventory balance invariant violated");
  const details = await tx.inventoryLocationBalance.findMany({ where: { productId, warehouseId }, select: { batchId: true, quantityOnHand: true, reservedQuantity: true } });
  if (!details.length) {
    if (aggregate.quantityOnHand !== 0 || aggregate.reservedQuantity !== 0) {
      throw new AppError(409, "Detailed inventory is missing for a nonzero warehouse balance; reconcile stock locations before posting another movement");
    }
    return;
  }
  const quantity = details.reduce((sum, row) => sum + row.quantityOnHand, 0);
  const reserved = details.reduce((sum, row) => sum + row.reservedQuantity, 0);
  if (quantity !== aggregate.quantityOnHand || reserved !== aggregate.reservedQuantity) throw new AppError(409, "Detailed inventory does not match warehouse inventory");

  const activeReservations = await tx.stockReservation.aggregate({
    where: { productId, warehouseId, status: "ACTIVE" },
    _sum: { quantity: true },
  });
  if ((activeReservations._sum.quantity ?? 0) !== aggregate.reservedQuantity) {
    throw new AppError(409, "Active reservation records do not match reserved inventory");
  }

  const product = await tx.product.findUnique({ where: { id: productId }, select: { trackBatch: true } });
  if (product?.trackBatch) {
    if (details.some((row) => row.batchId === null)) {
      throw new AppError(409, "Batch-tracked inventory contains a location balance without a batch");
    }
    const batches = await tx.productBatch.findMany({ where: { productId, warehouseId }, select: { id: true, quantityOnHand: true, reservedQuantity: true } });
    const locationByBatch = new Map<string, { quantity: number; reserved: number }>();
    for (const row of details) {
      const current = locationByBatch.get(row.batchId!) ?? { quantity: 0, reserved: 0 };
      current.quantity += row.quantityOnHand;
      current.reserved += row.reservedQuantity;
      locationByBatch.set(row.batchId!, current);
    }
    for (const batch of batches) {
      const location = locationByBatch.get(batch.id) ?? { quantity: 0, reserved: 0 };
      if (location.quantity !== batch.quantityOnHand || location.reserved !== batch.reservedQuantity) {
        throw new AppError(409, "Batch balances do not match their location balances");
      }
    }
    if (batches.reduce((sum, batch) => sum + batch.quantityOnHand, 0) !== aggregate.quantityOnHand
      || batches.reduce((sum, batch) => sum + batch.reservedQuantity, 0) !== aggregate.reservedQuantity) {
      throw new AppError(409, "Batch balances do not match warehouse inventory");
    }
  }
}
