import { prisma } from "../../lib/prisma.js";
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
    findById(id) {
        return prisma.warehouse.findUnique({
            where: {
                id,
            },
        });
    },
    // ====================================
    // FIND WAREHOUSE BY UNIQUE CODE
    // ====================================
    findByCode(code) {
        return prisma.warehouse.findUnique({
            where: {
                code,
            },
        });
    },
    // ====================================
    // CREATE WAREHOUSE
    // ====================================
    create(data) {
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
    update(id, data) {
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
    countPositiveStockBalances(warehouseId) {
        return prisma.inventoryBalance.count({
            where: {
                warehouseId,
                quantityOnHand: {
                    gt: 0,
                },
            },
        });
    },
    stockCountRows(warehouseId) {
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
