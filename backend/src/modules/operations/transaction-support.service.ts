import { Prisma } from "../../generated/prisma/client.ts";
import { AppError } from "../../utils/AppError.ts";

export const saleInclude = {
  customer: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  items: { include: { product: { select: { id: true, sku: true, barcode: true, name: true, trackBatch: true } } } },
} as const;

export async function ensureTransitionAllowed(currentStatus: string, nextStatus: string, allowed: string[]) {
  if (!allowed.includes(nextStatus)) throw new AppError(400, `Invalid status: ${nextStatus}`);
  if (["RECEIVED", "COMPLETED", "POSTED", "CANCELLED"].includes(currentStatus)) throw new AppError(409, "A posted transaction cannot be edited");
}
