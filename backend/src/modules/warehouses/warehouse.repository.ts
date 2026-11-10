
import { prisma } from "../../lib/prisma.ts";
import type { Prisma } from "../../generated/prisma/client.ts";

import type {
  CreateWarehouseInput,
  UpdateWarehouseInput,
} from "./warehouse.validation.ts";

export type WarehouseDbClient = typeof prisma | Prisma.TransactionClient;

export const warehouseRepository = {
  // ====================================
  // GET ALL WAREHOUSES
  // ====================================

  findAll(warehouseIds?: string[]) {
    return prisma.warehouse.findMany({
      where: warehouseIds ? { id: { in: warehouseIds } } : undefined,
      orderBy: {
        createdAt: "desc",
      },
    });
  },

  // ====================================
  // GET WAREHOUSE BY ID
  // ====================================

  findById(id: string, db: WarehouseDbClient = prisma) {
    return db.warehouse.findUnique({
      where: {
        id,
      },
    });
  },

  // ====================================
  // FIND WAREHOUSE BY UNIQUE CODE
  // ====================================

  findByCode(code: string, db: WarehouseDbClient = prisma) {
    return db.warehouse.findUnique({
      where: {
        code,
      },
    });
  },

  // ====================================
  // CREATE WAREHOUSE
  // ====================================

  create(data: CreateWarehouseInput, db: WarehouseDbClient = prisma) {
    return db.warehouse.create({
      data: {
        code: data.code,
        name: data.name,
        address: data.address ?? null,
        isActive: data.isActive ?? true,
      },
    });
  },

  // ====================================
  // UPDATE WAREHOUSE
  // ====================================

  update(id: string, data: UpdateWarehouseInput, db: WarehouseDbClient = prisma) {
    return db.warehouse.update({
      where: {
        id,
      },
      data,
    });
  },

  // ====================================
  // CHECK WAREHOUSE STOCK
  // ====================================

  countPositiveStockBalances(warehouseId: string, db: WarehouseDbClient = prisma) {
    return db.inventoryBalance.count({
      where: {
        warehouseId,
        quantityOnHand: {
          gt: 0,
        },
      },
    });
  },

  stockCountRows(warehouseId: string) {
    return prisma.inventoryBalance.findMany({
      where: { warehouseId },
      include: {
        product: {
          select: {
            sku: true,
            name: true,
            unit: { select: { code: true } },
          },
        },
      },
      orderBy: { product: { name: "asc" } },
    });
  },
};
