import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { userSelect } from "./user.validation.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { roleNeedsWarehouseAssignment } from "./user.service.ts";

const router = Router();

// GET /api/users/options
// ==========================================

// Return options for User form:
// - Active roles
// - Active staff

router.get(
  "/options",

  asyncHandler(async (_req, res) => {
    const [roles, staff] = await Promise.all([
      prisma.role.findMany({
        where: {
          isActive: true,
        },

        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },

        orderBy: {
          name: "asc",
        },
      }),

      prisma.staff.findMany({
        where: {
          isActive: true,
        },

        select: {
          id: true,
          staffCode: true,
          fullName: true,
          warehouse: { select: { id: true, name: true, isActive: true } },
        },

        orderBy: {
          fullName: "asc",
        },
      }),
    ]);

    res.status(200).json({
      success: true,

      data: {
        roles: roles.map(({ permissions, ...role }) => ({ ...role, requiresWarehouseAssignment: roleNeedsWarehouseAssignment(permissions.map((entry) => entry.permission.key)) })),
        staff,
      },
    });
  })
);

// ==========================================
// GET /api/users
// ==========================================

// Retrieve all registered accounts.

router.get(
  "/",

  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: userSelect,

      orderBy: {
        createdAt: "desc",
      },
    });

    res.status(200).json({
      success: true,
      data: users,
    });
  })
);

// ==========================================
// GET /api/users/:id
// ==========================================

router.get(
  "/:id",

  asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);

    const user = await prisma.user.findUnique({
      where: {
        id,
      },

      select: userSelect,
    });

    if (!user) {
      throw new AppError(
        404,
        "User not found"
      );
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  })
);

// ==========================================

export default router;
