
import { prisma } from "../../lib/prisma.ts";

import type {
  CreateWarehouseInput,
  UpdateWarehouseInput,
} from "./warehouse.validation.ts";

export const warehouseRepository = {
  // ====================================
  // GET ALL WAREHOUSES
  // ====================================

  findAll() {
    return prisma.warehouse.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });
  },

  // ====================================
  // GET WAREHOUSE BY ID
  // ====================================

  findById(id: string) {
    return prisma.warehouse.findUnique({
      where: {
        id,
      },
    });
  },

  // ====================================
  // FIND WAREHOUSE BY UNIQUE CODE
  // ====================================

  findByCode(code: string) {
    return prisma.warehouse.findUnique({
      where: {
        code,
      },
    });
  },

  // ====================================
  // CREATE WAREHOUSE
  // ====================================

  create(data: CreateWarehouseInput) {
    return prisma.warehouse.create({
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

  update(id: string, data: UpdateWarehouseInput) {
    return prisma.warehouse.update({
      where: {
        id,
      },
      data,
    });
  },

  // ====================================
  // CHECK WAREHOUSE STOCK
  // ====================================

  countPositiveStockBalances(warehouseId: string) {
    return prisma.inventoryBalance.count({
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
