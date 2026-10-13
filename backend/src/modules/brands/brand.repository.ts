
import { prisma } from "../../lib/prisma.ts";

import type {
  CreateBrandInput,
  UpdateBrandInput,
} from "./brand.validation.ts";

export const brandRepository = {
  findAll() {
    return prisma.brand.findMany({
      orderBy: { name: "asc" },
    });
  },

  findById(id: string) {
    return prisma.brand.findUnique({
      where: { id },
    });
  },

  findByName(name: string) {
    return prisma.brand.findUnique({
      where: { name },
    });
  },

  create(data: CreateBrandInput) {
    return prisma.brand.create({ data });
  },

  update(id: string, data: UpdateBrandInput) {
    return prisma.brand.update({
      where: { id },
      data,
    });
  },

  countActiveProducts(id: string) {
    return prisma.product.count({
      where: {
        brandId: id,
        isActive: true,
      },
    });
  },
};
