
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { AppError } from "../../utils/AppError.ts";
import { requireUuid } from "../../utils/requireUuid.ts";
import { prisma } from "../../lib/prisma.ts";
import { authOf } from "../../middlewares/auth.middleware.ts";
import { requestAuditContext, writeAuditLog } from "../audit/audit.service.ts";

import { staffService } from "./staff.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { masterListOptions, pageMeta, paginateArray } from "../../utils/pagination.ts";

import type {
  CreateStaffInput,
  UpdateStaffInput,
} from "./staff.validation.ts";

// ======================================
// GET ALL STAFF
// ======================================

export const getStaff = asyncHandler(
  async (req, res) => {
    const options = masterListOptions(req.query as Record<string, unknown>);
    if (options) {
      const [data, total] = await Promise.all([staffService.list(options), staffService.count(options)]);
      res.status(200).json({ success: true, data, meta: pageMeta(options.page, options.pageSize, total) });
      return;
    }
    const data = await staffService.list();
    const result = paginateArray(data, req.query as Record<string, unknown>);

    res.status(200).json({
      success: true,
      ...result,
    });
  }
);

// ======================================
// GET STAFF BY ID
// ======================================

export const getStaffById = asyncHandler(
  async (req, res) => {
    const id = requireUuid(
      req.params.id,
      "Staff ID"
    );

    const data = await staffService.detail(id);

    res.status(200).json({
      success: true,
      data,
    });
  }
);

// ======================================
// CREATE STAFF
// ======================================

export const createStaff = asyncHandler(
  async (req, res) => {
    const input =
      req.body as CreateStaffInput;

    const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
    const data = await prisma.$transaction(async (tx) => {
      const staffCode = input.staffCode.trim().toUpperCase();
      const email = input.email?.trim().toLowerCase() || null;
      if (await tx.staff.findFirst({ where: { OR: [{ staffCode }, ...(email ? [{ email }] : [])] }, select: { id: true } })) throw new AppError(409, "Staff code or email already exists");
      if (input.warehouseId) {
        const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId }, select: { isActive: true } });
        if (!warehouse) throw new AppError(404, "Selected warehouse was not found");
        if (!warehouse.isActive) throw new AppError(409, "Selected warehouse is inactive");
      }
      const created = await tx.staff.create({ data: { staffCode, fullName: input.fullName.trim(), email, phone: input.phone?.trim() || null, position: input.position?.trim() || null, warehouseId: input.warehouseId ?? null, isActive: input.isActive ?? true }, include: { warehouse: { select: { id: true, code: true, name: true, isActive: true } } } });
      await writeAuditLog({ userId: authOf(req).userId, action: "CREATE", entity: "Staff", entityId: created.id, afterData: created, ...auditContext }, tx as never);
      return created;
    });
    await notifyByPermission({ permission: "staff.read", type: "STAFF_CREATED", title: "Staff profile created", message: `${data.fullName} was added to staff records.`, entity: "Staff", entityId: data.id, warehouseId: data.warehouseId ?? undefined });

    res.status(201).json({
      success: true,
      message: "Staff created successfully",
      data,
    });
  }
);

// ======================================
// UPDATE STAFF
// ======================================

export const updateStaff = asyncHandler(
  async (req, res) => {
    const id = requireUuid(
      req.params.id,
      "Staff ID"
    );

    const input =
      req.body as UpdateStaffInput;

    const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
    const data = await prisma.$transaction(async (tx) => {
      const before = await tx.staff.findUnique({ where: { id }, include: { warehouse: { select: { id: true, code: true, name: true, isActive: true } } } });
      if (!before) throw new AppError(404, "Staff not found");
      const normalized = { ...input, ...(input.staffCode !== undefined ? { staffCode: input.staffCode.trim().toUpperCase() } : {}), ...(input.fullName !== undefined ? { fullName: input.fullName.trim() } : {}), ...(input.email !== undefined ? { email: input.email?.trim().toLowerCase() || null } : {}), ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}), ...(input.position !== undefined ? { position: input.position?.trim() || null } : {}) };
      if (normalized.staffCode && await tx.staff.findFirst({ where: { staffCode: normalized.staffCode, id: { not: id } }, select: { id: true } })) throw new AppError(409, "Staff code already exists");
      if (normalized.email && await tx.staff.findFirst({ where: { email: normalized.email, id: { not: id } }, select: { id: true } })) throw new AppError(409, "Email is already used by another staff member");
      const assignedWarehouse = normalized.warehouseId !== undefined ? normalized.warehouseId : before.warehouseId;
      if (assignedWarehouse && (normalized.warehouseId !== undefined && normalized.warehouseId !== before.warehouseId || normalized.isActive === true && !before.isActive)) {
        const warehouse = await tx.warehouse.findUnique({ where: { id: assignedWarehouse }, select: { isActive: true } });
        if (!warehouse) throw new AppError(404, "Selected warehouse was not found");
        if (!warehouse.isActive) throw new AppError(409, "Selected warehouse is inactive");
      }
      const updated = await tx.staff.update({ where: { id }, data: normalized, include: { warehouse: { select: { id: true, code: true, name: true, isActive: true } } } });
      await writeAuditLog({ userId: authOf(req).userId, action: "UPDATE", entity: "Staff", entityId: id, beforeData: before, afterData: updated, ...auditContext }, tx as never);
      return updated;
    });
    await notifyByPermission({ permission: "staff.read", type: "STAFF_UPDATED", title: "Staff profile updated", message: `${data.fullName} was updated.`, entity: "Staff", entityId: data.id, warehouseId: data.warehouseId ?? undefined });

    res.status(200).json({
      success: true,
      message: "Staff updated successfully",
      data,
    });
  }
);

// ======================================
// DEACTIVATE STAFF
// ======================================

export const deactivateStaff = asyncHandler(
  async (req, res) => {
    const id = requireUuid(
      req.params.id,
      "Staff ID"
    );

    const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
    const data = await prisma.$transaction(async (tx) => {
      const before = await tx.staff.findUnique({ where: { id }, include: { warehouse: { select: { id: true, code: true, name: true, isActive: true } } } });
      if (!before) throw new AppError(404, "Staff not found");
      const updated = await tx.staff.update({ where: { id }, data: { isActive: false }, include: { warehouse: { select: { id: true, code: true, name: true, isActive: true } } } });
      await writeAuditLog({ userId: authOf(req).userId, action: "DEACTIVATE", entity: "Staff", entityId: id, beforeData: before, afterData: updated, ...auditContext }, tx as never);
      return updated;
    });
    await notifyByPermission({ permission: "staff.read", type: "STAFF_DEACTIVATED", title: "Staff profile deactivated", message: `${data.fullName} was deactivated.`, entity: "Staff", entityId: data.id, warehouseId: data.warehouseId ?? undefined });

    res.status(200).json({
      success: true,
      message: "Staff deactivated successfully",
      data,
    });
  }
);
