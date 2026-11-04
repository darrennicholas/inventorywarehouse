
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
  findAll(options?: { skip?: number; take?: number; search?: string; isActive?: boolean }) {
    return prisma.staff.findMany({
      ...(options?.skip !== undefined ? { skip: options.skip, take: options.take } : {}),
      where: { ...(options?.isActive !== undefined ? { isActive: options.isActive } : {}), ...(options?.search ? { OR: [{ staffCode: { contains: options.search, mode: "insensitive" } }, { fullName: { contains: options.search, mode: "insensitive" } }, { email: { contains: options.search, mode: "insensitive" } }] } : {}) },
      include: withWarehouse,
      orderBy: {
        createdAt: "desc",
      },
    });
  },

  count(options?: { search?: string; isActive?: boolean }) {
    return prisma.staff.count({ where: { ...(options?.isActive !== undefined ? { isActive: options.isActive } : {}), ...(options?.search ? { OR: [{ staffCode: { contains: options.search, mode: "insensitive" } }, { fullName: { contains: options.search, mode: "insensitive" } }, { email: { contains: options.search, mode: "insensitive" } }] } : {}) } });
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
