import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { authOf } from "../../middlewares/auth.middleware.ts";
import { scopedWarehouseFilter } from "../../rbac/warehouse-scope.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { updateExpiredBatches } from "../operations/inventory.service.ts";
import { pageMeta, pagination } from "../../utils/pagination.ts";

const router = Router();
const querySchema = z.object({ unreadOnly: z.coerce.boolean().default(false), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional() });

async function refreshNotifications(userId: string, auth: ReturnType<typeof authOf>) {
  await updateExpiredBatches();
  const warehouseFilter = scopedWarehouseFilter(auth);
  const balances = await prisma.inventoryBalance.findMany({
    where: warehouseFilter,
    select: { warehouseId: true, quantityOnHand: true, reservedQuantity: true, warehouse: { select: { name: true } }, product: { select: { id: true, name: true, minStock: true } } },
  });
  const lowStock = balances.filter((row) => row.quantityOnHand - row.reservedQuantity <= row.product.minStock).slice(0, 30);
  for (const row of lowStock) {
    await prisma.notification.upsert({
      where: { fingerprint: `LOW_STOCK:${userId}:${row.product.id}:${row.warehouseId}` },
      create: { fingerprint: `LOW_STOCK:${userId}:${row.product.id}:${row.warehouseId}`, userId, type: "LOW_STOCK", title: "Low stock attention", message: `${row.product.name} di ${row.warehouse.name} tinggal ${row.quantityOnHand - row.reservedQuantity} unit tersedia.`, entity: "InventoryBalance", entityId: `${row.product.id}:${row.warehouseId}` },
      update: { message: `${row.product.name} di ${row.warehouse.name} tinggal ${row.quantityOnHand - row.reservedQuantity} unit tersedia.` },
    });
  }

  if (auth.permissions.includes("purchases.approve")) {
    const pendingPurchases = await prisma.purchaseOrder.findMany({ where: { ...warehouseFilter, status: "PENDING" }, select: { id: true, number: true, warehouseId: true }, take: 20 });
    for (const row of pendingPurchases) {
      await prisma.notification.upsert({
        where: { fingerprint: `PURCHASE_APPROVAL:${userId}:${row.id}` },
        create: { fingerprint: `PURCHASE_APPROVAL:${userId}:${row.id}`, userId, type: "APPROVAL_REQUIRED", title: "Purchase approval required", message: `${row.number} menunggu persetujuan.`, entity: "PurchaseOrder", entityId: row.id },
        update: { message: `${row.number} menunggu persetujuan.` },
      });
    }
  }

  if (auth.permissions.includes("stock-opnames.approve")) {
    const pendingOpnames = await prisma.stockTakeSession.findMany({ where: { ...warehouseFilter, status: "SUBMITTED" }, select: { id: true, number: true }, take: 20 });
    for (const row of pendingOpnames) {
      await prisma.notification.upsert({
        where: { fingerprint: `STOCK_TAKE_APPROVAL:${userId}:${row.id}` },
        create: { fingerprint: `STOCK_TAKE_APPROVAL:${userId}:${row.id}`, userId, type: "APPROVAL_REQUIRED", title: "Stock opname approval required", message: `${row.number} siap ditinjau.`, entity: "StockTakeSession", entityId: row.id },
        update: { message: `${row.number} siap ditinjau.` },
      });
    }
  }

  if (auth.permissions.includes("reports.read")) {
    const expiring = await prisma.productBatch.findMany({ where: { ...warehouseFilter, expiryDate: { lte: new Date(Date.now() + 30 * 86400000) }, quantityOnHand: { gt: 0 } }, select: { id: true, batchNumber: true, expiryDate: true, warehouseId: true, product: { select: { name: true } }, warehouse: { select: { name: true } } }, take: 20, orderBy: { expiryDate: "asc" } });
    for (const row of expiring) {
      await prisma.notification.upsert({ where: { fingerprint: `BATCH_EXPIRY:${userId}:${row.id}` }, create: { fingerprint: `BATCH_EXPIRY:${userId}:${row.id}`, userId, type: "BATCH_EXPIRY", title: "Batch expiry attention", message: `${row.product.name} batch ${row.batchNumber} di ${row.warehouse.name} mendekati kadaluarsa.`, entity: "ProductBatch", entityId: row.id }, update: { message: `${row.product.name} batch ${row.batchNumber} di ${row.warehouse.name} mendekati kadaluarsa.` } });
    }
  }
}

// Notifications are personal, authenticated inbox data. They are available
// to every active role; each event is already filtered by permission/scope.
router.get("/", asyncHandler(async (req, res) => {
  const query = querySchema.parse(req.query);
  const auth = authOf(req);
  await refreshNotifications(auth.userId, auth);
  const { page, pageSize, skip, take } = pagination(query);
  const where = { userId: auth.userId, ...(query.unreadOnly ? { readAt: null } : {}) };
  const [data, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: auth.userId, readAt: null } }),
  ]);
  res.json({ success: true, data, meta: pageMeta(page, pageSize, total), unreadCount });
}));

router.patch("/:id/read", asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const data = await prisma.notification.updateMany({ where: { id, userId: authOf(req).userId }, data: { readAt: new Date() } });
  if (data.count === 0) res.status(404).json({ success: false, message: "Notification not found" });
  else res.json({ success: true });
}));

router.post("/read-all", asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: authOf(req).userId, readAt: null }, data: { readAt: new Date() } });
  res.json({ success: true });
}));

export default router;

