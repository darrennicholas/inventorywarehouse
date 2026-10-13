import { prisma } from "../../lib/prisma.js";
export const categoryRepository = {
    findAll() {
        return prisma.category.findMany({
            orderBy: { name: "asc" },
        });
    },
    findById(id) {
        return prisma.category.findUnique({
            where: { id },
        });
    },
    findByName(name) {
        return prisma.category.findUnique({
            where: { name },
        });
    },
    create(data) {
        return prisma.category.create({
            data,
        });
    },
    update(id, data) {
        return prisma.category.update({
            where: { id },
            data,
        });
    },
    deactivate(id) {
        return prisma.category.update({
            where: { id },
            data: { isActive: false },
        });
    },
};
