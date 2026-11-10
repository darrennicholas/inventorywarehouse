import { prisma } from "../../lib/prisma.ts";
import type { AuthContext } from "../../middlewares/auth.middleware.ts";
import { AppError } from "../../utils/AppError.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { ensureScopedWarehouse } from "./transaction-domain.service.ts";

export async function approveTransfer(id: string, userId: string, auth: AuthContext) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StockTransfer" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const current = await tx.stockTransfer.findUnique({ where: { id } });
    if (!current) throw new AppError(404, "Transfer not found");
    await ensureScopedWarehouse(tx, current.fromWarehouseId, auth);
    if (current.status !== "DRAFT") throw new AppError(409, "Only draft transfers can be approved");
    if (current.createdById === auth.userId) throw new AppError(403, "The document creator cannot approve their own document");
    const updated = await tx.stockTransfer.update({
      where: { id },
      data: { status: "IN_TRANSIT", approvedById: userId, approvedAt: new Date() },
      include: { fromWarehouse: true, toWarehouse: true, approvedBy: { select: { id: true, fullName: true } }, items: true },
    });
    await writeAuditLog({ userId, action: "APPROVE", entity: "StockTransfer", entityId: id, beforeData: current, afterData: updated }, tx as never);
    return updated;
  });
}
