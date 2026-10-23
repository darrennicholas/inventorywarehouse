import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../lib/prisma.ts";
import { requirePermission } from "../../middlewares/auth.middleware.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { AppError } from "../../utils/AppError.ts";

const router = Router();
const policySchema = z.object({
  subject: z.enum(["PURCHASE", "ADJUSTMENT", "RETURN", "STOCK_OPNAME"]),
  minimumAmount: z.coerce.number().min(0).max(999_999_999_999),
  maximumAmount: z.coerce.number().min(0).max(999_999_999_999).nullable().optional(),
  approverRoleId: z.uuid(),
  requiresDifferentCreator: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.maximumAmount !== null && value.maximumAmount !== undefined && value.maximumAmount < value.minimumAmount) {
    ctx.addIssue({ code: "custom", path: ["maximumAmount"], message: "Maximum amount must be greater than or equal to minimum amount" });
  }
});

router.get("/", requirePermission("approval-policies.manage"), asyncHandler(async (_req, res) => {
  const data = await prisma.approvalPolicy.findMany({ include: { approverRole: { select: { id: true, code: true, name: true } } }, orderBy: [{ subject: "asc" }, { minimumAmount: "asc" }] });
  res.json({ success: true, data });
}));

router.post("/", requirePermission("approval-policies.manage"), asyncHandler(async (req, res) => {
  const input = policySchema.parse(req.body);
  if (input.maximumAmount !== null && input.maximumAmount !== undefined) {
    const overlap = await prisma.approvalPolicy.findFirst({ where: { subject: input.subject, isActive: true, minimumAmount: { lte: input.maximumAmount }, OR: [{ maximumAmount: null }, { maximumAmount: { gte: input.minimumAmount } }] } });
    if (overlap) throw new AppError(409, "Approval policy range overlaps an existing active policy");
  }
  const data = await prisma.approvalPolicy.create({ data: input, include: { approverRole: { select: { id: true, code: true, name: true } } } });
  res.status(201).json({ success: true, data });
}));

router.patch("/:id", requirePermission("approval-policies.manage"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const input = policySchema.partial().refine((value) => Object.keys(value).length > 0).parse(req.body);
  const data = await prisma.approvalPolicy.update({ where: { id }, data: input, include: { approverRole: { select: { id: true, code: true, name: true } } } });
  res.json({ success: true, data });
}));

export default router;
