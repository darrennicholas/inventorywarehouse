
import { z } from "zod";

import { asyncHandler } from "../../utils/asyncHandler.ts";
import { AppError } from "../../utils/AppError.ts";
import { categoryService } from "./category.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { paginateArray } from "../../utils/pagination.ts";

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

    const category = await categoryService.create(data);
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

    const category = await categoryService.update(id, data);
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
  const category = await categoryService.deactivate(id);
  await notifyByPermission({ permission: "categories.read", type: "CATEGORY_DEACTIVATED", title: "Category deactivated", message: `${category.name} was deactivated.`, entity: "Category", entityId: category.id });

  res.status(200).json({
    success: true,
    message: "Category deactivated successfully",
    data: category,
  });
});
