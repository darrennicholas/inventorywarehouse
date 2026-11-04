import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess, warehouseScope } from "../../rbac/warehouse-scope.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { stockAvailabilitySummary } from "./stock-availability-summary.ts";
import { attentionItems } from "./attention.service.ts";

const router = Router();
router.get("/attention", requirePermission("dashboard.read"), asyncHandler(async (req, res) => { res.json({ success: true, data: await attentionItems(authOf(req)) }); }));
const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
});

function parseDashboardDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const utcDate = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(utcDate.getTime()) || utcDate.toISOString().slice(0, 10) !== value) return undefined;
    if (endOfDay) utcDate.setUTCDate(utcDate.getUTCDate() + 1);
    return new Date(`${utcDate.toISOString().slice(0, 10)}T00:00:00.000+07:00`);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const jakartaMonth = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).formatToParts(date);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
};

router.get("/dashboard-summary", requirePermission("dashboard.read"), asyncHandler(async (req, res) => {
  const query = querySchema.parse(req.query);
  const auth = authOf(req);
  const now = new Date();
  const hasDateOnlyEnd = Boolean(query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to));
  const parsedFrom = parseDashboardDate(query.from);
  const parsedTo = parseDashboardDate(query.to, hasDateOnlyEnd);
  if ((query.from && !parsedFrom) || (query.to && !parsedTo)) {
    res.status(400).json({ success: false, message: "Format tanggal tidak valid. Gunakan YYYY-MM-DD." });
    return;
  }
  const from = parsedFrom ?? new Date(now.getTime() - 29 * 86_400_000);
  const toExclusive = parsedTo ?? new Date(now.getTime() + 1);
  const toInclusive = hasDateOnlyEnd ? new Date(toExclusive.getTime() - 1) : toExclusive;
  if (from > toInclusive) {
    res.status(400).json({ success: false, message: "Tanggal awal harus sebelum tanggal akhir." });
    return;
  }
  if (toInclusive.getTime() - from.getTime() > 366 * 86_400_000) {
    res.status(400).json({ success: false, message: "Rentang dashboard maksimal 366 hari." });
    return;
  }
  if (query.warehouseId) assertWarehouseAccess(auth, query.warehouseId);
  const scope = warehouseScope(auth);
  const warehouseFilter = query.warehouseId ? { warehouseId: query.warehouseId } : scope ? { warehouseId: { in: scope } } : {};
  const transferWarehouseFilter = query.warehouseId
    ? { OR: [{ fromWarehouseId: query.warehouseId }, { toWarehouseId: query.warehouseId }] }
    : scope ? { OR: [{ fromWarehouseId: { in: scope } }, { toWarehouseId: { in: scope } }] } : {};
  const periodFilter = hasDateOnlyEnd ? { gte: from, lt: toExclusive } : { gte: from, lte: toInclusive };

  const [purchases, sales, expenses, balances, movements, purchaseStatuses, saleStatuses, transferStatuses, batches, warehouses] = await Promise.all([
    auth.permissions.includes("purchases.read") ? prisma.purchaseOrder.findMany({ where: { ...warehouseFilter, orderDate: periodFilter, status: { not: "CANCELLED" } }, select: { orderDate: true, total: true } }) : [],
    auth.permissions.includes("sales.read") ? prisma.sale.findMany({ where: { ...warehouseFilter, saleDate: periodFilter, status: "COMPLETED" }, select: { saleDate: true, total: true } }) : [],
    auth.permissions.includes("expenses.read") ? prisma.expense.findMany({ where: { ...warehouseFilter, expenseDate: periodFilter }, select: { expenseDate: true, amount: true } }) : [],
    auth.permissions.includes("inventory.read") ? prisma.inventoryBalance.findMany({ where: warehouseFilter, select: { warehouseId: true, quantityOnHand: true, reservedQuantity: true, product: { select: { id: true, sku: true, name: true, minStock: true, category: { select: { id: true, name: true } } } }, warehouse: { select: { id: true, name: true } } } }) : [],
    auth.permissions.includes("inventory.read") ? prisma.stockMovement.findMany({ where: { ...warehouseFilter, occurredAt: periodFilter }, select: { occurredAt: true, quantity: true, movementType: true } }) : [],
    auth.permissions.includes("purchases.read") ? prisma.purchaseOrder.groupBy({ by: ["status"], where: { ...warehouseFilter, orderDate: periodFilter }, _count: { _all: true } }) : [],
    auth.permissions.includes("sales.read") ? prisma.sale.groupBy({ by: ["status"], where: { ...warehouseFilter, saleDate: periodFilter }, _count: { _all: true } }) : [],
    auth.permissions.includes("transfers.read") ? prisma.stockTransfer.groupBy({ by: ["status"], where: { ...transferWarehouseFilter, transferDate: periodFilter }, _count: { _all: true } }) : [],
    auth.permissions.includes("inventory.read") ? prisma.productBatch.findMany({ where: { ...warehouseFilter, quantityOnHand: { gt: 0 }, expiryDate: { not: null } }, select: { expiryDate: true, quantityOnHand: true } }) : [],
    prisma.warehouse.findMany({ where: { isActive: true, ...(scope ? { id: { in: scope } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const durationDays = Math.max(1, Math.ceil((toInclusive.getTime() - from.getTime() + 1) / 86_400_000));
  const bucketDays = durationDays <= 31 ? 1 : durationDays <= 120 ? 7 : 30;
  const bucketCount = Math.min(31, Math.ceil(durationDays / bucketDays));
  const trend = Array.from({ length: bucketCount }, (_, index) => {
    const start = new Date(from.getTime() + index * bucketDays * 86_400_000);
    return { label: start.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short" }), date: start.toISOString(), receipts: 0, issues: 0, adjustments: 0, transfers: 0 };
  });
  for (const movement of movements) {
    const index = Math.min(bucketCount - 1, Math.floor((movement.occurredAt.getTime() - from.getTime()) / (bucketDays * 86_400_000)));
    if (index < 0) continue;
    const point = trend[index];
    if (movement.movementType === "PURCHASE_RECEIPT" || movement.movementType === "SALES_RETURN") point.receipts += movement.quantity;
    else if (movement.movementType === "SALE_ISSUE" || movement.movementType === "PURCHASE_RETURN") point.issues += Math.abs(movement.quantity);
    else if (movement.movementType.startsWith("ADJUSTMENT")) point.adjustments += Math.abs(movement.quantity);
    else if (movement.movementType === "TRANSFER_OUT" || movement.movementType === "RELOCATION_OUT") point.transfers += Math.abs(movement.quantity);
  }

  const productMap = new Map<string, { id: string; sku: string; name: string; quantity: number; minStock: number }>();
  const warehouseMap = new Map<string, { id: string; name: string; quantity: number; lines: number }>();
  const categoryMap = new Map<string, { id: string; name: string; quantity: number }>();
  const availability = await stockAvailabilitySummary(balances.map((row) => ({ productId: row.product.id, warehouseId: row.warehouseId })));
  const availableFor = (row: typeof balances[number]) => availability.get(`${row.product.id}:${row.warehouseId}`)?.available ?? 0;
  const lowStock = balances.flatMap((row) => {
    const available = availableFor(row);
    if (available > row.product.minStock) return [];
    return [{ productId: row.product.id, sku: row.product.sku, productName: row.product.name, warehouseId: row.warehouse.id, warehouseName: row.warehouse.name, quantityOnHand: row.quantityOnHand, minStock: row.product.minStock, reorderQuantity: Math.max(row.product.minStock * 2 - available, row.product.minStock) }];
  });
  for (const row of balances) {
    const quantity = availableFor(row);
    const p = productMap.get(row.product.id) ?? { id: row.product.id, sku: row.product.sku, name: row.product.name, quantity: 0, minStock: row.product.minStock };
    p.quantity += quantity;
    productMap.set(row.product.id, p);
    const w = warehouseMap.get(row.warehouse.id) ?? { id: row.warehouse.id, name: row.warehouse.name, quantity: 0, lines: 0 };
    w.quantity += quantity;
    w.lines += 1;
    warehouseMap.set(row.warehouse.id, w);
    const key = row.product.category?.id ?? "uncategorized";
    const c = categoryMap.get(key) ?? { id: key, name: row.product.category?.name ?? "Tanpa kategori", quantity: 0 };
    c.quantity += quantity;
    categoryMap.set(key, c);
  }
  const monthMap = new Map<string, { label: string; purchases: number; sales: number; expenses: number }>();
  const startMonth = jakartaMonth(from);
  const endMonth = jakartaMonth(toInclusive);
  const [startYear, startMonthNumber] = startMonth.split("-").map(Number);
  const [endYear, endMonthNumber] = endMonth.split("-").map(Number);
  const monthCount = Math.max(1, (endYear - startYear) * 12 + endMonthNumber - startMonthNumber + 1);
  for (let offset = 0; offset < monthCount; offset++) {
    const monthDate = new Date(Date.UTC(startYear, startMonthNumber - 1 + offset, 1));
    const key = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}`;
    monthMap.set(key, { label: monthDate.toLocaleDateString("id-ID", { timeZone: "UTC", month: "short" }), purchases: 0, sales: 0, expenses: 0 });
  }
  for (const row of purchases) { const m = monthMap.get(jakartaMonth(row.orderDate)); if (m) m.purchases += Number(row.total); }
  for (const row of sales) { const m = monthMap.get(jakartaMonth(row.saleDate)); if (m) m.sales += Number(row.total); }
  for (const row of expenses) { const m = monthMap.get(jakartaMonth(row.expenseDate)); if (m) m.expenses += Number(row.amount); }
  const statusSummary = (rows: { status: string; _count: { _all: number } }[]) => rows.map((row) => ({ label: row.status, count: row._count._all }));
  const expirySoon = batches.filter((batch) => batch.expiryDate && batch.expiryDate >= now && batch.expiryDate <= new Date(now.getTime() + 30 * 86_400_000)).reduce((sum, batch) => sum + batch.quantityOnHand, 0);
  const totalStock = balances.reduce((sum, row) => sum + availableFor(row), 0);

  res.json({ success: true, data: {
    period: { from: from.toISOString(), to: toInclusive.toISOString(), bucketDays },
    kpis: { purchaseValue: purchases.reduce((s, r) => s + Number(r.total), 0), salesValue: sales.reduce((s, r) => s + Number(r.total), 0), expenseValue: expenses.reduce((s, r) => s + Number(r.amount), 0), stockUnits: totalStock, lowStockLines: lowStock.length, expiringUnits30d: expirySoon, activeWarehouses: warehouses.length },
    monthly: [...monthMap.values()], trend,
    operationStatus: { purchases: statusSummary(purchaseStatuses), sales: statusSummary(saleStatuses), transfers: statusSummary(transferStatuses) },
    categoryStock: [...categoryMap.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 7),
    topProducts: [...productMap.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 8),
    warehouses,
    warehouseStock: [...warehouseMap.values()].sort((a, b) => b.quantity - a.quantity),
    lowStock: lowStock.sort((a, b) => a.quantityOnHand - a.minStock - (b.quantityOnHand - b.minStock)).slice(0, 12),
  } });
}));

export default router;
