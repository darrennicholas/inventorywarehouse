import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { requirePermission } from "../../middlewares/auth.middleware.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";

const router = Router();
const querySchema = z.object({
  entity: z.string().trim().max(80).optional(),
  action: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

router.get("/", requirePermission("audit.read"), asyncHandler(async (req, res) => {
  const query = querySchema.parse(req.query);
  const where = {
    ...(query.entity ? { entity: query.entity } : {}),
    ...(query.action ? { action: query.action } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ success: true, data, meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
}));

export default router;
