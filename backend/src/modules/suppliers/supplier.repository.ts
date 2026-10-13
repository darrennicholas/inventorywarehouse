
import { prisma } from "../../lib/prisma.ts";

import type {
  CreateSupplierInput,
  UpdateSupplierInput,
} from "./supplier.validation.ts";

export const supplierRepository = {
  findAll() {
    return prisma.supplier.findMany({
      orderBy: { createdAt: "desc" },
    });
  },

  findById(id: string) {
    return prisma.supplier.findUnique({
      where: { id },
    });
  },

  findByCode(code: string) {
    return prisma.supplier.findUnique({
      where: { code },
    });
  },

  create(data: CreateSupplierInput) {
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

  update(id: string, data: UpdateSupplierInput) {
    return prisma.supplier.update({
      where: { id },
      data,
    });
  },
};
