import { AppError } from "../../utils/AppError.js";
import { supplierRepository } from "./supplier.repository.js";
async function ensureUniqueCode(code, exceptId) {
    const existing = await supplierRepository.findByCode(code);
    if (existing && existing.id !== exceptId) {
        throw new AppError(409, "Supplier code already exists");
    }
}
function handleDatabaseError(error) {
    if (error &&
        typeof error === "object" &&
        "code" in error) {
        const code = error.code;
        if (code === "P2002") {
            throw new AppError(409, "Supplier code already exists");
        }
        if (code === "P2025") {
            throw new AppError(404, "Supplier not found");
        }
    }
    throw error;
}
export const supplierService = {
    list() {
        return supplierRepository.findAll();
    },
    async detail(id) {
        const supplier = await supplierRepository.findById(id);
        if (!supplier) {
            throw new AppError(404, "Supplier not found");
        }
        return supplier;
    },
    async create(input) {
        await ensureUniqueCode(input.code);
        try {
            return await supplierRepository.create(input);
        }
        catch (error) {
            return handleDatabaseError(error);
        }
    },
    async update(id, input) {
        await supplierService.detail(id);
        if (input.code !== undefined) {
            await ensureUniqueCode(input.code, id);
        }
        try {
            return await supplierRepository.update(id, input);
        }
        catch (error) {
            return handleDatabaseError(error);
        }
    },
    deactivate(id) {
        return supplierService.update(id, {
            isActive: false,
        });
    },
};
