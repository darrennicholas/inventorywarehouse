import { prisma } from "../../lib/prisma.js";
export const brandRepository = {
    findAll() {
        return prisma.brand.findMany({
            orderBy: { name: "asc" },
        });
    },
    findById(id) {
        return prisma.brand.findUnique({
            where: { id },
        });
    },
    findByName(name) {
        return prisma.brand.findUnique({
            where: { name },
        });
    },
    create(data) {
        return prisma.brand.create({ data });
    },
    update(id, data) {
        return prisma.brand.update({
            where: { id },
            data,
        });
    },
    countActiveProducts(id) {
        return prisma.product.count({
            where: {
                brandId: id,
                isActive: true,
            },
        });
    },
};
