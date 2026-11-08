
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { AppError } from "../../utils/AppError.ts";
import { requireUuid } from "../../utils/requireUuid.ts";

import { brandService } from "./brand.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { masterListOptions, pageMeta, paginateArray } from "../../utils/pagination.ts";
import { prisma } from "../../lib/prisma.ts";
import { authOf } from "../../middlewares/auth.middleware.ts";
import { requestAuditContext, writeAuditLog } from "../audit/audit.service.ts";

import type {
  CreateBrandInput,
  UpdateBrandInput,
} from "./brand.validation.ts";

export const getBrands = asyncHandler(
  async (req, res) => {
    const options = masterListOptions(req.query as Record<string, unknown>);
    if (options) {
      const where = { ...(options.isActive !== undefined ? { isActive: options.isActive } : {}), ...(options.search ? { OR: [{ name: { contains: options.search, mode: "insensitive" as const } }] } : {}) };
      const [data, total] = await Promise.all([prisma.brand.findMany({ where, skip: options.skip, take: options.take, orderBy: [{ name: "asc" }, { id: "asc" }] }), prisma.brand.count({ where })]);
      res.status(200).json({ success: true, data, meta: pageMeta(options.page, options.pageSize, total) }); return;
    }
    const data = await brandService.list();
    const result = paginateArray(data, req.query as Record<string, unknown>);

    res.status(200).json({
      success: true,
      ...result,
    });
  }
);

export const getBrandById = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Brand ID");
    const data = await brandService.detail(id);

    res.status(200).json({
      success: true,
      data,
    });
  }
);

export const createBrand = asyncHandler(
  async (req, res) => {
    const input = req.body as CreateBrandInput;
    const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
    const data = await prisma.$transaction(async (tx) => {
      const created = await tx.brand.create({ data: input });
      await writeAuditLog({ userId: authOf(req).userId, action: "CREATE", entity: "Brand", entityId: created.id, afterData: created, ...auditContext }, tx as never);
      return created;
    });
    await notifyByPermission({ permission: "brands.read", type: "BRAND_CREATED", title: "Brand created", message: `${data.name} was added to product master data.`, entity: "Brand", entityId: data.id });

    res.status(201).json({
      success: true,
      message: "Brand created successfully",
      data,
    });
  }
);

export const updateBrand = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Brand ID");

    const input = req.body as UpdateBrandInput;
    const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
    const data = await prisma.$transaction(async (tx) => {
      const before = await tx.brand.findUnique({ where: { id } });
      if (!before) throw new AppError(404, "Brand not found");
      if (before.isActive && input.isActive === false && await tx.product.count({ where: { brandId: id, isActive: true } })) throw new AppError(409, "Cannot deactivate Brand while active products use it");
      const updated = await tx.brand.update({ where: { id }, data: input });
      await writeAuditLog({ userId: authOf(req).userId, action: "UPDATE", entity: "Brand", entityId: id, beforeData: before, afterData: updated, ...auditContext }, tx as never);
      return updated;
    });
    await notifyByPermission({ permission: "brands.read", type: "BRAND_UPDATED", title: "Brand updated", message: `${data.name} was updated.`, entity: "Brand", entityId: data.id });

    res.status(200).json({
      success: true,
      message: "Brand updated successfully",
      data,
    });
  }
);

export const deactivateBrand = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Brand ID");
    const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
    const data = await prisma.$transaction(async (tx) => {
      const before = await tx.brand.findUnique({ where: { id } });
      if (!before) throw new AppError(404, "Brand not found");
      const used = await tx.product.count({ where: { brandId: id, isActive: true } });
      if (used) throw new AppError(409, `Cannot deactivate Brand used by ${used} active product(s)`);
      const updated = await tx.brand.update({ where: { id }, data: { isActive: false } });
      await writeAuditLog({ userId: authOf(req).userId, action: "DEACTIVATE", entity: "Brand", entityId: id, beforeData: before, afterData: updated, ...auditContext }, tx as never);
      return updated;
    });
    await notifyByPermission({ permission: "brands.read", type: "BRAND_DEACTIVATED", title: "Brand deactivated", message: `${data.name} was deactivated.`, entity: "Brand", entityId: data.id });

    res.status(200).json({
      success: true,
      message: "Brand deactivated successfully",
      data,
    });
  }
);
