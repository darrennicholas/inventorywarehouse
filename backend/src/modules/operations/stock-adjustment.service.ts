import { Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "../../lib/prisma.ts";
import type { AuthContext } from "../../middlewares/auth.middleware.ts";
import { AppError } from "../../utils/AppError.ts";
import { linkMovementAllocations, postStockIn, postStockOut } from "./stock-allocation.service.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { assertApprovalAuthority } from "../approvals/approval-policy.service.ts";
import { lockCostBalance } from "./costing.service.ts";
import { ensureScopedWarehouse } from "./transaction-domain.service.ts";

export async function estimateStockValue(tx: Prisma.TransactionClient, items: Array<{ productId: string; quantity: number }>, warehouseId: string) {
  let total = 0;
  for (const item of items) {
    const balance = await lockCostBalance(tx, item.productId, warehouseId);
    if (balance.averageUnitCost === null) throw new AppError(409, "Record the unknown opening stock cost in Stock Report before approval amount limits can be evaluated");
    total += item.quantity * Number(balance.averageUnitCost);
  }
  return total;
}

export async function approveAdjustment(id: string, userId: string, auth: AuthContext) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StockAdjustment" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const current = await tx.stockAdjustment.findUnique({ where: { id }, include: { items: true } });
    if (!current) throw new AppError(404, "Adjustment not found");
    await ensureScopedWarehouse(tx, current.warehouseId, auth);
    if (current.status !== "DRAFT") throw new AppError(409, "Only draft adjustments can be approved");
    await assertApprovalAuthority(tx, "ADJUSTMENT", await estimateStockValue(tx, current.items, current.warehouseId), auth, current.createdById);
    for (const item of current.items) {
      const quantity = current.type === "INCREASE" ? item.quantity : -item.quantity;
      const allocations = current.type === "INCREASE"
        ? [await postStockIn(tx, { productId: item.productId, warehouseId: current.warehouseId, locationId: item.locationId, batchId: item.batchId, quantity: item.quantity })]
        : await postStockOut(tx, item.productId, current.warehouseId, item.quantity, { locationId: item.locationId, batchId: item.batchId });
      const movement = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: current.warehouseId, quantity, movementType: current.type === "INCREASE" ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", adjustmentId: id, createdById: userId, note: current.reason } });
      await linkMovementAllocations(tx, movement.id, allocations, current.type === "INCREASE" ? 1 : -1);
    }
    const updated = await tx.stockAdjustment.update({
      where: { id },
      data: { status: "POSTED", approvedById: userId, approvedAt: new Date() },
      include: { warehouse: true, approvedBy: { select: { id: true, fullName: true } }, items: true },
    });
    await writeAuditLog({ userId, action: "APPROVE", entity: "StockAdjustment", entityId: id, beforeData: current, afterData: updated }, tx as never);
    return updated;
  });
}
