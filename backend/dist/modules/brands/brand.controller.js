import { asyncHandler } from "../../utils/asyncHandler.js";
import { requireUuid } from "../../utils/requireUuid.js";
import { brandService } from "./brand.service.js";
export const getBrands = asyncHandler(async (_req, res) => {
    const data = await brandService.list();
    res.status(200).json({
        success: true,
        data,
    });
});
export const getBrandById = asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, "Brand ID");
    const data = await brandService.detail(id);
    res.status(200).json({
        success: true,
        data,
    });
});
export const createBrand = asyncHandler(async (req, res) => {
    const data = await brandService.create(req.body);
    res.status(201).json({
        success: true,
        message: "Brand created successfully",
        data,
    });
});
export const updateBrand = asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, "Brand ID");
    const data = await brandService.update(id, req.body);
    res.status(200).json({
        success: true,
        message: "Brand updated successfully",
        data,
    });
});
export const deactivateBrand = asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, "Brand ID");
    const data = await brandService.deactivate(id);
    res.status(200).json({
        success: true,
        message: "Brand deactivated successfully",
        data,
    });
});
