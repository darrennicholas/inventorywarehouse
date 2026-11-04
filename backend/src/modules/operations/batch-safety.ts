import { AppError } from "../../utils/AppError.ts";

type Batch = { status: string; expiryDate: Date | null; productionDate: Date | null };
type Dates = { expiryDate?: Date | null; productionDate?: Date | null };

/** Existing batch identity is immutable: a receipt must not revive or rewrite it. */
export function assertUsableBatch(batch: Batch, incoming: Dates, now = new Date()): void {
  if (["EXPIRED", "QUARANTINED"].includes(batch.status) || (batch.expiryDate && batch.expiryDate <= now)) {
    throw new AppError(409, "Batch is expired or quarantined and cannot be received into available stock");
  }
  if (!["ACTIVE", "DEPLETED"].includes(batch.status)) throw new AppError(409, "Inactive batch cannot be received into available stock");
  if (incoming.expiryDate && incoming.expiryDate <= now) throw new AppError(400, "Expired goods cannot be received into available stock");
  for (const field of ["expiryDate", "productionDate"] as const) {
    const supplied = incoming[field];
    if (supplied && (!batch[field] || supplied.getTime() !== batch[field]!.getTime())) {
      throw new AppError(409, `Batch ${field} differs from the existing batch; use the original date`);
    }
  }
}
