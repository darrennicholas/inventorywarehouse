import { AppError } from "../../utils/AppError.js";
import { warehouseRepository } from "./warehouse.repository.js";
// ======================================
// CHECK UNIQUE WAREHOUSE CODE
// ======================================
async function ensureUniqueCode(code, exceptId) {
    const existing = await warehouseRepository.findByCode(code);
    if (existing && existing.id !== exceptId) {
        throw new AppError(409, "Warehouse code already exists");
    }
}
// ======================================
// CHECK IF WAREHOUSE HAS STOCK
// ======================================
async function ensureWarehouseCanDeactivate(id) {
    const stockBalances = await warehouseRepository.countPositiveStockBalances(id);
    if (stockBalances > 0) {
        throw new AppError(409, "Cannot deactivate warehouse because it still contains stock");
    }
}
// ======================================
// WAREHOUSE SERVICE
// ======================================
export const warehouseService = {
    // GET ALL
    list() {
        return warehouseRepository.findAll();
    },
    // GET DETAIL
    async detail(id) {
        const warehouse = await warehouseRepository.findById(id);
        if (!warehouse) {
            throw new AppError(404, "Warehouse not found");
        }
        return warehouse;
    },
    // CREATE
    async create(data) {
        await ensureUniqueCode(data.code);
        return warehouseRepository.create(data);
    },
    // UPDATE
    async update(id, data) {
        const current = await warehouseService.detail(id);
        if (data.code !== undefined) {
            await ensureUniqueCode(data.code, id);
        }
        if (current.isActive &&
            data.isActive === false) {
            await ensureWarehouseCanDeactivate(id);
        }
        return warehouseRepository.update(id, data);
    },
    // SOFT DELETE
    async deactivate(id) {
        return warehouseService.update(id, {
            isActive: false,
        });
    },
    async stockCountSheet(id) {
        const warehouse = await warehouseService.detail(id);
        const balances = await warehouseRepository.stockCountRows(id);
        return {
            warehouse,
            rows: balances.map((balance) => ({
                sku: balance.product.sku,
                name: balance.product.name,
                systemQuantity: balance.quantityOnHand,
                unit: balance.product.unit?.code ?? "UNIT",
            })),
        };
    },
};
