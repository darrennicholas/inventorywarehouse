
import { prisma } from "../../lib/prisma.ts";

import type {
  CreateUnitInput,
  UpdateUnitInput,
} from "./unit.validation.ts";

export const unitRepository = {
  findAll(options?: { skip?: number; take?: number; search?: string; isActive?: boolean }) {
    return prisma.unit.findMany({
      ...(options?.skip !== undefined ? { skip: options.skip, take: options.take } : {}),
      where: { ...(options?.isActive !== undefined ? { isActive: options.isActive } : {}), ...(options?.search ? { OR: [{ code: { contains: options.search, mode: "insensitive" } }, { name: { contains: options.search, mode: "insensitive" } }] } : {}) },
      orderBy: { code: "asc" },
    });
  },

  count(options?: { search?: string; isActive?: boolean }) {
    return prisma.unit.count({ where: { ...(options?.isActive !== undefined ? { isActive: options.isActive } : {}), ...(options?.search ? { OR: [{ code: { contains: options.search, mode: "insensitive" } }, { name: { contains: options.search, mode: "insensitive" } }] } : {}) } });
  },

  findById(id: string) {
    return prisma.unit.findUnique({
      where: { id },
    });
  },

  findByCode(code: string) {
    return prisma.unit.findUnique({
      where: { code },
    });
  },

  create(data: CreateUnitInput) {
    return prisma.unit.create({ data });
  },

  update(id: string, data: UpdateUnitInput) {
    return prisma.unit.update({
      where: { id },
      data,
    });
  },

  countActiveProducts(id: string) {
    return prisma.product.count({
      where: {
        unitId: id,
        isActive: true,
      },
    });
  },
};
