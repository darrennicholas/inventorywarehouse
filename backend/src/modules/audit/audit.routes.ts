import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { requirePermission } from "../../middlewares/auth.middleware.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { csvDocument } from "../../utils/csv.ts";
import { AppError } from "../../utils/AppError.ts";
import type { Prisma } from "../../generated/prisma/client.ts";

const router = Router();
const querySchema = z.object({
  entity: z.string().trim().max(80).optional(),
  action: z.string().trim().max(80).optional(),
  search: z.string().trim().max(120).optional(),
  fromDate: z.iso.date().optional(),
  toDate: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function buildFilter(query: z.infer<typeof querySchema>): Prisma.AuditLogWhereInput {
  if (query.fromDate && query.toDate && query.fromDate > query.toDate) throw new AppError(400, "Tanggal awal harus sebelum atau sama dengan tanggal akhir");
  const createdAt: { gte?: Date; lt?: Date } = {};
  if (query.fromDate) createdAt.gte = new Date(`${query.fromDate}T00:00:00.000+07:00`);
  if (query.toDate) { const end = new Date(`${query.toDate}T00:00:00.000+07:00`); end.setUTCDate(end.getUTCDate() + 1); createdAt.lt = end; }
  const search = query.search;
  return {
    ...(query.entity ? { entity: { contains: query.entity, mode: "insensitive" } } : {}),
    ...(query.action ? { action: { contains: query.action, mode: "insensitive" } } : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
    ...(search ? { OR: [{ action: { contains: search, mode: "insensitive" } }, { entity: { contains: search, mode: "insensitive" } }, { entityId: { contains: search, mode: "insensitive" } }, { user: { is: { fullName: { contains: search, mode: "insensitive" } } } }, { user: { is: { email: { contains: search, mode: "insensitive" } } } }] } : {}),
  };
}

router.get("/export.csv", requirePermission("audit.read"), asyncHandler(async (req, res) => {
  const query = querySchema.parse(req.query);
  const data = await prisma.auditLog.findMany({ where: buildFilter(query), include: { user: { select: { fullName: true, email: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const rows = [["Waktu", "Aksi", "Entitas", "ID Entitas", "Pengguna", "Email"], ...data.map((row) => [row.createdAt.toISOString(), row.action, row.entity, row.entityId, row.user?.fullName ?? "System", row.user?.email ?? ""])];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="audit-log.csv"');
  res.send(csvDocument(rows));
}));

router.get("/", requirePermission("audit.read"), asyncHandler(async (req, res) => {
  const query = querySchema.parse(req.query);
  const where = buildFilter(query);
  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, email: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ success: true, data, meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
}));

export default router;
