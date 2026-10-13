import { prisma } from "../../lib/prisma.js";
// ======================================
// INCLUDE WAREHOUSE RELATION
// ======================================
const withWarehouse = {
    warehouse: {
        select: {
            id: true,
            code: true,
            name: true,
            isActive: true,
        },
    },
};
// ======================================
// STAFF REPOSITORY
// ======================================
export const staffRepository = {
    // GET ALL STAFF
    findAll() {
        return prisma.staff.findMany({
            include: withWarehouse,
            orderBy: {
                createdAt: "desc",
            },
        });
    },
    // GET STAFF BY ID
    findById(id) {
        return prisma.staff.findUnique({
            where: { id },
            include: withWarehouse,
        });
    },
    // FIND STAFF CODE
    findByCode(staffCode) {
        return prisma.staff.findUnique({
            where: { staffCode },
        });
    },
    // FIND STAFF EMAIL
    findByEmail(email) {
        return prisma.staff.findUnique({
            where: { email },
        });
    },
    // FIND WAREHOUSE
    findWarehouse(id) {
        return prisma.warehouse.findUnique({
            where: { id },
            select: {
                id: true,
                code: true,
                name: true,
                isActive: true,
            },
        });
    },
    // CREATE STAFF
    create(data) {
        return prisma.staff.create({
            data: {
                staffCode: data.staffCode,
                fullName: data.fullName,
                email: data.email ?? null,
                phone: data.phone ?? null,
                position: data.position ?? null,
                warehouseId: data.warehouseId ?? null,
                isActive: data.isActive ?? true,
            },
            include: withWarehouse,
        });
    },
    // UPDATE STAFF
    update(id, data) {
        return prisma.staff.update({
            where: { id },
            data,
            include: withWarehouse,
        });
    },
};
