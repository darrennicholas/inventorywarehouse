
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { AppError } from "../../utils/AppError.ts";
import { requireUuid } from "../../utils/requireUuid.ts";
import { prisma } from "../../lib/prisma.ts";
import { authOf } from "../../middlewares/auth.middleware.ts";
import { requestAuditContext, writeAuditLog } from "../audit/audit.service.ts";

import { unitService } from "./unit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { masterListOptions, pageMeta, paginateArray } from "../../utils/pagination.ts";

import type {
  CreateUnitInput,
  UpdateUnitInput,
} from "./unit.validation.ts";

export const getUnits = asyncHandler(
  async (req, res) => {
    const options = masterListOptions(req.query as Record<string, unknown>);
    if (options) {
      const [data, total] = await Promise.all([unitService.list(options), unitService.count(options)]);
      res.status(200).json({ success: true, data, meta: pageMeta(options.page, options.pageSize, total) });
      return;
    }
    const data = await unitService.list();
    const result = paginateArray(data, req.query as Record<string, unknown>);

    res.status(200).json({
      success: true,
      ...result,
    });
  }
);

export const getUnitById = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Unit ID");
    const data = await unitService.detail(id);

    res.status(200).json({
      success: true,
      data,
    });
  }
);

export const createUnit = asyncHandler(
  async (req, res) => {
    const input = req.body as CreateUnitInput;
    const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
    const data = await prisma.$transaction(async (tx) => {
      const created = await tx.unit.create({ data: input });
      await writeAuditLog({ userId: authOf(req).userId, action: "CREATE", entity: "Unit", entityId: created.id, afterData: created, ...auditContext }, tx as never);
      return created;
    });
    await notifyByPermission({ permission: "units.read", type: "UNIT_CREATED", title: "Unit created", message: `${data.code} was added to product master data.`, entity: "Unit", entityId: data.id });

    res.status(201).json({
      success: true,
      message: "Unit created successfully",
      data,
    });
  }
);

export const updateUnit = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Unit ID");

    const input = req.body as UpdateUnitInput;
    const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
    const data = await prisma.$transaction(async (tx) => {
      const before = await tx.unit.findUnique({ where: { id } });
      if (!before) throw new AppError(404, "Unit not found");
      if (before.isActive && input.isActive === false && await tx.product.count({ where: { unitId: id, isActive: true } })) throw new AppError(409, "Cannot deactivate Unit while active products use it");
      const updated = await tx.unit.update({ where: { id }, data: input });
      await writeAuditLog({ userId: authOf(req).userId, action: "UPDATE", entity: "Unit", entityId: id, beforeData: before, afterData: updated, ...auditContext }, tx as never);
      return updated;
    });
    await notifyByPermission({ permission: "units.read", type: "UNIT_UPDATED", title: "Unit updated", message: `${data.code} was updated.`, entity: "Unit", entityId: data.id });

    res.status(200).json({
      success: true,
      message: "Unit updated successfully",
      data,
    });
  }
);

export const deactivateUnit = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Unit ID");
    const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
    const data = await prisma.$transaction(async (tx) => {
      const before = await tx.unit.findUnique({ where: { id } });
      if (!before) throw new AppError(404, "Unit not found");
      const used = await tx.product.count({ where: { unitId: id, isActive: true } });
      if (used) throw new AppError(409, `Cannot deactivate Unit used by ${used} active product(s)`);
      const updated = await tx.unit.update({ where: { id }, data: { isActive: false } });
      await writeAuditLog({ userId: authOf(req).userId, action: "DEACTIVATE", entity: "Unit", entityId: id, beforeData: before, afterData: updated, ...auditContext }, tx as never);
      return updated;
    });
    await notifyByPermission({ permission: "units.read", type: "UNIT_DEACTIVATED", title: "Unit deactivated", message: `${data.code} was deactivated.`, entity: "Unit", entityId: data.id });

    res.status(200).json({
      success: true,
      message: "Unit deactivated successfully",
      data,
    });
  }
);
