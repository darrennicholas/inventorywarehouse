
import { AppError } from "../../utils/AppError.ts";

import { warehouseRepository, type WarehouseDbClient } from "./warehouse.repository.ts";

import type {
  CreateWarehouseInput,
  UpdateWarehouseInput,
} from "./warehouse.validation.ts";

// ======================================
// CHECK UNIQUE WAREHOUSE CODE
// ======================================

async function ensureUniqueCode(
  code: string,
  exceptId?: string,
  db?: WarehouseDbClient,
) {
  const existing = await warehouseRepository.findByCode(code, db);

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
  id: string,
  db?: WarehouseDbClient,
) {
  const stockBalances =
    await warehouseRepository.countPositiveStockBalances(id, db);

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
  async detail(id: string, db?: WarehouseDbClient) {
    const warehouse = await warehouseRepository.findById(id, db);

    if (!warehouse) {
      throw new AppError(
        404,
        "Warehouse not found"
      );
    }

    return warehouse;
  },

  // CREATE
  async create(data: CreateWarehouseInput, db?: WarehouseDbClient) {
    await ensureUniqueCode(data.code, undefined, db);

    return warehouseRepository.create(data, db);
  },

  // UPDATE
  async update(
    id: string,
    data: UpdateWarehouseInput,
    db?: WarehouseDbClient,
  ) {
    const current = await warehouseService.detail(id, db);

    if (data.code !== undefined) {
      await ensureUniqueCode(data.code, id, db);
    }

    if (
      current.isActive &&
      data.isActive === false
    ) {
      await ensureWarehouseCanDeactivate(id, db);
    }

    return warehouseRepository.update(id, data, db);
  },

  // SOFT DELETE
  async deactivate(id: string, db?: WarehouseDbClient) {
    return warehouseService.update(id, {
      isActive: false,
    }, db);
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
