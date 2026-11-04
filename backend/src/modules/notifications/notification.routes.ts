import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { authOf } from "../../middlewares/auth.middleware.ts";
import { scopedWarehouseFilter, assertWarehouseAccess, warehouseScope } from "../../rbac/warehouse-scope.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { pageMeta, pagination } from "../../utils/pagination.ts";
import { AppError } from "../../utils/AppError.ts";
import { stockAvailabilitySummary } from "../operations/stock-availability-summary.ts";
import { attentionItems } from "../operations/attention.service.ts";

const router = Router();
const querySchema = z.object({ unreadOnly: z.enum(["true", "false"]).optional().transform((value) => value === "true"), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional() });
const refreshState = new Map<string, { refreshedAt: number; pending?: Promise<void> }>();

async function refreshNotifications(userId: string, auth: ReturnType<typeof authOf>) {
  const attention = await attentionItems(auth);
  const repeatConfigured = Number(process.env.STOCKFLOW_ATTENTION_REPEAT_DAYS ?? 0);
  const repeatDays = Number.isInteger(repeatConfigured) && repeatConfigured >= 1 && repeatConfigured <= 365 ? repeatConfigured : 0;
  if (attention.rows.length) await prisma.notification.createMany({ data: attention.rows.map((row) => ({ userId, type: "WORK_ATTENTION", title: `${row.label} perlu perhatian`, message: `${row.number} berstatus ${row.status} tanpa pembaruan selama setidaknya ${attention.days} hari.`, entity: row.entity, entityId: row.id, fingerprint: `ATTENTION:${userId}:${row.entity}:${row.id}:${row.status}:${row.updatedAt.toISOString()}${repeatDays ? `:${Math.floor((Date.now() - row.updatedAt.getTime()) / (repeatDays * 86400000))}` : ""}` })), skipDuplicates: true });
  const warehouseFilter = scopedWarehouseFilter(auth);
  const balances = auth.permissions.includes("inventory.read") || auth.permissions.includes("reports.read") ? await prisma.inventoryBalance.findMany({
    where: warehouseFilter,
    select: { warehouseId: true, quantityOnHand: true, reservedQuantity: true, warehouse: { select: { name: true } }, product: { select: { id: true, name: true, minStock: true } } },
  }) : [];
  const availability = await stockAvailabilitySummary(balances.map((row) => ({ productId: row.product.id, warehouseId: row.warehouseId })));
  const available = (row: typeof balances[number]) => availability.get(`${row.product.id}:${row.warehouseId}`)?.available ?? 0;
  const lowStock = balances.filter((row) => available(row) <= row.product.minStock).slice(0, 30);
  for (const row of lowStock) {
    await prisma.notification.upsert({
      where: { fingerprint: `LOW_STOCK:${userId}:${row.product.id}:${row.warehouseId}` },
      create: { fingerprint: `LOW_STOCK:${userId}:${row.product.id}:${row.warehouseId}`, userId, type: "LOW_STOCK", title: "Low stock attention", message: `${row.product.name} di ${row.warehouse.name} tinggal ${available(row)} unit tersedia di lokasi layak jual.`, entity: "InventoryBalance", entityId: `${row.product.id}:${row.warehouseId}` },
      update: { message: `${row.product.name} di ${row.warehouse.name} tinggal ${available(row)} unit tersedia di lokasi layak jual.` },
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

async function refreshNotificationsWhenStale(userId: string, auth: ReturnType<typeof authOf>) {
  const current = refreshState.get(userId);
  if (current?.pending) return current.pending;
  if (current && Date.now() - current.refreshedAt < 60_000) return;
  const state = current ?? { refreshedAt: 0 };
  const pending = refreshNotifications(userId, auth).then(() => {
    state.refreshedAt = Date.now();
  }).finally(() => {
    state.pending = undefined;
    refreshState.set(userId, state);
  });
  state.pending = pending;
  refreshState.set(userId, state);
  return pending;
}

// Notifications are personal, authenticated inbox data. They are available
// to every active role; each event is already filtered by permission/scope.
router.get("/", asyncHandler(async (req, res) => {
  const query = querySchema.parse(req.query);
  const auth = authOf(req);
  await refreshNotificationsWhenStale(auth.userId, auth);
  const { page, pageSize, skip, take } = pagination(query);
  const where = { userId: auth.userId, ...(query.unreadOnly ? { readAt: null } : {}) };
  const [data, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: auth.userId, readAt: null } }),
  ]);
  const idsFor = (entity: string) => data.filter((item) => item.type === "WORK_ATTENTION" && item.entity === entity && item.entityId && z.uuid().safeParse(item.entityId).success).map((item) => item.entityId!);
  const warehouseFilter = scopedWarehouseFilter(auth); const scope = warehouseScope(auth);
  const transferFilter = scope ? { OR: [{ fromWarehouseId: { in: scope } }, { toWarehouseId: { in: scope } }] } : {};
  const [purchases, sales, transfers, opnames] = await Promise.all([
    auth.permissions.includes("purchases.read") ? prisma.purchaseOrder.findMany({ where: { ...warehouseFilter, id: { in: idsFor("PurchaseOrder") } }, select: { id: true, status: true, updatedAt: true } }) : [],
    auth.permissions.includes("sales.read") ? prisma.sale.findMany({ where: { ...warehouseFilter, id: { in: idsFor("Sale") } }, select: { id: true, status: true, updatedAt: true } }) : [],
    auth.permissions.includes("transfers.read") ? prisma.stockTransfer.findMany({ where: { ...transferFilter, id: { in: idsFor("StockTransfer") } }, select: { id: true, status: true, updatedAt: true } }) : [],
    auth.permissions.includes("stock-opnames.read") ? prisma.stockTakeSession.findMany({ where: { ...warehouseFilter, id: { in: idsFor("StockTakeSession") } }, select: { id: true, status: true, updatedAt: true } }) : [],
  ]);
  const current = new Map([...purchases.map((row) => ["PurchaseOrder", row] as const), ...sales.map((row) => ["Sale", row] as const), ...transfers.map((row) => ["StockTransfer", row] as const), ...opnames.map((row) => ["StockTakeSession", row] as const)].map(([entity, row]) => [`${entity}:${row.id}`, `ATTENTION:${auth.userId}:${entity}:${row.id}:${row.status}:${row.updatedAt.toISOString()}`]));
  const decorated = data.map((row) => { const key = current.get(`${row.entity}:${row.entityId}`); return { ...row, resolved: row.type === "WORK_ATTENTION" ? !key || !(row.fingerprint === key || row.fingerprint?.startsWith(`${key}:`)) : null }; });
  res.json({ success: true, data: decorated, meta: pageMeta(page, pageSize, total), unreadCount });
}));

// Resolve the current destination on the server, rechecking permissions and
// warehouse scope because access may have changed since delivery.
router.get("/:id/target", asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const id = z.uuid().parse(req.params.id);
  const notification = await prisma.notification.findFirst({ where: { id, userId: auth.userId }, select: { entity: true, entityId: true } });
  if (!notification?.entity || !notification.entityId) throw new AppError(404, "Notifikasi tidak memiliki dokumen tujuan.");
  const requireRead = (permission: string) => { if (!auth.permissions.includes(permission)) throw new AppError(403, "Anda tidak memiliki akses ke dokumen ini."); };
  const entity = notification.entity;
  let recordId = notification.entityId;
  if (entity === "QuarantineDecision") {
    requireRead("inventory.read");
    const row = await prisma.quarantineDecision.findUnique({ where: { id: z.uuid().parse(recordId) }, include: { source: { include: { product: { select: { sku: true, name: true } }, warehouse: { select: { name: true } } } } } });
    if (!row) throw new AppError(404, "Pengajuan karantina tidak ditemukan.");
    assertWarehouseAccess(auth, row.source.warehouseId);
    res.json({ success: true, data: { page: "inventory-detail", detail: { product: row.source.product.name, sku: row.source.product.sku, warehouse: row.source.warehouse.name, onHand: row.source.quantityOnHand, reserved: row.source.reservedQuantity, available: 0, note: `${row.action}: ${row.status}. Buka Warehouse → View → Tindak lanjut karantina untuk review.` } } }); return;
  }
  if (entity === "InventoryBalance" || entity === "ProductBatch") {
    if (!auth.permissions.includes("inventory.read") && !auth.permissions.includes("reports.read")) throw new AppError(403, "Anda tidak memiliki akses ke stok ini.");
    let productId = ""; let warehouseId = "";
    if (entity === "InventoryBalance") [productId, warehouseId] = recordId.split(":");
    else { const batch = await prisma.productBatch.findUnique({ where: { id: z.uuid().parse(recordId) }, select: { productId: true, warehouseId: true } }); if (!batch) throw new AppError(404, "Batch tidak ditemukan."); ({ productId, warehouseId } = batch); }
    z.uuid().parse(productId); z.uuid().parse(warehouseId); assertWarehouseAccess(auth, warehouseId);
    const balance = await prisma.inventoryBalance.findUnique({ where: { productId_warehouseId: { productId, warehouseId } }, include: { product: { select: { name: true, sku: true } }, warehouse: { select: { name: true } } } });
    if (!balance) throw new AppError(404, "Saldo stok tidak ditemukan.");
    const availableStock = (await stockAvailabilitySummary([{ productId: balance.productId, warehouseId: balance.warehouseId }])).get(`${balance.productId}:${balance.warehouseId}`)?.available ?? 0;
    const detail = { product: balance.product.name, sku: balance.product.sku, warehouse: balance.warehouse.name, onHand: balance.quantityOnHand, reserved: balance.reservedQuantity, available: availableStock };
    res.json({ success: true, data: auth.permissions.includes("reports.read") ? { page: "stock-report", recordId: balance.id, reference: balance.product.sku, warehouseId } : { page: "inventory-detail", detail } }); return;
  }
  if (entity === "StockTakeLine") { const line = await prisma.stockTakeLine.findUnique({ where: { id: z.uuid().parse(recordId) }, select: { sessionId: true } }); if (!line) throw new AppError(404, "Baris opname tidak ditemukan."); recordId = line.sessionId; }
  z.uuid().parse(recordId);
  if (entity === "ReturnOrder") { const row = await prisma.returnOrder.findUnique({ where: { id: recordId }, select: { id: true, number: true, type: true, warehouseId: true } }); if (!row) throw new AppError(404, "Retur tidak ditemukan."); requireRead(row.type === "PURCHASE" ? "purchase-returns.read" : "sales-returns.read"); assertWarehouseAccess(auth, row.warehouseId); res.json({ success: true, data: { page: row.type === "PURCHASE" ? "purchase-returns" : "sales-returns", recordId: row.id, reference: row.number } }); return; }
  if (entity === "StockTakeSession" || entity === "StockTakeLine") { requireRead("stock-opnames.read"); const row = await prisma.stockTakeSession.findUnique({ where: { id: recordId }, select: { id: true, number: true, warehouseId: true } }); if (!row) throw new AppError(404, "Sesi opname tidak ditemukan."); assertWarehouseAccess(auth, row.warehouseId); res.json({ success: true, data: { page: "stock-opnames", recordId: row.id, reference: row.number } }); return; }
  if (entity === "SaleShipment") { requireRead("fulfillment.read"); const row = await prisma.saleShipment.findUnique({ where: { id: recordId }, select: { id: true, number: true, warehouseId: true } }); if (!row) throw new AppError(404, "Pengiriman tidak ditemukan."); assertWarehouseAccess(auth, row.warehouseId); res.json({ success: true, data: { page: "fulfillment", recordId: row.id, reference: row.number } }); return; }
  if (entity === "PurchaseOrder") { requireRead("purchases.read"); const row = await prisma.purchaseOrder.findUnique({ where: { id: recordId }, select: { id: true, number: true, warehouseId: true } }); if (!row) throw new AppError(404, "Pembelian tidak ditemukan."); assertWarehouseAccess(auth, row.warehouseId); res.json({ success: true, data: { page: "purchases", recordId: row.id, reference: row.number } }); return; }
  if (entity === "Sale") { requireRead("sales.read"); const row = await prisma.sale.findUnique({ where: { id: recordId }, select: { id: true, number: true, warehouseId: true } }); if (!row) throw new AppError(404, "Penjualan tidak ditemukan."); assertWarehouseAccess(auth, row.warehouseId); res.json({ success: true, data: { page: "sales", recordId: row.id, reference: row.number } }); return; }
  if (entity === "StockAdjustment") { requireRead("adjustments.read"); const row = await prisma.stockAdjustment.findUnique({ where: { id: recordId }, select: { id: true, number: true, warehouseId: true } }); if (!row) throw new AppError(404, "Penyesuaian tidak ditemukan."); assertWarehouseAccess(auth, row.warehouseId); res.json({ success: true, data: { page: "adjustments", recordId: row.id, reference: row.number } }); return; }
  if (entity === "StockTransfer") { requireRead("transfers.read"); const row = await prisma.stockTransfer.findUnique({ where: { id: recordId }, select: { id: true, number: true, fromWarehouseId: true, toWarehouseId: true } }); if (!row) throw new AppError(404, "Transfer tidak ditemukan."); const scope = warehouseScope(auth); if (scope && !scope.includes(row.fromWarehouseId) && !scope.includes(row.toWarehouseId)) throw new AppError(403, "Gudang di luar akses Anda."); res.json({ success: true, data: { page: "transfers", recordId: row.id, reference: row.number } }); return; }
  if (entity === "Expense") { requireRead("expenses.read"); const row = await prisma.expense.findUnique({ where: { id: recordId }, select: { id: true, number: true, warehouseId: true } }); if (!row) throw new AppError(404, "Pengeluaran sudah tidak tersedia."); const scope = warehouseScope(auth); if (scope && (!row.warehouseId || !scope.includes(row.warehouseId))) throw new AppError(403, "Gudang di luar akses Anda."); res.json({ success: true, data: { page: "expenses", recordId: row.id, reference: row.number } }); return; }
  if (entity === "Payment") { requireRead("payments.read"); const row = await prisma.payment.findUnique({ where: { id: recordId }, select: { id: true, number: true, purchaseOrder: { select: { warehouseId: true } }, sale: { select: { warehouseId: true } }, expense: { select: { warehouseId: true } } } }); if (!row) throw new AppError(404, "Pembayaran tidak ditemukan."); const scope = warehouseScope(auth); const warehouse = row.purchaseOrder?.warehouseId ?? row.sale?.warehouseId ?? row.expense?.warehouseId; if (scope && (!warehouse || !scope.includes(warehouse))) throw new AppError(403, "Gudang di luar akses Anda."); res.json({ success: true, data: { page: "payments", recordId: row.id, reference: row.number } }); return; }
  throw new AppError(404, "Tautan langsung belum tersedia untuk jenis notifikasi ini.");
}));

router.patch("/:id/read", asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const data = await prisma.notification.updateMany({ where: { id, userId: authOf(req).userId, readAt: null }, data: { readAt: new Date() } });
  if (data.count === 0 && !await prisma.notification.findFirst({ where: { id, userId: authOf(req).userId }, select: { id: true } })) res.status(404).json({ success: false, message: "Notification not found" });
  else res.json({ success: true });
}));

router.post("/read-batch", asyncHandler(async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.uuid()).min(1).max(100) }).strict().parse(req.body);
  await prisma.notification.updateMany({ where: { id: { in: ids }, userId: authOf(req).userId, readAt: null }, data: { readAt: new Date() } });
  res.json({ success: true });
}));

router.post("/read-all", asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: authOf(req).userId, readAt: null }, data: { readAt: new Date() } });
  res.json({ success: true });
}));

export default router;

