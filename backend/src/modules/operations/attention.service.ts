import { prisma } from "../../lib/prisma.ts";
import type { AuthContext } from "../../middlewares/auth.middleware.ts";
import { warehouseScope } from "../../rbac/warehouse-scope.ts";

export async function attentionItems(auth: AuthContext, options?: { kind: "purchases" | "sales" | "transfers" | "stock-opnames"; page: number; search: string }) {
  const configured = Number(process.env.STOCKFLOW_ATTENTION_DAYS ?? 7);
  const days = Number.isInteger(configured) && configured >= 1 && configured <= 365 ? configured : 7;
  const cutoff = new Date(Date.now() - days * 86400000); const scope = warehouseScope(auth);
  const warehouse = scope ? { warehouseId: { in: scope } } : {};
  const transfers = scope ? { OR: [{ fromWarehouseId: { in: scope } }, { toWarehouseId: { in: scope } }] } : {};
  if (options) {
    const take = 20, skip = (options.page - 1) * take;
    const text = options.search ? { number: { contains: options.search, mode: "insensitive" as const } } : {};
    const select = { id: true, number: true, status: true, updatedAt: true } as const;
    const orderBy = [{ updatedAt: "asc" as const }, { id: "asc" as const }];
    if (!auth.permissions.includes(`${options.kind}.read`)) return { days, rows: [], total: 0, page: options.page, pageSize: take };
    if (options.kind === "purchases") {
      const where = { ...warehouse, ...text, status: { in: ["PENDING", "APPROVED", "PARTIALLY_RECEIVED"] as ("PENDING" | "APPROVED" | "PARTIALLY_RECEIVED")[] }, updatedAt: { lte: cutoff } };
      const [items, total] = await Promise.all([prisma.purchaseOrder.findMany({ where, select, orderBy, skip, take }), prisma.purchaseOrder.count({ where })]);
      return { days, total, page: options.page, pageSize: take, rows: items.map((row) => ({ ...row, entity: "PurchaseOrder", page: "purchases", label: "Purchase" })) };
    }
    if (options.kind === "sales") {
      const where = { ...warehouse, ...text, status: { in: ["RESERVED", "PICKING", "PACKED", "PARTIALLY_SHIPPED"] as ("RESERVED" | "PICKING" | "PACKED" | "PARTIALLY_SHIPPED")[] }, updatedAt: { lte: cutoff } };
      const [items, total] = await Promise.all([prisma.sale.findMany({ where, select, orderBy, skip, take }), prisma.sale.count({ where })]);
      return { days, total, page: options.page, pageSize: take, rows: items.map((row) => ({ ...row, entity: "Sale", page: "sales", label: "Sale" })) };
    }
    if (options.kind === "transfers") {
      const where = { ...transfers, ...text, status: "IN_TRANSIT" as const, updatedAt: { lte: cutoff } };
      const [items, total] = await Promise.all([prisma.stockTransfer.findMany({ where, select, orderBy, skip, take }), prisma.stockTransfer.count({ where })]);
      return { days, total, page: options.page, pageSize: take, rows: items.map((row) => ({ ...row, entity: "StockTransfer", page: "transfers", label: "Transfer" })) };
    }
    const where = { ...warehouse, ...text, status: "SUBMITTED" as const, updatedAt: { lte: cutoff } };
    const [items, total] = await Promise.all([prisma.stockTakeSession.findMany({ where, select, orderBy, skip, take }), prisma.stockTakeSession.count({ where })]);
    return { days, total, page: options.page, pageSize: take, rows: items.map((row) => ({ ...row, entity: "StockTakeSession", page: "stock-opnames", label: "Stock opname" })) };
  }
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
