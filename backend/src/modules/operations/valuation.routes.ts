import { Router } from "express";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "../../lib/prisma.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess, scopedWarehouseFilter } from "../../rbac/warehouse-scope.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { AppError } from "../../utils/AppError.ts";
import { lockCostBalance, originalSaleCost } from "./costing.service.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { assertApprovalAuthority } from "../approvals/approval-policy.service.ts";
import { jakartaSnapshotDate } from "./valuation-snapshot.service.ts";
const router = Router();
const stockQuery = z.object({ productId: z.uuid(), warehouseId: z.uuid() });
router.get("/stock-cost", requirePermission("inventory.read"), requirePermission("reports.read"), asyncHandler(async (req, res) => {
  const query = stockQuery.parse(req.query); assertWarehouseAccess(authOf(req), query.warehouseId);
  const data = await prisma.inventoryBalance.findUnique({ where: { productId_warehouseId: query }, select: { quantityOnHand: true, averageUnitCost: true } });
  if (!data) throw new AppError(404, "Stock balance not found");
  res.json({ success: true, data: { ...data, value: data.averageUnitCost?.mul(data.quantityOnHand) ?? null, method: "MOVING_WEIGHTED_AVERAGE" } });
}));
router.post("/stock-cost/opening", requirePermission("adjustments.approve"), requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const input = stockQuery.extend({ expectedQuantity: z.number().int().nonnegative(), unitCost: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/), reason: z.string().trim().min(10).max(500) }).strict().parse(req.body);
  const auth = authOf(req); assertWarehouseAccess(auth, input.warehouseId);
  const data = await prisma.$transaction(async (tx) => {
    const exists = await tx.inventoryBalance.findUnique({ where: { productId_warehouseId: { productId: input.productId, warehouseId: input.warehouseId } } });
    if (!exists) throw new AppError(404, "Balance not found");
    const balance = await lockCostBalance(tx, input.productId, input.warehouseId);
    if (balance.averageUnitCost !== null) throw new AppError(409, "Opening cost can only initialize an unknown cost");
    if (balance.quantityOnHand !== input.expectedQuantity) throw new AppError(409, "Stock changed; reload before setting opening cost");
    await assertApprovalAuthority(tx, "ADJUSTMENT", new Prisma.Decimal(input.unitCost).mul(balance.quantityOnHand).toNumber(), auth);
    const data = await tx.inventoryBalance.update({ where: { id: balance.id }, data: { averageUnitCost: new Prisma.Decimal(input.unitCost) } });
    await writeAuditLog({ userId: auth.userId, action: "OPENING_COST", entity: "InventoryBalance", entityId: balance.id, beforeData: { averageUnitCost: null }, afterData: { unitCost: input.unitCost, quantity: input.expectedQuantity, reason: input.reason } }, tx as never);
    return { quantityOnHand: data.quantityOnHand, averageUnitCost: data.averageUnitCost };
  });
  res.json({ success: true, data });
}));
router.get("/valuation-profit", requirePermission("reports.read"), requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const query = z.object({ warehouseId: z.uuid().optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }).parse(req.query);
  if (query.from && query.to && query.from > query.to) throw new AppError(400, "Start date must precede end date");
  const auth = authOf(req); const scope = scopedWarehouseFilter(auth, query.warehouseId);
  const from = query.from ? new Date(`${query.from}T00:00:00+07:00`) : new Date(Date.now() - 30 * 86400000);
  const to = query.to ? new Date(new Date(`${query.to}T00:00:00+07:00`).getTime() + 86400000) : new Date();
  const targetDay = query.to ? new Date(`${query.to}T00:00:00.000Z`) : jakartaSnapshotDate();
  const todayJakarta = jakartaSnapshotDate();
  const historicalRequested = targetDay.getTime() < todayJakarta.getTime();
  if (to.getTime() - from.getTime() > 366 * 86400000) throw new AppError(400, "Maximum reporting period is 366 days");
  const data = await prisma.$transaction(async (tx) => {
    const snapshot = historicalRequested ? await tx.inventoryValuationSnapshot.findFirst({ where: { ...scope, snapshotDate: targetDay }, select: { snapshotDate: true } }) : null;
    let inventoryValue = new Prisma.Decimal(0), unknownUnits = 0;
    if (snapshot) {
      const rows = await tx.inventoryValuationSnapshot.findMany({ where: { ...scope, snapshotDate: snapshot.snapshotDate }, select: { knownValue: true, quantityOnHand: true, averageUnitCost: true } });
      for (const row of rows) { if (row.averageUnitCost === null) unknownUnits += row.quantityOnHand; else inventoryValue = inventoryValue.plus(row.knownValue ?? row.averageUnitCost.mul(row.quantityOnHand)); }
    } else if (!historicalRequested) {
      const balances = await tx.inventoryBalance.findMany({ where: scope, select: { quantityOnHand: true, averageUnitCost: true } });
      for (const row of balances) { if (row.averageUnitCost === null) unknownUnits += row.quantityOnHand; else inventoryValue = inventoryValue.plus(row.averageUnitCost.mul(row.quantityOnHand)); }
    }
    const valuationMeta = { inventoryValuationAsOf: snapshot?.snapshotDate ?? (historicalRequested ? null : jakartaSnapshotDate()), inventoryValuationSource: snapshot ? "DAILY_CLOSING_SNAPSHOT" : historicalRequested ? "UNAVAILABLE" : "CURRENT_BALANCE", historicalSnapshotAvailable: !historicalRequested || Boolean(snapshot) };
    const reportedInventoryValue = historicalRequested && !snapshot ? null : inventoryValue;
    if (!auth.permissions.includes("sales.read")) return { inventoryValue: reportedInventoryValue, unknownUnits, ...valuationMeta, revenue: null, cogs: null, grossProfit: null, unknownCostUnits: null, method: "MOVING_WEIGHTED_AVERAGE" };
    const issues = await tx.stockMovement.findMany({ where: { ...scope, movementType: "SALE_ISSUE", occurredAt: { gte: from, lt: to } }, include: { sale: { include: { items: true } } } });
    const returns = await tx.returnOrder.findMany({ where: { ...scope, type: "SALE", status: "POSTED", postedAt: { gte: from, lt: to } }, include: { sale: true, items: { include: { saleItem: true } } } });
    let revenue = new Prisma.Decimal(0), knownCogs = new Prisma.Decimal(0), unknownCostUnits = 0;
    for (const row of issues) {
      const item = row.sale?.items.find((item) => item.productId === row.productId); const sale = row.sale;
      if (!item || !sale) { unknownCostUnits += Math.abs(row.quantity); continue; }
      const ratio = sale.subtotal.gt(0) ? sale.subtotal.minus(sale.discount).div(sale.subtotal) : new Prisma.Decimal(0);
      revenue = revenue.plus(item.unitPrice.mul(Math.abs(row.quantity)).mul(ratio));
      if (row.costMethod !== "WAC" || row.unitCost === null) unknownCostUnits += Math.abs(row.quantity);
      else knownCogs = knownCogs.plus(row.unitCost.mul(Math.abs(row.quantity)));
    }
    for (const doc of returns) for (const item of doc.items) {
      if (!doc.sale || !item.saleItem) continue;
      const ratio = doc.sale.subtotal.gt(0) ? doc.sale.subtotal.minus(doc.sale.discount).div(doc.sale.subtotal) : new Prisma.Decimal(0);
      revenue = revenue.minus(item.saleItem.unitPrice.mul(item.quantity).mul(ratio));
      if (item.disposition !== "SCRAP") { const cost = await originalSaleCost(tx, doc.saleId!, item.productId); if (cost === null) unknownCostUnits += item.quantity; else knownCogs = knownCogs.minus(cost.mul(item.quantity)); }
    }
    const grossProfit = unknownCostUnits ? null : revenue.minus(knownCogs);
    return { inventoryValue: reportedInventoryValue, unknownUnits, ...valuationMeta, revenue, cogs: unknownCostUnits ? null : knownCogs, knownCogs, grossProfit, grossMargin: grossProfit && revenue.gt(0) ? grossProfit.div(revenue).mul(100) : null, unknownCostUnits, method: "MOVING_WEIGHTED_AVERAGE" };
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
  res.json({ success: true, data: { ...data, from, to, accountingNote: "Net sales exclude invoice tax, include proportional discount and posted sales returns. Purchase tax is not capitalized. Unknown legacy costs are excluded from known valuation and prevent complete profit." } });
}));
export default router;
