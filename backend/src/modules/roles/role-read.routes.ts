import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { roleInclude } from "./role.validation.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";

const router = Router();

// GET /api/roles/permissions
// ==========================================

// Retrieve every permission
// available in StockFlow.

router.get(
  "/permissions",

  asyncHandler(async (_req, res) => {
    const permissions =
      await prisma.permission.findMany({
        orderBy: {
          key: "asc",
        },
      });

    res.status(200).json({
      success: true,
      data: permissions,
    });
  })
);

// ==========================================
// GET /api/roles
// ==========================================

// Retrieve all roles with permissions.

router.get(
  "/",

  asyncHandler(async (_req, res) => {
    const roles = await prisma.role.findMany({
      include: roleInclude,

      orderBy: {
        name: "asc",
      },
    });

    res.status(200).json({
      success: true,
      data: roles,
    });
  })
);

// ==========================================
// GET /api/roles/:id
// ==========================================

router.get(
  "/:id",

  asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);

    const role = await prisma.role.findUnique({
      where: {
        id,
      },

      include: roleInclude,
    });

    if (!role) {
      throw new AppError(
        404,
        "Role not found"
      );
    }

    res.status(200).json({
      success: true,
      data: role,
    });
  })
);

// ==========================================

export default router;
