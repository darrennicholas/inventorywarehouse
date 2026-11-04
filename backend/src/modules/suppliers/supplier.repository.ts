
import { prisma } from "../../lib/prisma.ts";

import type {
  CreateSupplierInput,
  UpdateSupplierInput,
} from "./supplier.validation.ts";

export const supplierRepository = {
  findAll(options?: { skip?: number; take?: number; search?: string; isActive?: boolean }) {
    return prisma.supplier.findMany({
      ...(options?.skip !== undefined ? { skip: options.skip, take: options.take } : {}),
      where: { ...(options?.isActive !== undefined ? { isActive: options.isActive } : {}), ...(options?.search ? { OR: [{ code: { contains: options.search, mode: "insensitive" } }, { name: { contains: options.search, mode: "insensitive" } }, { email: { contains: options.search, mode: "insensitive" } }, { phone: { contains: options.search } }] } : {}) },
      orderBy: { createdAt: "desc" },
    });
  },

  count(options?: { search?: string; isActive?: boolean }) {
    return prisma.supplier.count({ where: { ...(options?.isActive !== undefined ? { isActive: options.isActive } : {}), ...(options?.search ? { OR: [{ code: { contains: options.search, mode: "insensitive" } }, { name: { contains: options.search, mode: "insensitive" } }, { email: { contains: options.search, mode: "insensitive" } }, { phone: { contains: options.search } }] } : {}) } });
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
