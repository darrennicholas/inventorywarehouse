import { prisma } from "../../lib/prisma.js";
export const customerRepository = {
    findAll() {
        return prisma.customer.findMany({
            orderBy: { createdAt: "desc" },
        });
    },
    findByCode(code) {
        return prisma.customer.findUnique({
            where: { code },
        });
    },
    findById(id) {
        return prisma.customer.findUnique({ where: { id } });
    },
    create(data) {
        return prisma.customer.create({
            data,
        });
    },
    update(id, data) {
        return prisma.customer.update({ where: { id }, data });
    },
    deactivate(id) {
        return prisma.customer.update({ where: { id }, data: { isActive: false } });
    },
    createMany(data) {
        return prisma.customer.createMany({ data, skipDuplicates: true });
    },
};
