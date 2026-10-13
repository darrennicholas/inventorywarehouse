import { asyncHandler } from "../../utils/asyncHandler.js";
import { requireUuid } from "../../utils/requireUuid.js";
import { unitService } from "./unit.service.js";
export const getUnits = asyncHandler(async (_req, res) => {
    const data = await unitService.list();
    res.status(200).json({
        success: true,
        data,
    });
});
export const getUnitById = asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, "Unit ID");
    const data = await unitService.detail(id);
    res.status(200).json({
        success: true,
        data,
    });
});
export const createUnit = asyncHandler(async (req, res) => {
    const data = await unitService.create(req.body);
    res.status(201).json({
        success: true,
        message: "Unit created successfully",
        data,
    });
});
export const updateUnit = asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, "Unit ID");
    const data = await unitService.update(id, req.body);
    res.status(200).json({
        success: true,
        message: "Unit updated successfully",
        data,
    });
});
export const deactivateUnit = asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, "Unit ID");
    const data = await unitService.deactivate(id);
    res.status(200).json({
        success: true,
        message: "Unit deactivated successfully",
        data,
    });
});
