
import { z } from "zod";

import { asyncHandler } from "../../utils/asyncHandler.ts";
import { AppError } from "../../utils/AppError.ts";
import { categoryService } from "./category.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { masterListOptions, pageMeta, paginateArray } from "../../utils/pagination.ts";
import { prisma } from "../../lib/prisma.ts";
import { authOf } from "../../middlewares/auth.middleware.ts";
import { requestAuditContext, writeAuditLog } from "../audit/audit.service.ts";

import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from "./category.validation.ts";

function getCategoryId(id: unknown): string {
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) {
    throw new AppError(400, "Invalid category ID");
  }

  return id;
}

export const getCategories = asyncHandler(
  async (req, res) => {
    const options = masterListOptions(req.query as Record<string, unknown>);
    if (options) {
      const where = { ...(options.isActive !== undefined ? { isActive: options.isActive } : {}), ...(options.search ? { OR: [{ name: { contains: options.search, mode: "insensitive" as const } }, { description: { contains: options.search, mode: "insensitive" as const } }] } : {}) };
      const [data, total] = await Promise.all([prisma.category.findMany({ where, skip: options.skip, take: options.take, orderBy: [{ name: "asc" }, { id: "asc" }] }), prisma.category.count({ where })]);
      res.status(200).json({ success: true, data, meta: pageMeta(options.page, options.pageSize, total) }); return;
    }
    const categories = await categoryService.getAll();
    const result = paginateArray(categories, req.query as Record<string, unknown>);

    res.status(200).json({
      success: true,
      message: "Categories retrieved successfully",
      ...result,
    });
  }
);

export const getCategoryById = asyncHandler(
  async (req, res) => {
    const id = getCategoryId(req.params.id);

    const category = await categoryService.getById(id);

    res.status(200).json({
      success: true,
      data: category,
    });
  }
);

export const createCategory = asyncHandler(
  async (req, res) => {
    const data = req.body as CreateCategoryInput;

    const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.category.create({ data });
      await writeAuditLog({ userId: authOf(req).userId, action: "CREATE", entity: "Category", entityId: created.id, afterData: created, ...auditContext }, tx as never);
      return created;
    });
    await notifyByPermission({ permission: "categories.read", type: "CATEGORY_CREATED", title: "Category created", message: `${category.name} was added to product master data.`, entity: "Category", entityId: category.id });

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: category,
    });
  }
);

export const updateCategory = asyncHandler(
  async (req, res) => {
    const id = getCategoryId(req.params.id);
    const data = req.body as UpdateCategoryInput;

    const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
    const category = await prisma.$transaction(async (tx) => {
      const before = await tx.category.findUnique({ where: { id } });
      if (!before) throw new AppError(404, "Category not found");
      const updated = await tx.category.update({ where: { id }, data });
      await writeAuditLog({ userId: authOf(req).userId, action: "UPDATE", entity: "Category", entityId: id, beforeData: before, afterData: updated, ...auditContext }, tx as never);
      return updated;
    });
    await notifyByPermission({ permission: "categories.read", type: "CATEGORY_UPDATED", title: "Category updated", message: `${category.name} was updated.`, entity: "Category", entityId: category.id });

    res.status(200).json({
      success: true,
      message: "Category updated successfully",
      data: category,
    });
  }
);

export const deleteCategory = asyncHandler(async (req, res) => {
  const id = getCategoryId(req.params.id);
  const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
  const category = await prisma.$transaction(async (tx) => {
    const before = await tx.category.findUnique({ where: { id } });
    if (!before) throw new AppError(404, "Category not found");
    const updated = await tx.category.update({ where: { id }, data: { isActive: false } });
    await writeAuditLog({ userId: authOf(req).userId, action: "DEACTIVATE", entity: "Category", entityId: id, beforeData: before, afterData: updated, ...auditContext }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "categories.read", type: "CATEGORY_DEACTIVATED", title: "Category deactivated", message: `${category.name} was deactivated.`, entity: "Category", entityId: category.id });

  res.status(200).json({
    success: true,
    message: "Category deactivated successfully",
    data: category,
  });
});
