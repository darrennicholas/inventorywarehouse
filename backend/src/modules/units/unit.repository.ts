
import { prisma } from "../../lib/prisma.ts";

import type {
  CreateUnitInput,
  UpdateUnitInput,
} from "./unit.validation.ts";

export const unitRepository = {
  findAll() {
    return prisma.unit.findMany({
      orderBy: { code: "asc" },
    });
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
