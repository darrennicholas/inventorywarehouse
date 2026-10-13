import { prisma } from "../../lib/prisma.js";
export const supplierRepository = {
    findAll() {
        return prisma.supplier.findMany({
            orderBy: { createdAt: "desc" },
        });
    },
    findById(id) {
        return prisma.supplier.findUnique({
            where: { id },
        });
    },
    findByCode(code) {
        return prisma.supplier.findUnique({
            where: { code },
        });
    },
    create(data) {
        return prisma.supplier.create({
            data: {
                code: data.code,
                name: data.name,
                email: data.email ?? null,
                phone: data.phone ?? null,
                address: data.address ?? null,
                isActive: data.isActive ?? true,
            },
        });
    },
    update(id, data) {
        return prisma.supplier.update({
            where: { id },
            data,
        });
    },
};
