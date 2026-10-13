
import { prisma } from "../../lib/prisma.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";

export const healthCheck = asyncHandler(
  async (_req, res) => {
    res.status(200).json({
      success: true,
      message: "Inventory Warehouse API is running",
    });
  }
);

export const databaseCheck = asyncHandler(
  async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      success: true,
      message: "PostgreSQL connected successfully",
    });
  }
);
