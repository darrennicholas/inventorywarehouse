import type { Prisma } from "../../generated/prisma/client.ts";

/**
 * Repository only: business policies, locking, and posting remain in
 * return.service.ts. Every mutation should receive the same transaction.
 */
export type ReturnTx = Prisma.TransactionClient;
export type ReturnKind = "PURCHASE" | "SALE";
export type ReturnState = "DRAFT" | "PENDING" | "APPROVED" | "POSTED" | "CANCELLED";

export const returnDetailInclude = {
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, fullName: true, email: true } },
  approvedBy: { select: { id: true, fullName: true } },
  purchaseOrder: { select: { id: true, number: true, warehouseId: true, status: true } },
  sale: { select: { id: true, number: true, warehouseId: true, status: true } },
  items: {
    include: {
      product: { select: { id: true, sku: true, name: true, trackBatch: true } },
      location: { select: { id: true, warehouseId: true, code: true, locationType: true, isActive: true } },
      batch: { select: { id: true, productId: true, warehouseId: true, batchNumber: true, status: true, expiryDate: true } },
    },
  },
} as const;

export function makeReturnRepository(tx: ReturnTx) {
  return {
    findById: (id: string) => tx.returnOrder.findUnique({ where: { id }, include: returnDetailInclude }),
    findByNumber: (number: string) => tx.returnOrder.findUnique({ where: { number }, select: { id: true } }),
    findPurchase: (id: string) => tx.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    }),
    findSale: (id: string) => tx.sale.findUnique({
      where: { id },
      include: { items: true },
    }),
    findLocation: (id: string) => tx.warehouseLocation.findUnique({ where: { id } }),
    findBatch: (id: string) => tx.productBatch.findUnique({ where: { id } }),
    findProduct: (id: string) => tx.product.findUnique({ where: { id }, select: { id: true, trackBatch: true, isActive: true } }),

    /** Totals across all POSTED returns for an individual source line. */
    postedPurchaseReturnQuantity: async (purchaseOrderItemId: string) => {
      const result = await tx.returnOrderItem.aggregate({
        where: { purchaseOrderItemId, returnOrder: { type: "PURCHASE", status: "POSTED" } },
        _sum: { quantity: true },
      });
      return result._sum.quantity ?? 0;
    },
    postedSaleReturnQuantity: async (saleItemId: string) => {
      const result = await tx.returnOrderItem.aggregate({
        where: { saleItemId, returnOrder: { type: "SALE", status: "POSTED" } },
        _sum: { quantity: true },
      });
      return result._sum.quantity ?? 0;
    },

    /** Returns count=1 only when the expected state still matches. */
    transitionStatus: (
      id: string,
      from: ReturnState,
      to: ReturnState,
      extra?: { approvedById?: string; approvedAt?: Date; postedAt?: Date },
    ) => tx.returnOrder.updateMany({
      where: { id, status: from },
      data: { status: to, ...extra },
    }),

    createPurchase: (
      data: Prisma.ReturnOrderCreateInput,
    ) => tx.returnOrder.create({ data, include: returnDetailInclude }),

    createSale: (
      data: Prisma.ReturnOrderCreateInput,
    ) => tx.returnOrder.create({ data, include: returnDetailInclude }),

    updateDraft: (id: string, data: { reason?: string; notes?: string | null }) =>
      tx.returnOrder.updateMany({ where: { id, status: "DRAFT" }, data }),

    cancelUnposted: (id: string) => tx.returnOrder.updateMany({
      where: { id, status: { in: ["DRAFT", "PENDING", "APPROVED"] } },
      data: { status: "CANCELLED" },
    }),
  };
}

/** The service must pass warehouse scope derived from authenticated RBAC. */
export async function listReturns(
  tx: ReturnTx,
  args: {
    type: ReturnKind;
    page: number;
    pageSize: number;
    status?: ReturnState;
    warehouseIds?: string[];
    warehouseId?: string;
    search?: string;
  },
) {
  const where: Prisma.ReturnOrderWhereInput = {
    type: args.type,
    ...(args.status ? { status: args.status } : {}),
    ...(args.search ? { number: { contains: args.search, mode: "insensitive" } } : {}),
    warehouseId: args.warehouseId && args.warehouseIds
      ? { equals: args.warehouseId, in: args.warehouseIds }
      : args.warehouseId
        ? args.warehouseId
        : args.warehouseIds ? { in: args.warehouseIds } : undefined,
  };
  const [data, total] = await Promise.all([
    tx.returnOrder.findMany({
      where,
      include: returnDetailInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (args.page - 1) * args.pageSize,
      take: args.pageSize,
    }),
    tx.returnOrder.count({ where }),
  ]);
  return { data, total, page: args.page, pageSize: args.pageSize };
}
