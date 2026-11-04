import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess, scopedWarehouseFilter, warehouseScope } from "../../rbac/warehouse-scope.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { updateExpiredBatches } from "./inventory.service.ts";
import { linkMovementAllocations, postStockIn, postStockOut } from "./stock-allocation.service.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { pageMeta, pagination } from "../../utils/pagination.ts";
import { csvDocument } from "../../utils/csv.ts";
import { stockAvailabilitySummary } from "./stock-availability-summary.ts";
const router = Router();
function requestedWarehouseId(req: { query: Record<string, unknown> }) { return typeof req.query.warehouseId === "string" ? z.uuid().parse(req.query.warehouseId) : undefined; }
const relocationSchema = z.object({
  warehouseId: z.uuid(), fromLocationId: z.uuid(), toLocationId: z.uuid(),
  reason: z.string().trim().max(500).nullable().optional(),
  items: z.array(z.object({ productId: z.uuid(), batchId: z.uuid().nullable().optional(), quantity: z.coerce.number().int().positive().max(1_000_000) }).strict()).min(1).max(100),
}).strict().refine((value) => value.fromLocationId !== value.toLocationId, { message: "Source and destination locations must be different", path: ["toLocationId"] });

async function stockReportRows(auth: ReturnType<typeof authOf>, warehouseId?: string, productId?: string, page?: { skip: number; take: number }, search = "") {
  const where = { ...scopedWarehouseFilter(auth, warehouseId), ...(productId ? { productId } : {}), ...(search ? { product: { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { sku: { contains: search, mode: "insensitive" as const } }, { barcode: { contains: search, mode: "insensitive" as const } }] } } : {}) };
  const balances = await prisma.inventoryBalance.findMany({ where, ...(page ? { skip: page.skip, take: page.take } : {}), include: { product: { select: { id: true, sku: true, barcode: true, name: true, minStock: true, maxStock: true, reorderLeadDays: true, unit: { select: { code: true } } } }, warehouse: { select: { id: true, code: true, name: true } }, location: { select: { id: true, code: true, name: true, zone: true, rack: true, shelf: true, bin: true } } }, orderBy: [{ warehouse: { name: "asc" } }, { product: { name: "asc" } }] });
  const details = await stockAvailabilitySummary(balances);
  return balances.map((balance) => {
    const detail = details.get(`${balance.productId}:${balance.warehouseId}`);
    const availableQuantity = detail?.available ?? 0;
    const targetStock = balance.product.maxStock ?? balance.product.minStock * 2;
    return { ...balance, availableQuantity, expiredQuantity: detail?.expired ?? 0, quarantineQuantity: detail?.quarantine ?? 0, otherUnavailableQuantity: detail?.other ?? 0, detailMissing: !detail && balance.quantityOnHand !== 0, isLowStock: availableQuantity <= balance.product.minStock, reorderQuantity: Math.max(0, targetStock - availableQuantity) };
  });
}

router.get("/batches", requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  await updateExpiredBatches();
  const auth = authOf(req);
  const warehouseId = requestedWarehouseId(req);
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const where = { ...scopedWarehouseFilter(auth, warehouseId), ...(productId ? { productId } : {}) };
  const [rows, total] = await Promise.all([prisma.productBatch.findMany({ where, skip, take, include: { product: { select: { id: true, sku: true, name: true } }, warehouse: { select: { id: true, name: true } }, location: { select: { id: true, code: true, name: true } } }, orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }] }), prisma.productBatch.count({ where })]);
  res.json({ success: true, data: rows.map((row) => ({ ...row, availableQuantity: row.quantityOnHand - row.reservedQuantity, daysToExpiry: row.expiryDate ? Math.ceil((row.expiryDate.getTime() - Date.now()) / 86400000) : null })), meta: pageMeta(page, pageSize, total) });
}));

router.get("/expiry-report", requirePermission("reports.read"), asyncHandler(async (req, res) => {
  await updateExpiredBatches();
  const auth = authOf(req);
  const days = Math.min(Math.max(Number(req.query.days ?? 90), 1), 365);
  const until = new Date(Date.now() + days * 86400000);
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const where = { ...scopedWarehouseFilter(auth, requestedWarehouseId(req)), expiryDate: { lte: until }, quantityOnHand: { gt: 0 } };
  const [rows, total] = await Promise.all([prisma.productBatch.findMany({ where, skip, take, include: { product: { select: { id: true, sku: true, name: true } }, warehouse: { select: { id: true, name: true } }, location: { select: { code: true, name: true } } }, orderBy: { expiryDate: "asc" } }), prisma.productBatch.count({ where })]);
  res.json({ success: true, data: rows.map((row) => ({ ...row, availableQuantity: row.quantityOnHand - row.reservedQuantity, daysToExpiry: row.expiryDate ? Math.ceil((row.expiryDate.getTime() - Date.now()) / 86400000) : null })), meta: pageMeta(page, pageSize, total) });
}));

router.get("/reorder-suggestions", requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const warehouseId = requestedWarehouseId(req);
  const productId = typeof req.query.productId === "string" ? z.uuid().parse(req.query.productId) : undefined;
  if (warehouseId) z.uuid().parse(warehouseId);
  const rows = (await stockReportRows(auth, warehouseId, productId)).filter((row) => row.isLowStock);
  const canReadPurchases = auth.permissions.includes("purchases.read");
  const result = await Promise.all(rows.slice(0, 100).map(async (row) => {
    const [incoming, usage] = await Promise.all([
      canReadPurchases ? prisma.purchaseOrderItem.aggregate({ where: { productId: row.productId, purchaseOrder: { warehouseId: row.warehouseId, status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] } } }, _sum: { quantity: true, receivedQuantity: true } }) : null,
      prisma.stockMovement.aggregate({ where: { productId: row.productId, warehouseId: row.warehouseId, movementType: "SALE_ISSUE", occurredAt: { gte: new Date(Date.now() - 30 * 86400000) } }, _sum: { quantity: true } }),
    ]);
    const incomingQuantity = incoming ? Math.max(0, (incoming._sum.quantity ?? 0) - (incoming._sum.receivedQuantity ?? 0)) : null;
    const averageDailyUsage = Math.abs(usage._sum.quantity ?? 0) / 30;
    const target = row.product.maxStock ?? row.product.minStock * 2;
    const projected = row.availableQuantity + (incomingQuantity ?? 0);
    const daysUntilMinimum = averageDailyUsage > 0 ? Math.max(0, (projected - row.product.minStock) / averageDailyUsage) : null;
    return { ...row, incomingQuantity, averageDailyUsage, suggestedQuantity: Math.max(0, target - projected), suggestedPurchaseDate: daysUntilMinimum === null ? null : new Date(Date.now() + Math.max(0, daysUntilMinimum - row.product.reorderLeadDays) * 86400000) };
  }));
  res.json({ success: true, data: result });
}));

router.get("/inventory-analytics", requirePermission("reports.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  if (!auth.permissions.includes("inventory.read")) throw new AppError(403, "You cannot view inventory analytics");
  const warehouseId = requestedWarehouseId(req);
  const rows = await stockReportRows(auth, warehouseId);
  const productRows = new Map<string, { product: typeof rows[number]["product"]; availableQuantity: number; quantityOnHand: number; reservedQuantity: number }>();
  for (const row of rows) {
    const current = productRows.get(row.productId) ?? { product: row.product, availableQuantity: 0, quantityOnHand: 0, reservedQuantity: 0 };
    current.availableQuantity += row.availableQuantity;
    current.quantityOnHand += row.quantityOnHand;
    current.reservedQuantity += row.reservedQuantity;
    productRows.set(row.productId, current);
  }
  const productIds = [...productRows.keys()];
  // Only confirmed orders count as incoming; drafts and approvals still pending do not.
  const canReadPurchases = auth.permissions.includes("purchases.read");
  const incomingRows = canReadPurchases && productIds.length ? await prisma.purchaseOrderItem.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds }, purchaseOrder: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] }, ...scopedWarehouseFilter(auth, warehouseId) } },
    _sum: { quantity: true, receivedQuantity: true },
  }) : [];
  const incomingByProduct = new Map(incomingRows.map((item) => [item.productId, Math.max(0, (item._sum.quantity ?? 0) - (item._sum.receivedQuantity ?? 0))]));
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
  const [lastMovements, recentSales] = productIds.length ? await Promise.all([
    prisma.stockMovement.groupBy({ by: ["productId"], where: { productId: { in: productIds }, ...scopedWarehouseFilter(auth, warehouseId) }, _max: { occurredAt: true } }),
    prisma.stockMovement.groupBy({ by: ["productId"], where: { productId: { in: productIds }, movementType: "SALE_ISSUE", occurredAt: { gte: thirtyDaysAgo }, ...scopedWarehouseFilter(auth, warehouseId) }, _sum: { quantity: true } }),
  ]) : [[], []];
  const usage30Days = new Map<string, number>();
  const lastMovement = new Map<string, Date>();
  for (const row of lastMovements) if (row._max.occurredAt) lastMovement.set(row.productId, row._max.occurredAt);
  for (const row of recentSales) usage30Days.set(row.productId, Math.abs(row._sum.quantity ?? 0));
  const costValues = new Map<string, { value: number; unknownUnits: number }>();
  for (const row of rows) { const cost = costValues.get(row.productId) ?? { value: 0, unknownUnits: 0 }; if (row.averageUnitCost === null) cost.unknownUnits += row.quantityOnHand; else cost.value += Number(row.averageUnitCost) * row.quantityOnHand; costValues.set(row.productId, cost); }
  const now = Date.now();
  const products = [...productRows.entries()].map(([productId, row]) => {
    const averageDailyUsage = (usage30Days.get(productId) ?? 0) / 30;
    const costValue = costValues.get(productId) ?? { value: 0, unknownUnits: 0 };
    const unitCost = costValue.unknownUnits ? null : row.quantityOnHand ? costValue.value / row.quantityOnHand : null;
    const daysSinceMovement = lastMovement.get(productId) ? Math.floor((now - lastMovement.get(productId)!.getTime()) / 86_400_000) : null;
    const targetStock = row.product.maxStock ?? row.product.minStock * 2;
    const incomingQuantity = incomingByProduct.get(productId) ?? 0;
    const projectedStock = row.availableQuantity + incomingQuantity;
    const daysUntilReorder = averageDailyUsage > 0 ? Math.max(0, (projectedStock - row.product.minStock) / averageDailyUsage) : null;
    const suggestedPurchaseDate = daysUntilReorder === null ? null : new Date(now + Math.max(0, daysUntilReorder - row.product.reorderLeadDays) * 86_400_000);
    return {
      productId,
      sku: row.product.sku,
      name: row.product.name,
      quantityOnHand: row.quantityOnHand,
      availableQuantity: row.availableQuantity,
      reservedQuantity: row.reservedQuantity,
      incomingQuantity: canReadPurchases ? incomingQuantity : null,
      projectedStock: canReadPurchases ? projectedStock : null,
      minStock: row.product.minStock,
      maxStock: row.product.maxStock,
      unitCost,
      valuation: costValue.value,
      unknownCostUnits: costValue.unknownUnits,
      averageDailyUsage: Math.round(averageDailyUsage * 100) / 100,
      daysSinceMovement,
      isDeadStock: row.quantityOnHand > 0 && (daysSinceMovement === null || daysSinceMovement >= 90),
      isSlowMoving: row.quantityOnHand > 0 && averageDailyUsage > 0 && averageDailyUsage < Math.max(1, row.product.minStock / 30),
      reorderQuantity: Math.max(0, targetStock - projectedStock),
      suggestedPurchaseDate,
    };
  }).sort((left, right) => right.valuation - left.valuation);
  const aging = [30, 60, 90].map((threshold, index, thresholds) => ({
    label: index === 0 ? `0-${threshold} days` : `${thresholds[index - 1] + 1}-${threshold} days`,
    quantity: products.filter((product) => product.daysSinceMovement !== null && product.daysSinceMovement > (thresholds[index - 1] ?? -1) && product.daysSinceMovement <= threshold).reduce((sum, product) => sum + product.quantityOnHand, 0),
  }));
  aging.push({ label: "90+ days / no movement", quantity: products.filter((product) => product.isDeadStock).reduce((sum, product) => sum + product.quantityOnHand, 0) });
  const reorder = products.filter((product) => product.availableQuantity <= product.minStock && product.reorderQuantity > 0).map((product) => ({ productId: product.productId, productName: product.name, available: product.availableQuantity, incomingQuantity: product.incomingQuantity, targetStock: product.maxStock ?? product.minStock * 2, suggestedQuantity: product.reorderQuantity, suggestedPurchaseDate: product.suggestedPurchaseDate }));
  const deadStock = products.filter((product) => product.isDeadStock).map((product) => ({ productId: product.productId, productName: product.name, quantity: product.quantityOnHand, daysSinceMovement: product.daysSinceMovement, valuation: product.valuation }));
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const inventoryValue = products.reduce((sum, product) => sum + product.valuation, 0);
  res.json({ success: true, data: { kpis: { inventoryValue, inventoryValuation: inventoryValue, unknownCostUnits: products.reduce((sum, row) => sum + row.unknownCostUnits, 0), deadStockValue: deadStock.reduce((sum, product) => sum + product.valuation, 0), slowMovingCount: products.filter((product) => product.isSlowMoving).length, reorderCount: reorder.length }, method: "MOVING_WEIGHTED_AVERAGE", products: products.slice(skip, skip + take), aging, reorder: reorder.slice(0, 100), deadStock: deadStock.slice(0, 100) }, meta: pageMeta(page, pageSize, products.length) });
}));

router.get("/stock-lookup", requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const barcode = typeof req.query.barcode === "string" ? req.query.barcode.trim() : "";
  const sku = typeof req.query.sku === "string" ? req.query.sku.trim() : "";
  if (!barcode && !sku) throw new AppError(400, "Provide a barcode or SKU");
  const product = await prisma.product.findFirst({ where: { isActive: true, OR: [barcode ? { barcode } : undefined, sku ? { sku } : undefined].filter(Boolean) as { barcode?: string; sku?: string }[] }, select: { id: true, sku: true, barcode: true, name: true, minStock: true, unit: { select: { code: true } } } });
  if (!product) throw new AppError(404, "Product not found");
  const balances = await stockReportRows(authOf(req), requestedWarehouseId(req), product.id);
  res.json({ success: true, data: { product, balances } });
}));

router.get("/warehouse-occupancy/:warehouseId", requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const warehouseId = z.uuid().parse(req.params.warehouseId);
  assertWarehouseAccess(authOf(req), warehouseId);
  const locations = await prisma.warehouseLocation.findMany({
    where: { warehouseId },
    include: { inventoryLocationBalances: { select: { productId: true, quantityOnHand: true, reservedQuantity: true } } },
    orderBy: { code: "asc" },
  });
  const data = locations.map((location) => {
    const unitsOnHand = location.inventoryLocationBalances.reduce((sum, balance) => sum + balance.quantityOnHand, 0);
    const reservedUnits = location.inventoryLocationBalances.reduce((sum, balance) => sum + balance.reservedQuantity, 0);
    return {
      id: location.id,
      code: location.code,
      name: location.name,
      zone: location.zone,
      rack: location.rack,
      shelf: location.shelf,
      bin: location.bin,
      locationType: location.locationType,
      capacity: location.capacity,
      capacityUnit: location.capacityUnit,
      unitsOnHand,
      reservedUnits,
      productLines: new Set(location.inventoryLocationBalances.map((balance) => balance.productId)).size,
      occupancyPercent: location.capacityUnit === "ITEM_UNITS" && location.capacity && location.capacity > 0 ? Math.round((unitsOnHand / location.capacity) * 10000) / 100 : null,
      overCapacity: location.capacityUnit === "ITEM_UNITS" && location.capacity !== null && unitsOnHand > location.capacity,
    };
  });
  res.json({ success: true, data });
}));

router.get("/unknown-cost-balances.csv", requirePermission("reports.read"), requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const warehouseId = requestedWarehouseId(req);
  const auth = authOf(req);
  const balances = await prisma.inventoryBalance.findMany({
    where: { ...scopedWarehouseFilter(auth, warehouseId), quantityOnHand: { gt: 0 }, averageUnitCost: null },
    take: 10000,
    orderBy: [{ warehouse: { name: "asc" } }, { product: { name: "asc" } }],
    include: { product: { select: { sku: true, name: true, unit: { select: { code: true } } } }, warehouse: { select: { code: true, name: true } } },
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=stock-with-unknown-cost.csv");
  res.send(csvDocument([["Warehouse code", "Warehouse", "SKU", "Product", "Unit", "Physical quantity", "Opening unit cost", "Evidence / reason"], ...balances.map((row) => [row.warehouse.code, row.warehouse.name, row.product.sku, row.product.name, row.product.unit?.code ?? "", row.quantityOnHand, "", ""])]));
}));

router.post("/internal-relocations", requirePermission("inventory.relocate"), asyncHandler(async (req, res) => {
  const input = relocationSchema.parse(req.body);
  const auth = authOf(req);
  assertWarehouseAccess(auth, input.warehouseId);
  const data = await prisma.$transaction(async (tx) => {
    const [source, destination] = await Promise.all([
      tx.warehouseLocation.findFirst({ where: { id: input.fromLocationId, warehouseId: input.warehouseId, isActive: true, locationType: "STORAGE" } }),
      tx.warehouseLocation.findFirst({ where: { id: input.toLocationId, warehouseId: input.warehouseId, isActive: true, locationType: "STORAGE" } }),
    ]);
    if (!source || !destination) throw new AppError(400, "Relocation requires two active STORAGE locations in the selected warehouse");
    const relocation = await tx.stockRelocation.create({
      data: {
        number: `REL-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
        warehouseId: input.warehouseId,
        fromLocationId: source.id,
        toLocationId: destination.id,
        createdById: auth.userId,
        reason: input.reason ?? null,
      },
    });
    for (const item of input.items) {
      const outboundAllocations = await postStockOut(tx, item.productId, input.warehouseId, item.quantity, { locationId: source.id, batchId: item.batchId ?? null });
      for (const allocation of outboundAllocations) {
        const inboundAllocation = await postStockIn(tx, { productId: item.productId, warehouseId: input.warehouseId, locationId: destination.id, batchId: allocation.batchId, quantity: allocation.quantity, unitCost: allocation.unitCost ?? null });
        const outbound = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: input.warehouseId, quantity: -allocation.quantity, movementType: "RELOCATION_OUT", createdById: auth.userId, note: `Internal relocation ${relocation.number}: ${source.code} to ${destination.code}` } });
        const inbound = await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: input.warehouseId, quantity: allocation.quantity, movementType: "RELOCATION_IN", createdById: auth.userId, note: `Internal relocation ${relocation.number}: ${source.code} to ${destination.code}` } });
        await linkMovementAllocations(tx, outbound.id, [allocation], -1);
        await linkMovementAllocations(tx, inbound.id, [inboundAllocation], 1);
        await tx.stockRelocationItem.create({ data: { relocationId: relocation.id, productId: item.productId, batchId: allocation.batchId, quantity: allocation.quantity } });
      }
    }
    const complete = await tx.stockRelocation.findUniqueOrThrow({ where: { id: relocation.id }, include: { fromLocation: { select: { code: true, name: true } }, toLocation: { select: { code: true, name: true } }, items: { include: { product: { select: { sku: true, name: true } } } } } });
    await writeAuditLog({ userId: auth.userId, action: "RELOCATE", entity: "StockRelocation", entityId: complete.id, afterData: complete }, tx as never);
    return complete;
  }, { timeout: 20_000 });
  await notifyByPermission({ permission: "inventory.read", type: "INTERNAL_RELOCATION", title: "Internal relocation completed", message: `${data.number} moved stock from ${data.fromLocation.code} to ${data.toLocation.code}.`, entity: "StockRelocation", entityId: data.id, warehouseId: input.warehouseId });
  res.status(201).json({ success: true, message: "Internal relocation completed", data });
}));

router.get("/stock-report", requirePermission("reports.read"), asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const auth = authOf(req);
  const warehouseId = requestedWarehouseId(req);
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
  const where = { ...scopedWarehouseFilter(auth, warehouseId), ...(productId ? { productId } : {}), ...(search ? { product: { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { sku: { contains: search, mode: "insensitive" as const } }, { barcode: { contains: search, mode: "insensitive" as const } }] } } : {}) };
  const [rows, total] = await Promise.all([stockReportRows(auth, warehouseId, productId, { skip, take }, search), prisma.inventoryBalance.count({ where })]);
  res.json({ success: true, data: rows, meta: pageMeta(page, pageSize, total) });
}));

router.get("/stock-report.csv", requirePermission("reports.read"), asyncHandler(async (req, res) => {
  const rows = await stockReportRows(authOf(req), requestedWarehouseId(req), typeof req.query.productId === "string" ? req.query.productId : undefined, undefined, typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "");
  const lines = [
    ["SKU", "Barcode", "Product", "Warehouse", "Location", "On Hand", "Reserved", "Quarantine", "Expired", "Other unavailable", "Available", "Detail missing", "Minimum", "Reorder Quantity", "Health"],
    ...rows.map((row) => [row.product.sku, row.product.barcode, row.product.name, row.warehouse.name, row.location?.code ?? "", row.quantityOnHand, row.reservedQuantity, row.quarantineQuantity, row.expiredQuantity, row.otherUnavailableQuantity, row.availableQuantity, row.detailMissing ? "YES" : "NO", row.product.minStock, row.reorderQuantity, row.isLowStock ? "LOW_STOCK" : "HEALTHY"]),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="stock-report-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csvDocument(lines));
}));

export default router;

