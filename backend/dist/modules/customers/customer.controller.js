import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/AppError.js";
import { customerService } from "./customer.service.js";
import { z } from "zod";
function customerId(value) {
    const parsed = z.uuid().safeParse(value);
    if (!parsed.success)
        throw new AppError(400, "Invalid customer ID");
    return parsed.data;
}
export const listCustomers = asyncHandler(async (_req, res) => {
    const customers = await customerService.list();
    res.status(200).json({
        success: true,
        message: "Customers retrieved successfully",
        data: customers,
    });
});
export const createCustomer = asyncHandler(async (req, res) => {
    const customer = await customerService.create(req.body);
    res.status(201).json({
        success: true,
        message: "Customer created successfully",
        data: customer,
    });
});
export const getCustomer = asyncHandler(async (req, res) => {
    const customer = await customerService.getById(customerId(req.params.id));
    res.json({ success: true, data: customer });
});
export const updateCustomer = asyncHandler(async (req, res) => {
    const customer = await customerService.update(customerId(req.params.id), req.body);
    res.json({ success: true, message: "Customer updated successfully", data: customer });
});
export const deleteCustomer = asyncHandler(async (req, res) => {
    const customer = await customerService.deactivate(customerId(req.params.id));
    res.json({ success: true, message: "Customer deactivated successfully", data: customer });
});
export const importCustomers = asyncHandler(async (req, res) => {
    const result = await customerService.importRows(req.body);
    res.status(201).json({ success: true, message: `${result.imported} customers imported`, data: result });
});
