import { asyncHandler } from "../../utils/asyncHandler.js";
import { requireUuid } from "../../utils/requireUuid.js";
import { supplierService } from "./supplier.service.js";
import { createSupplierSchema, updateSupplierSchema, } from "./supplier.validation.js";
export const getSuppliers = asyncHandler(async (_req, res) => {
    const data = await supplierService.list();
    res.status(200).json({
        success: true,
        data,
    });
});
export const getSupplierById = asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, "Supplier ID");
    const data = await supplierService.detail(id);
    res.status(200).json({
        success: true,
        data,
    });
});
export const createSupplier = asyncHandler(async (req, res) => {
    const input = createSupplierSchema.parse(req.body);
    const data = await supplierService.create(input);
    res.status(201).json({
        success: true,
        message: "Supplier created successfully",
        data,
    });
});
export const updateSupplier = asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, "Supplier ID");
    const input = updateSupplierSchema.parse(req.body);
    const data = await supplierService.update(id, input);
    res.status(200).json({
        success: true,
        message: "Supplier updated successfully",
        data,
    });
});
export const deactivateSupplier = asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, "Supplier ID");
    const data = await supplierService.deactivate(id);
    res.status(200).json({
        success: true,
        message: "Supplier deactivated successfully",
        data,
    });
});
