
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { requireUuid } from "../../utils/requireUuid.ts";

import { supplierService } from "./supplier.service.ts";
import { authOf } from "../../middlewares/auth.middleware.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { prisma } from "../../lib/prisma.ts";
import { AppError } from "../../utils/AppError.ts";
import { masterListOptions, pageMeta, paginateArray } from "../../utils/pagination.ts";
import { scopedWarehouseFilter, warehouseScope } from "../../rbac/warehouse-scope.ts";

import {
  createSupplierSchema,
  updateSupplierSchema,
} from "./supplier.validation.ts";

export const getSuppliers = asyncHandler(
  async (req, res) => {
    const options = masterListOptions(req.query as Record<string, unknown>);
    if (options) {
      const [data, total] = await Promise.all([supplierService.list(options), supplierService.count(options)]);
      res.status(200).json({ success: true, data, meta: pageMeta(options.page, options.pageSize, total) });
      return;
    }
    const data = await supplierService.list();
    const result = paginateArray(data, req.query as Record<string, unknown>);

    res.status(200).json({
      success: true,
      ...result,
    });
  }
);

export const getSupplierById = asyncHandler(
  async (req, res) => {
    const id = requireUuid(
      req.params.id,
      "Supplier ID"
    );

    const data = await supplierService.detail(id);

    res.status(200).json({
      success: true,
      data,
    });
  }
);

export const getSupplierAnalytics = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Supplier ID");
    const auth = authOf(req);
    if (!auth.permissions.includes("purchases.read")) throw new AppError(403, "Purchase read permission is required for supplier analytics");
    const warehouseFilter = scopedWarehouseFilter(auth);
    const scope = warehouseScope(auth);
    const supplier = await prisma.supplier.findUnique({ where: { id }, select: { id: true, code: true, name: true } });
    if (!supplier) throw new AppError(404, "Supplier not found");
    const [orders, deliveryStats, latestLines] = await Promise.all([
      prisma.purchaseOrder.aggregate({ where: { supplierId: id, status: { not: "CANCELLED" }, ...warehouseFilter }, _count: { _all: true }, _sum: { total: true } }),
      prisma.$queryRaw<Array<{ orderCount: bigint; receivedCount: bigint; expectedCount: bigint; onTimeCount: bigint; averageLeadDays: number | null }>>`
        SELECT COUNT(*)::bigint AS "orderCount",
          COUNT(receipt."receivedAt")::bigint AS "receivedCount",
          COUNT(receipt."receivedAt") FILTER (WHERE po."expectedDate" IS NOT NULL)::bigint AS "expectedCount",
          COUNT(receipt."receivedAt") FILTER (WHERE po."expectedDate" IS NOT NULL AND receipt."receivedAt" <= po."expectedDate")::bigint AS "onTimeCount",
          AVG(EXTRACT(EPOCH FROM (receipt."receivedAt" - po."orderDate")) / 86400)::float AS "averageLeadDays"
        FROM "PurchaseOrder" po
        LEFT JOIN LATERAL (
          SELECT MIN(gr."receivedAt") AS "receivedAt"
          FROM "GoodsReceipt" gr WHERE gr."purchaseOrderId" = po."id"
        ) receipt ON TRUE
        WHERE po."supplierId" = ${id}::uuid AND po."status" <> 'CANCELLED'
          AND (${Boolean(scope)} = FALSE OR po."warehouseId" = ${scope?.[0] ?? null}::uuid)
      `,
      prisma.purchaseOrderItem.findMany({
        where: { purchaseOrder: { supplierId: id, status: { not: "CANCELLED" }, ...warehouseFilter } },
        select: { unitPrice: true, quantity: true, product: { select: { id: true, sku: true, name: true } }, purchaseOrder: { select: { number: true, orderDate: true, status: true } } },
        orderBy: { purchaseOrder: { orderDate: "desc" } },
        take: 30,
      }),
    ]);
    const stats = deliveryStats[0];
    const totalOrders = orders._count._all;
    const receivedCount = Number(stats?.receivedCount ?? 0n);
    const expectedCount = Number(stats?.expectedCount ?? 0n);
    const onTimeCount = Number(stats?.onTimeCount ?? 0n);
    const averageLeadDays = stats?.averageLeadDays ?? null;
    const onTimeRate = expectedCount ? (onTimeCount / expectedCount) * 100 : null;
    const receiptRate = totalOrders ? (receivedCount / totalOrders) * 100 : 0;
    const priceHistory = latestLines.map((item) => ({
      orderDate: item.purchaseOrder.orderDate,
      orderNumber: item.purchaseOrder.number,
      status: item.purchaseOrder.status,
      product: item.product,
      unitPrice: Number(item.unitPrice),
      quantity: item.quantity,
    }));
    const score = Math.round(Math.min(100, receiptRate * 0.45 + (onTimeRate ?? 70) * 0.35 + Math.max(0, 20 - (averageLeadDays ?? 14))));
    res.json({ success: true, data: {
      supplier,
      metrics: { totalOrders, receivedOrders: receivedCount, averageLeadDays: averageLeadDays === null ? null : Math.round(averageLeadDays * 10) / 10, onTimeRate: onTimeRate === null ? null : Math.round(onTimeRate * 10) / 10, totalSpend: Number(orders._sum.total ?? 0), score },
      priceHistory,
    } });
  }
);

export const createSupplier = asyncHandler(
  async (req, res) => {
    const input = createSupplierSchema.parse(req.body);

    const data = await supplierService.create(input);
    await writeAuditLog({ userId: authOf(req).userId, action: "CREATE", entity: "Supplier", entityId: data.id, afterData: data, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") });
    await notifyByPermission({ permission: "suppliers.read", type: "SUPPLIER_CREATED", title: "Supplier created", message: `${data.name} was added to supplier master data.`, entity: "Supplier", entityId: data.id });

    res.status(201).json({
      success: true,
      message: "Supplier created successfully",
      data,
    });
  }
);

export const updateSupplier = asyncHandler(
  async (req, res) => {
    const id = requireUuid(
      req.params.id,
      "Supplier ID"
    );

    const input = updateSupplierSchema.parse(req.body);

    const data = await supplierService.update(
      id,
      input
    );
    await writeAuditLog({ userId: authOf(req).userId, action: "UPDATE", entity: "Supplier", entityId: data.id, afterData: data, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") });
    await notifyByPermission({ permission: "suppliers.read", type: "SUPPLIER_UPDATED", title: "Supplier updated", message: `${data.name} was updated.`, entity: "Supplier", entityId: data.id });

    res.status(200).json({
      success: true,
      message: "Supplier updated successfully",
      data,
    });
  }
);

export const deactivateSupplier = asyncHandler(
  async (req, res) => {
    const id = requireUuid(
      req.params.id,
      "Supplier ID"
    );

    const data = await supplierService.deactivate(id);
    await writeAuditLog({ userId: authOf(req).userId, action: "DEACTIVATE", entity: "Supplier", entityId: data.id, afterData: data, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") });
    await notifyByPermission({ permission: "suppliers.read", type: "SUPPLIER_DEACTIVATED", title: "Supplier deactivated", message: `${data.name} was deactivated.`, entity: "Supplier", entityId: data.id });

    res.status(200).json({
      success: true,
      message: "Supplier deactivated successfully",
      data,
    });
  }
);
