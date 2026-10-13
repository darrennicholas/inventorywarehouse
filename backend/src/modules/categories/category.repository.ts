
import { prisma } from "../../lib/prisma.ts";

import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from "./category.validation.ts";

export const categoryRepository = {
  findAll() {
    return prisma.category.findMany({
      orderBy: { name: "asc" },
    });
  },

  findById(id: string) {
    return prisma.category.findUnique({
      where: { id },
    });
  },

  findByName(name: string) {
    return prisma.category.findUnique({
      where: { name },
    });
  },

  create(data: CreateCategoryInput) {
    return prisma.category.create({
      data,
    });
  },

  update(id: string, data: UpdateCategoryInput) {
    return prisma.category.update({
      where: { id },
      data,
    });
  },

  deactivate(id: string) {
    return prisma.category.update({
      where: { id },
      data: { isActive: false },
    });
  },
};
