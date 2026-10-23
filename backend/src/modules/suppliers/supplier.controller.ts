
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { requireUuid } from "../../utils/requireUuid.ts";

import { supplierService } from "./supplier.service.ts";
import { authOf } from "../../middlewares/auth.middleware.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { prisma } from "../../lib/prisma.ts";
import { AppError } from "../../utils/AppError.ts";
import { paginateArray } from "../../utils/pagination.ts";

import {
  createSupplierSchema,
  updateSupplierSchema,
} from "./supplier.validation.ts";

export const getSuppliers = asyncHandler(
  async (req, res) => {
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
    const supplier = await prisma.supplier.findUnique({ where: { id }, select: { id: true, code: true, name: true } });
    if (!supplier) throw new AppError(404, "Supplier not found");
    const orders = await prisma.purchaseOrder.findMany({
      where: { supplierId: id, status: { not: "CANCELLED" } },
      include: {
        receipts: { select: { receivedAt: true }, orderBy: { receivedAt: "asc" }, take: 1 },
        items: { include: { product: { select: { id: true, sku: true, name: true } } } },
      },
      orderBy: { orderDate: "desc" },
      take: 500,
    });
    const received = orders.filter((order) => order.receipts[0]);
    const leadTimes = received.map((order) => (order.receipts[0]!.receivedAt.getTime() - order.orderDate.getTime()) / 86_400_000);
    const expectedOrders = received.filter((order) => order.expectedDate);
    const onTime = expectedOrders.filter((order) => order.receipts[0]!.receivedAt <= order.expectedDate!).length;
    const lines = orders.flatMap((order) => order.items.map((item) => ({
      orderDate: order.orderDate,
      orderNumber: order.number,
      status: order.status,
      product: item.product,
      unitPrice: Number(item.unitPrice),
      quantity: item.quantity,
    })));
    const priceHistory = lines.sort((left, right) => right.orderDate.getTime() - left.orderDate.getTime()).slice(0, 30);
    const averageLeadDays = leadTimes.length ? leadTimes.reduce((sum, days) => sum + days, 0) / leadTimes.length : null;
    const onTimeRate = expectedOrders.length ? (onTime / expectedOrders.length) * 100 : null;
    const receiptRate = orders.length ? (received.length / orders.length) * 100 : 0;
    const score = Math.round(Math.min(100, receiptRate * 0.45 + (onTimeRate ?? 70) * 0.35 + Math.max(0, 20 - (averageLeadDays ?? 14))));
    res.json({ success: true, data: {
      supplier,
      metrics: { totalOrders: orders.length, receivedOrders: received.length, averageLeadDays: averageLeadDays === null ? null : Math.round(averageLeadDays * 10) / 10, onTimeRate: onTimeRate === null ? null : Math.round(onTimeRate * 10) / 10, totalSpend: orders.reduce((sum, order) => sum + Number(order.total), 0), score },
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
