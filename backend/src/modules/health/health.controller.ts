
import { prisma } from "../../lib/prisma.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";

let acceptingTraffic = true;

export function setReadiness(value: boolean) {
  acceptingTraffic = value;
}

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

export const readinessCheck = asyncHandler(async (_req, res) => {
  if (!acceptingTraffic) {
    res.status(503).json({ success: false, message: "Service is shutting down" });
    return;
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ success: true, message: "Service is ready" });
  } catch {
    res.status(503).json({ success: false, message: "Database is not ready" });
  }
});
