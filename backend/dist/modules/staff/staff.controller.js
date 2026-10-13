import { asyncHandler } from "../../utils/asyncHandler.js";
import { requireUuid } from "../../utils/requireUuid.js";
import { staffService } from "./staff.service.js";
// ======================================
// GET ALL STAFF
// ======================================
export const getStaff = asyncHandler(async (_req, res) => {
    const data = await staffService.list();
    res.status(200).json({
        success: true,
        data,
    });
});
// ======================================
// GET STAFF BY ID
// ======================================
export const getStaffById = asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, "Staff ID");
    const data = await staffService.detail(id);
    res.status(200).json({
        success: true,
        data,
    });
});
// ======================================
// CREATE STAFF
// ======================================
export const createStaff = asyncHandler(async (req, res) => {
    const input = req.body;
    const data = await staffService.create(input);
    res.status(201).json({
        success: true,
        message: "Staff created successfully",
        data,
    });
});
// ======================================
// UPDATE STAFF
// ======================================
export const updateStaff = asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, "Staff ID");
    const input = req.body;
    const data = await staffService.update(id, input);
    res.status(200).json({
        success: true,
        message: "Staff updated successfully",
        data,
    });
});
// ======================================
// DEACTIVATE STAFF
// ======================================
export const deactivateStaff = asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, "Staff ID");
    const data = await staffService.deactivate(id);
    res.status(200).json({
        success: true,
        message: "Staff deactivated successfully",
        data,
    });
});
