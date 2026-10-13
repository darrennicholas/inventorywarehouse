
import { prisma } from "../../lib/prisma.ts";

import type {
  CreateStaffInput,
  UpdateStaffInput,
} from "./staff.validation.ts";

// ======================================
// INCLUDE WAREHOUSE RELATION
// ======================================

const withWarehouse = {
  warehouse: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
    },
  },
} as const;

// ======================================
// STAFF REPOSITORY
// ======================================

export const staffRepository = {
  // GET ALL STAFF
  findAll() {
    return prisma.staff.findMany({
      include: withWarehouse,
      orderBy: {
        createdAt: "desc",
      },
    });
  },

  // GET STAFF BY ID
  findById(id: string) {
    return prisma.staff.findUnique({
      where: { id },
      include: withWarehouse,
    });
  },

  // FIND STAFF CODE
  findByCode(staffCode: string) {
    return prisma.staff.findUnique({
      where: { staffCode },
    });
  },

  // FIND STAFF EMAIL
  findByEmail(email: string) {
    return prisma.staff.findUnique({
      where: { email },
    });
  },

  // FIND WAREHOUSE
  findWarehouse(id: string) {
    return prisma.warehouse.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
      },
    });
  },

  // CREATE STAFF
  create(data: CreateStaffInput) {
    return prisma.staff.create({
      data: {
        staffCode: data.staffCode,
        fullName: data.fullName,
        email: data.email ?? null,
        phone: data.phone ?? null,
        position: data.position ?? null,
        warehouseId: data.warehouseId ?? null,
        isActive: data.isActive ?? true,
      },
      include: withWarehouse,
    });
  },

  // UPDATE STAFF
  update(id: string, data: UpdateStaffInput) {
    return prisma.staff.update({
      where: { id },
      data,
      include: withWarehouse,
    });
  },
};
