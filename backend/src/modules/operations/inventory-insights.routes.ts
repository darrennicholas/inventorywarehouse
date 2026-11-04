import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess, warehouseScope } from "../../rbac/warehouse-scope.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { AppError } from "../../utils/AppError.ts";
import { pageMeta, pagination } from "../../utils/pagination.ts";
import { reconstructStockBalances } from "./inventory-history.ts";
import { stockAvailabilitySummary } from "./stock-availability-summary.ts";

const router = Router();
const stockQuery = z.object({
  productId: z.uuid(), warehouseId: z.uuid(),
  locationId: z.uuid().optional(), batchId: z.uuid().optional(),
});

router.get("/report-warehouses", requirePermission("reports.read"), asyncHandler(async (req, res) => {
  const scope = warehouseScope(authOf(req));
  const data = await prisma.warehouse.findMany({ where: scope ? { id: { in: scope } } : undefined, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } });
  res.json({ success: true, data });
}));

// Diagnostic only: legacy opening balances may not have complete movement history.
router.get("/stock-reconciliation", requirePermission("reports.read"), asyncHandler(async (req, res) => {
  const { productId, warehouseId } = stockQuery.parse(req.query);
  assertWarehouseAccess(authOf(req), warehouseId);
  const where = { productId, warehouseId };
  const data = await prisma.$transaction(async (tx) => {
    const [product, balance, location, reservations, batches, batchLocations, movements] = await Promise.all([
      tx.product.findUnique({ where: { id: productId }, select: { trackBatch: true } }),
      tx.inventoryBalance.findUnique({ where: { productId_warehouseId: where }, select: { quantityOnHand: true, reservedQuantity: true } }),
      tx.inventoryLocationBalance.aggregate({ where, _sum: { quantityOnHand: true, reservedQuantity: true }, _count: true }),
      tx.stockReservation.aggregate({ where: { ...where, status: "ACTIVE" }, _sum: { quantity: true } }),
      tx.productBatch.aggregate({ where, _sum: { quantityOnHand: true, reservedQuantity: true } }),
      tx.inventoryLocationBalance.aggregate({ where: { ...where, batchId: { not: null } }, _sum: { quantityOnHand: true, reservedQuantity: true } }),
      tx.stockMovement.aggregate({ where, _sum: { quantity: true }, _count: true }),
    ]);
    if (!product || !balance) throw new AppError(404, "Product or warehouse balance not found");
    const checks = [
      { label: "Saldo fisik vs lokasi", expected: balance.quantityOnHand, actual: location._sum.quantityOnHand ?? 0 },
      { label: "Reservasi saldo vs lokasi", expected: balance.reservedQuantity, actual: location._sum.reservedQuantity ?? 0 },
      { label: "Reservasi saldo vs reservasi aktif", expected: balance.reservedQuantity, actual: reservations._sum.quantity ?? 0 },
      ...(product.trackBatch ? [
        { label: "Saldo batch vs lokasi batch", expected: batches._sum.quantityOnHand ?? 0, actual: batchLocations._sum.quantityOnHand ?? 0 },
        { label: "Reservasi batch vs lokasi batch", expected: batches._sum.reservedQuantity ?? 0, actual: batchLocations._sum.reservedQuantity ?? 0 },
      ] : []),
    ].map((check) => ({ ...check, difference: check.actual - check.expected }));
    return { checks, movementTotal: movements._sum.quantity ?? 0, movementCount: movements._count, locationCount: location._count };
  }, { isolationLevel: "RepeatableRead" });
  res.json({ success: true, data });
}));

// Match stock-allocation rules: only active storage and usable batches count.
router.get("/availability", requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const query = stockQuery.parse(req.query);
  assertWarehouseAccess(authOf(req), query.warehouseId);
  const product = await prisma.product.findUnique({ where: { id: query.productId }, select: { id: true, name: true, trackBatch: true } });
  if (!product) throw new AppError(404, "Product not found");
  const rows = await prisma.inventoryLocationBalance.findMany({
    where: {
      productId: query.productId, warehouseId: query.warehouseId,
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : product.trackBatch ? { batchId: { not: null } } : { batchId: null }),
      location: { isActive: true, locationType: "STORAGE" },
      ...(product.trackBatch ? { batch: { status: "ACTIVE", OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }] } } : {}),
    },
    select: { quantityOnHand: true, reservedQuantity: true, location: { select: { id: true, code: true, name: true } }, batch: { select: { id: true, batchNumber: true } } },
    orderBy: { location: { code: "asc" } },
  });
  const onHand = rows.reduce((sum, row) => sum + row.quantityOnHand, 0);
  const reserved = rows.reduce((sum, row) => sum + row.reservedQuantity, 0);
  res.json({ success: true, data: { product, onHand, reserved, available: onHand - reserved, locations: rows.map((row) => ({ ...row, available: row.quantityOnHand - row.reservedQuantity })) } });
}));

router.get("/stock-history", requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const { productId, warehouseId } = stockQuery.parse(req.query);
  const auth = authOf(req);
  assertWarehouseAccess(auth, warehouseId);
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const where = { productId, warehouseId };
  const { balance, movements, total, newer } = await prisma.$transaction(async (tx) => {
    const [balance, movements, total] = await Promise.all([
    tx.inventoryBalance.findUnique({ where: { productId_warehouseId: { productId, warehouseId } }, select: { quantityOnHand: true, reservedQuantity: true } }),
    tx.stockMovement.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip, take, include: {
      createdBy: { select: { fullName: true } },
      purchaseOrder: { select: { number: true } }, sale: { select: { number: true } },
      adjustment: { select: { number: true } }, transfer: { select: { number: true } }, returnOrder: { select: { number: true, type: true } },
    } }),
    tx.stockMovement.count({ where }),
    ]);
    const first = movements[0];
    const newer = first ? await tx.stockMovement.aggregate({ where: { ...where, OR: [{ occurredAt: { gt: first.occurredAt } }, { occurredAt: first.occurredAt, id: { gt: first.id } }] }, _sum: { quantity: true } }) : null;
    return { balance, movements, total, newer };
  }, { isolationLevel: "RepeatableRead" });
  const balances = reconstructStockBalances(balance?.quantityOnHand ?? 0, newer?._sum.quantity ?? 0, movements.map((row) => row.quantity));
  const data = movements.map((row, index) => {
    const { before, after } = balances[index];
    const sources = [
      { kind: "Return", value: row.returnOrder, allowed: row.returnOrder?.type === "PURCHASE" ? auth.permissions.includes("purchase-returns.read") : auth.permissions.includes("sales-returns.read") },
      { kind: "Purchase", value: row.purchaseOrder, allowed: auth.permissions.includes("purchases.read") },
      { kind: "Sale", value: row.sale, allowed: auth.permissions.includes("sales.read") },
      { kind: "Adjustment", value: row.adjustment, allowed: auth.permissions.includes("adjustments.read") },
      { kind: "Transfer", value: row.transfer, allowed: auth.permissions.includes("transfers.read") },
    ];
    const source = sources.find((item) => item.value);
    return { id: row.id, occurredAt: row.occurredAt, movementType: row.movementType, quantity: row.quantity, before, after, actor: row.createdBy.fullName, note: row.note, source: source ? { kind: source.kind, number: source.allowed ? source.value?.number : null } : null };
  });
  const available = (await stockAvailabilitySummary([{ productId, warehouseId }])).get(`${productId}:${warehouseId}`)?.available ?? 0;
  res.json({ success: true, data, balance: { onHand: balance?.quantityOnHand ?? 0, reserved: balance?.reservedQuantity ?? 0, available }, meta: pageMeta(page, pageSize, total) });
}));

router.get("/stock-history/:id/source", requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const auth = authOf(req);
  const row = await prisma.stockMovement.findUnique({ where: { id }, include: {
    returnOrder: { include: { items: { include: { product: { select: { name: true, sku: true } } } } } },
    purchaseOrder: { include: { items: { include: { product: { select: { name: true, sku: true } } } } } },
    sale: { include: { items: { include: { product: { select: { name: true, sku: true } } } } } },
    adjustment: { include: { items: { include: { product: { select: { name: true, sku: true } } } } } },
    transfer: { include: { items: { include: { product: { select: { name: true, sku: true } } } } } },
  } });
  if (!row) throw new AppError(404, "Stock movement not found");
  assertWarehouseAccess(auth, row.warehouseId);
  const source = row.returnOrder ? { doc: row.returnOrder, kind: "Return", permission: row.returnOrder.type === "PURCHASE" ? "purchase-returns.read" : "sales-returns.read", notes: row.returnOrder.reason }
    : row.purchaseOrder ? { doc: row.purchaseOrder, kind: "Purchase", permission: "purchases.read", notes: row.purchaseOrder.notes }
    : row.sale ? { doc: row.sale, kind: "Sale", permission: "sales.read", notes: row.sale.notes }
    : row.adjustment ? { doc: row.adjustment, kind: "Adjustment", permission: "adjustments.read", notes: row.adjustment.reason }
    : row.transfer ? { doc: row.transfer, kind: "Transfer", permission: "transfers.read", notes: row.transfer.notes }
    : null;
  if (!source) throw new AppError(404, "Source document is not linked to this movement");
  if (!auth.permissions.includes(source.permission)) throw new AppError(403, "You cannot view the source document");
  res.json({ success: true, data: { kind: source.kind, number: source.doc.number, status: source.doc.status, notes: source.notes, items: source.doc.items.map((item) => ({ product: item.product.name, sku: item.product.sku, quantity: item.quantity })) } });
}));

export default router;
