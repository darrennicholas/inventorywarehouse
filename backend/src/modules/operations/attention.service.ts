import { prisma } from "../../lib/prisma.ts";
import type { AuthContext } from "../../middlewares/auth.middleware.ts";
import { warehouseScope } from "../../rbac/warehouse-scope.ts";

export async function attentionItems(auth: AuthContext) {
  const configured = Number(process.env.STOCKFLOW_ATTENTION_DAYS ?? 7);
  const days = Number.isInteger(configured) && configured >= 1 && configured <= 365 ? configured : 7;
  const cutoff = new Date(Date.now() - days * 86400000); const scope = warehouseScope(auth);
  const warehouse = scope ? { warehouseId: { in: scope } } : {};
  const transfers = scope ? { OR: [{ fromWarehouseId: { in: scope } }, { toWarehouseId: { in: scope } }] } : {};
  const [purchases, sales, moves, opnames] = await Promise.all([
    auth.permissions.includes("purchases.read") ? prisma.purchaseOrder.findMany({ where: { ...warehouse, status: { in: ["PENDING", "APPROVED", "PARTIALLY_RECEIVED"] }, updatedAt: { lte: cutoff } }, select: { id: true, number: true, status: true, updatedAt: true }, orderBy: { updatedAt: "asc" }, take: 10 }) : [],
    auth.permissions.includes("sales.read") ? prisma.sale.findMany({ where: { ...warehouse, status: { in: ["RESERVED", "PICKING", "PACKED", "PARTIALLY_SHIPPED"] }, updatedAt: { lte: cutoff } }, select: { id: true, number: true, status: true, updatedAt: true }, orderBy: { updatedAt: "asc" }, take: 10 }) : [],
    auth.permissions.includes("transfers.read") ? prisma.stockTransfer.findMany({ where: { ...transfers, status: "IN_TRANSIT", updatedAt: { lte: cutoff } }, select: { id: true, number: true, status: true, updatedAt: true }, orderBy: { updatedAt: "asc" }, take: 10 }) : [],
    auth.permissions.includes("stock-opnames.read") ? prisma.stockTakeSession.findMany({ where: { ...warehouse, status: "SUBMITTED", updatedAt: { lte: cutoff } }, select: { id: true, number: true, status: true, updatedAt: true }, orderBy: { updatedAt: "asc" }, take: 10 }) : [],
  ]);
  const rows = [
    ...purchases.map((row) => ({ ...row, entity: "PurchaseOrder", page: "purchases", label: "Purchase" })),
    ...sales.map((row) => ({ ...row, entity: "Sale", page: "sales", label: "Sale" })),
    ...moves.map((row) => ({ ...row, entity: "StockTransfer", page: "transfers", label: "Transfer" })),
    ...opnames.map((row) => ({ ...row, entity: "StockTakeSession", page: "stock-opnames", label: "Stock opname" })),
  ].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
  return { days, rows };
}
