import { prisma } from "../../lib/prisma.js";
export const unitRepository = {
    findAll() {
        return prisma.unit.findMany({
            orderBy: { code: "asc" },
        });
    },
    findById(id) {
        return prisma.unit.findUnique({
            where: { id },
        });
    },
    findByCode(code) {
        return prisma.unit.findUnique({
            where: { code },
        });
    },
    create(data) {
        return prisma.unit.create({ data });
    },
    update(id, data) {
        return prisma.unit.update({
            where: { id },
            data,
        });
    },
    countActiveProducts(id) {
        return prisma.product.count({
            where: {
                unitId: id,
                isActive: true,
            },
        });
    },
};
