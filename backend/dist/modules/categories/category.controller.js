import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/AppError.js";
import { categoryService } from "./category.service.js";
function getCategoryId(id) {
    if (typeof id !== "string" || !z.uuid().safeParse(id).success) {
        throw new AppError(400, "Invalid category ID");
    }
    return id;
}
export const getCategories = asyncHandler(async (_req, res) => {
    const categories = await categoryService.getAll();
    res.status(200).json({
        success: true,
        message: "Categories retrieved successfully",
        data: categories,
    });
});
export const getCategoryById = asyncHandler(async (req, res) => {
    const id = getCategoryId(req.params.id);
    const category = await categoryService.getById(id);
    res.status(200).json({
        success: true,
        data: category,
    });
});
export const createCategory = asyncHandler(async (req, res) => {
    const data = req.body;
    const category = await categoryService.create(data);
    res.status(201).json({
        success: true,
        message: "Category created successfully",
        data: category,
    });
});
export const updateCategory = asyncHandler(async (req, res) => {
    const id = getCategoryId(req.params.id);
    const data = req.body;
    const category = await categoryService.update(id, data);
    res.status(200).json({
        success: true,
        message: "Category updated successfully",
        data: category,
    });
});
export const deleteCategory = asyncHandler(async (req, res) => {
    const id = getCategoryId(req.params.id);
    const category = await categoryService.deactivate(id);
    res.status(200).json({
        success: true,
        message: "Category deactivated successfully",
        data: category,
    });
});
