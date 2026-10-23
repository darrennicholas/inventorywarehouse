
import { AppError } from "../../utils/AppError.ts";

import { warehouseRepository } from "./warehouse.repository.ts";

import type {
  CreateWarehouseInput,
  UpdateWarehouseInput,
} from "./warehouse.validation.ts";

// ======================================
// CHECK UNIQUE WAREHOUSE CODE
// ======================================

async function ensureUniqueCode(
  code: string,
  exceptId?: string
) {
  const existing = await warehouseRepository.findByCode(code);

  if (existing && existing.id !== exceptId) {
    throw new AppError(
      409,
      "Warehouse code already exists"
    );
  }
}

// ======================================
// CHECK IF WAREHOUSE HAS STOCK
// ======================================

async function ensureWarehouseCanDeactivate(
  id: string
) {
  const stockBalances =
    await warehouseRepository.countPositiveStockBalances(id);

  if (stockBalances > 0) {
    throw new AppError(
      409,
      "Cannot deactivate warehouse because it still contains stock"
    );
  }
}

// ======================================
// WAREHOUSE SERVICE
// ======================================

export const warehouseService = {
  // GET ALL
  list(warehouseIds?: string[]) {
    return warehouseRepository.findAll(warehouseIds);
  },

  // GET DETAIL
  async detail(id: string) {
    const warehouse = await warehouseRepository.findById(id);

    if (!warehouse) {
      throw new AppError(
        404,
        "Warehouse not found"
      );
    }

    return warehouse;
  },

  // CREATE
  async create(data: CreateWarehouseInput) {
    await ensureUniqueCode(data.code);

    return warehouseRepository.create(data);
  },

  // UPDATE
  async update(
    id: string,
    data: UpdateWarehouseInput
  ) {
    const current = await warehouseService.detail(id);

    if (data.code !== undefined) {
      await ensureUniqueCode(data.code, id);
    }

    if (
      current.isActive &&
      data.isActive === false
    ) {
      await ensureWarehouseCanDeactivate(id);
    }

    return warehouseRepository.update(id, data);
  },

  // SOFT DELETE
  async deactivate(id: string) {
    return warehouseService.update(id, {
      isActive: false,
    });
  },

  async stockCountSheet(id: string) {
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
