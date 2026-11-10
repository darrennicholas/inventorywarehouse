import { Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "../../lib/prisma.ts";
import type { AuthContext } from "../../middlewares/auth.middleware.ts";
import { AppError } from "../../utils/AppError.ts";
import { linkMovementAllocations, postStockIn } from "./stock-allocation.service.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { assertApprovalAuthority } from "../approvals/approval-policy.service.ts";
import { ensureScopedWarehouse, ensureLocation, ensureReceiptBatch } from "./transaction-domain.service.ts";
import type { PurchaseReceiveInput } from "./operations.validation.ts";

export const purchaseInclude = {
  supplier: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  items: { include: { product: { select: { id: true, sku: true, barcode: true, name: true, trackBatch: true } } } },
} as const;

export async function approvePurchase(id: string, userId: string, auth: AuthContext) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const current = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!current) throw new AppError(404, "Pesanan pembelian tidak ditemukan.");
    await ensureScopedWarehouse(tx, current.warehouseId, auth);
    if (current.status !== "PENDING") throw new AppError(409, "Only pending purchases can be approved");
    await assertApprovalAuthority(tx, "PURCHASE", Number(current.total), auth, current.createdById);
    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: { status: "APPROVED", approvedById: userId, approvedAt: new Date() },
      include: purchaseInclude,
    });
    await writeAuditLog({ userId, action: "APPROVE", entity: "PurchaseOrder", entityId: id, beforeData: current, afterData: updated }, tx as never);
    return updated;
  });
}

export async function receivePurchase(id: string, input: PurchaseReceiveInput, userId: string, auth: AuthContext) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const current = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!current) throw new AppError(404, "Pesanan pembelian tidak ditemukan.");
    await ensureScopedWarehouse(tx, current.warehouseId, auth);
    if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(current.status)) {
      throw new AppError(409, "Penerimaan hanya dapat dilakukan untuk pesanan berstatus Disetujui atau Diterima sebagian.");
    }

    const requested: Array<{ productId: string; quantity: number; damagedQuantity: number; batchNumber?: string | null; expiryDate?: Date | null; productionDate?: Date | null; locationId?: string | null; notes?: string | null }> = input.items ?? current.items
      .filter((item) => item.receivedQuantity < item.quantity)
      .map((item) => ({ productId: item.productId, quantity: item.quantity - item.receivedQuantity, damagedQuantity: 0, batchNumber: item.batchNumber, expiryDate: item.expiryDate, productionDate: item.productionDate }));
    if (requested.length === 0) throw new AppError(409, "Semua barang pada pesanan ini sudah diterima.");

    const itemByProduct = new Map(current.items.map((item) => [item.productId, item]));
    const seen = new Set<string>();
    for (const requestedItem of requested) {
      if (seen.has(requestedItem.productId)) throw new AppError(400, "Satu produk hanya boleh dicatat satu kali dalam satu penerimaan.");
      seen.add(requestedItem.productId);
      const orderItem = itemByProduct.get(requestedItem.productId);
      if (!orderItem) throw new AppError(400, "Produk yang diterima tidak tercantum pada pesanan pembelian ini.");
      const receivedTotal = requestedItem.quantity + requestedItem.damagedQuantity;
      const remaining = orderItem.quantity - orderItem.receivedQuantity;
      if (receivedTotal > remaining) {
        throw new AppError(400, `Jumlah baik dan rusak melebihi sisa pesanan (${remaining}) untuk produk ${requestedItem.productId}.`);
      }
    }

    const receiptNumber = input.receiptNumber ?? `GR-${current.number}-${Date.now().toString().slice(-6)}`;
    const receiptItems: Array<{ purchaseOrderItemId: string; productId: string; locationId: string; batchId: string | null; quantity: number; damagedQuantity: number; notes: string | null }> = [];
    for (const requestedItem of requested) {
      const orderItem = itemByProduct.get(requestedItem.productId)!;
      // Purchase has no discount column; recoverable invoice tax is excluded from cost.
      const incomingCost = orderItem.unitPrice;
      const product = await tx.product.findUnique({ where: { id: requestedItem.productId }, select: { trackBatch: true } });
      if (!product) throw new AppError(404, `Produk ${requestedItem.productId} tidak ditemukan.`);
      const location = await ensureLocation(tx, current.warehouseId, requestedItem.locationId);
      if (requestedItem.quantity > 0 && location.locationType !== "STORAGE") throw new AppError(400, "Barang baik harus ditempatkan pada lokasi penyimpanan aktif.");
      let damagedLocation: typeof location | null = null;
      if (requestedItem.damagedQuantity > 0) {
        damagedLocation = await tx.warehouseLocation.upsert({ where: { warehouseId_code: { warehouseId: current.warehouseId, code: "RECEIVING-DAMAGED" } }, create: { warehouseId: current.warehouseId, code: "RECEIVING-DAMAGED", name: "Karantina penerimaan", locationType: "QUARANTINE" }, update: {} });
        if (!damagedLocation.isActive || damagedLocation.locationType !== "QUARANTINE") throw new AppError(409, "Lokasi RECEIVING-DAMAGED harus aktif dan bertipe karantina.");
      }
      const batchNumber = requestedItem.batchNumber ?? orderItem.batchNumber;
      const expiryDate = requestedItem.expiryDate ?? orderItem.expiryDate;
      const productionDate = requestedItem.productionDate ?? orderItem.productionDate;
      const batch = await ensureReceiptBatch(tx, { productId: requestedItem.productId, warehouseId: current.warehouseId, batchNumber, expiryDate, productionDate, locationId: requestedItem.quantity > 0 ? location.id : damagedLocation!.id }, product.trackBatch, requestedItem.quantity === 0);
      const allocation = requestedItem.quantity > 0 ? await postStockIn(tx, { productId: requestedItem.productId, warehouseId: current.warehouseId, locationId: location.id, batchId: batch?.id ?? null, quantity: requestedItem.quantity, unitCost: incomingCost }) : null;
      if (allocation) {
        const movement = await tx.stockMovement.create({ data: { productId: requestedItem.productId, warehouseId: current.warehouseId, quantity: requestedItem.quantity, movementType: "PURCHASE_RECEIPT", unitCost: orderItem.unitPrice, purchaseOrderId: id, createdById: userId, note: "Penerimaan pembelian" } });
        await linkMovementAllocations(tx, movement.id, [allocation], 1);
      }
      if (requestedItem.quantity > 0) receiptItems.push({ purchaseOrderItemId: orderItem.id, productId: requestedItem.productId, locationId: location.id, batchId: batch?.id ?? null, quantity: requestedItem.quantity, damagedQuantity: 0, notes: requestedItem.notes ?? null });
      if (requestedItem.damagedQuantity > 0 && damagedLocation) {
        const damagedAllocation = await postStockIn(tx, { productId: requestedItem.productId, warehouseId: current.warehouseId, locationId: damagedLocation.id, batchId: batch?.id ?? null, quantity: requestedItem.damagedQuantity, unitCost: incomingCost, reactivateBatch: false });
        const damagedMovement = await tx.stockMovement.create({ data: { productId: requestedItem.productId, warehouseId: current.warehouseId, quantity: requestedItem.damagedQuantity, movementType: "PURCHASE_RECEIPT", purchaseOrderId: id, createdById: userId, note: "Barang rusak saat penerimaan; masuk karantina dan tidak dapat dijual" } });
        await linkMovementAllocations(tx, damagedMovement.id, [damagedAllocation], 1);
        receiptItems.push({ purchaseOrderItemId: orderItem.id, productId: requestedItem.productId, locationId: damagedLocation.id, batchId: batch?.id ?? null, quantity: 0, damagedQuantity: requestedItem.damagedQuantity, notes: requestedItem.notes ?? "Barang rusak saat diterima dan disimpan di karantina" });
      }
      await tx.purchaseOrderItem.update({ where: { id: orderItem.id }, data: { receivedQuantity: { increment: requestedItem.quantity + requestedItem.damagedQuantity }, ...(batchNumber ? { batchNumber } : {}), ...(expiryDate !== undefined ? { expiryDate } : {}), ...(productionDate !== undefined ? { productionDate } : {}) } });
    }

    const receipt = await tx.goodsReceipt.create({ data: { number: receiptNumber, purchaseOrderId: id, warehouseId: current.warehouseId, receivedById: userId, notes: input.notes ?? null, items: { create: receiptItems } } });
    const allReceived = current.items.every((item) => item.receivedQuantity + (requested.find((row) => row.productId === item.productId)?.quantity ?? 0) + (requested.find((row) => row.productId === item.productId)?.damagedQuantity ?? 0) >= item.quantity);
    const updated = await tx.purchaseOrder.update({ where: { id }, data: { status: allReceived ? "RECEIVED" : "PARTIALLY_RECEIVED" }, include: purchaseInclude });
    await writeAuditLog({ userId, action: "RECEIVE", entity: "PurchaseOrder", entityId: id, beforeData: current, afterData: updated }, tx as never);
    return { ...updated, receiptId: receipt.id, receiptNumber: receipt.number };
  });
}
