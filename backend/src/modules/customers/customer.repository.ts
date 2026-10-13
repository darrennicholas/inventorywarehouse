import { prisma } from "../../lib/prisma.ts";

import type { CreateCustomerInput, UpdateCustomerInput } from "./customer.validation.ts";

export const customerRepository = {
  findAll() {
    return prisma.customer.findMany({
      orderBy: { createdAt: "desc" },
    });
  },

  findByCode(code: string) {
    return prisma.customer.findUnique({
      where: { code },
    });
  },

  findById(id: string) {
    return prisma.customer.findUnique({ where: { id } });
  },

  create(data: CreateCustomerInput) {
    return prisma.customer.create({
      data,
    });
  },

  update(id: string, data: UpdateCustomerInput) {
    return prisma.customer.update({ where: { id }, data });
  },

  deactivate(id: string) {
    return prisma.customer.update({ where: { id }, data: { isActive: false } });
  },

  createMany(data: CreateCustomerInput[]) {
    return prisma.customer.createMany({ data, skipDuplicates: true });
  },
};
