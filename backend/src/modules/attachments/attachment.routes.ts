import { Router } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { authOf } from "../../middlewares/auth.middleware.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { AppError } from "../../utils/AppError.ts";
import { pageMeta, pagination } from "../../utils/pagination.ts";

const router = Router();
const uploadRoot = path.resolve(process.env.ATTACHMENT_STORAGE_PATH || path.join(process.cwd(), "storage", "attachments"));
const maxAttachmentBytes = Math.min(Math.max(Number(process.env.ATTACHMENT_MAX_BYTES || 10 * 1024 * 1024), 1024), 25 * 1024 * 1024);
const attachmentEntity = z.enum(["PurchaseOrder", "ReturnOrder", "StockAdjustment", "Payment", "StockTakeSession", "Expense"]);
const attachmentSchema = z.object({
  entity: attachmentEntity,
  entityId: z.string().trim().min(1).max(100),
  originalName: z.string().trim().min(1).max(180),
  mimeType: z.enum(["application/pdf", "text/csv", "image/png", "image/jpeg", "image/webp"]),
  contentBase64: z.string().min(1).max(Math.ceil(maxAttachmentBytes * 4 / 3) + 16),
}).strict();

type AttachmentEntity = z.infer<typeof attachmentEntity>;
async function assertAttachmentPermission(entity: AttachmentEntity, entityId: string, action: "read" | "write", req: Parameters<typeof authOf>[0]) {
  const auth = authOf(req);
  const keys: Record<Exclude<AttachmentEntity, "ReturnOrder">, string> = {
    PurchaseOrder: `purchases.${action}`,
    StockAdjustment: `adjustments.${action}`,
    Payment: `payments.${action}`,
    StockTakeSession: `stock-opnames.${action}`,
    Expense: `expenses.${action}`,
  };
  if (entity === "ReturnOrder") {
    const doc = await prisma.returnOrder.findUnique({ where: { id: entityId }, select: { type: true } });
    if (!doc) throw new AppError(404, "Return record not found");
    const key = `${doc.type === "PURCHASE" ? "purchase-returns" : "sales-returns"}.${action}`;
    if (!auth.permissions.includes(key)) throw new AppError(403, "You do not have permission to access attachments for this record");
    return;
  }
  const key = keys[entity];
  if (!auth.permissions.includes(key)) throw new AppError(403, "You do not have permission to access attachments for this record");
}

const extensionByMime: Record<z.infer<typeof attachmentSchema>["mimeType"], string> = {
  "application/pdf": ".pdf", "text/csv": ".csv", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
};

function hasValidSignature(content: Buffer, mimeType: keyof typeof extensionByMime) {
  if (mimeType === "application/pdf") return content.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/png") return content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  if (mimeType === "image/webp") return content.length >= 12 && content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP";
  return !content.includes(0) && new TextDecoder("utf-8", { fatal: true }).decode(content).length > 0;
}

function storedPath(storageKey: string) {
  if (!/^[0-9a-f-]{36}\.(pdf|csv|png|jpg|webp)$/.test(storageKey)) throw new AppError(500, "Invalid attachment storage key");
  const resolved = path.resolve(uploadRoot, storageKey);
  if (!resolved.startsWith(`${uploadRoot}${path.sep}`)) throw new AppError(500, "Invalid attachment path");
  return resolved;
}

router.get("/", asyncHandler(async (req, res) => {
  const entity = typeof req.query.entity === "string" ? attachmentEntity.parse(req.query.entity) : undefined;
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : undefined;
  if (!entity || !entityId) throw new AppError(400, "entity and entityId are required");
  await assertAttachmentPermission(entity, entityId, "read", req);
  const { page, pageSize, skip, take } = pagination(req.query as Record<string, unknown>);
  const where = { entity, entityId };
  const [data, total] = await Promise.all([
    prisma.attachment.findMany({ where, include: { uploadedBy: { select: { id: true, fullName: true } } }, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.attachment.count({ where }),
  ]);
  res.json({ success: true, data, meta: pageMeta(page, pageSize, total) });
}));

router.post("/", asyncHandler(async (req, res) => {
  const input = attachmentSchema.parse(req.body);
  await assertAttachmentPermission(input.entity, input.entityId, "write", req);
  const content = Buffer.from(input.contentBase64, "base64");
  if (!content.length || content.length > maxAttachmentBytes) throw new AppError(413, `Attachment cannot exceed ${Math.floor(maxAttachmentBytes / 1024 / 1024)} MB`);
  if (!hasValidSignature(content, input.mimeType)) throw new AppError(415, "File content does not match the declared MIME type");
  await fs.mkdir(uploadRoot, { recursive: true });
  const storageKey = `${randomUUID()}${extensionByMime[input.mimeType]}`;
  await fs.writeFile(storedPath(storageKey), content, { flag: "wx", mode: 0o600 });
  try {
    const data = await prisma.attachment.create({ data: { entity: input.entity, entityId: input.entityId, originalName: input.originalName, storageKey, mimeType: input.mimeType, sizeBytes: content.length, uploadedById: authOf(req).userId } });
    res.status(201).json({ success: true, message: "Attachment uploaded", data });
  } catch (error) {
    await fs.rm(storedPath(storageKey), { force: true });
    throw error;
  }
}));

router.get("/:id/download", asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) throw new AppError(404, "Attachment not found");
  await assertAttachmentPermission(attachmentEntity.parse(attachment.entity), attachment.entityId, "read", req);
  const filePath = storedPath(attachment.storageKey);
  try { await fs.access(filePath); } catch { throw new AppError(404, "Attachment file is missing from storage"); }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.type(attachment.mimeType).download(filePath, attachment.originalName);
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) throw new AppError(404, "Attachment not found");
  await assertAttachmentPermission(attachmentEntity.parse(attachment.entity), attachment.entityId, "write", req);
  await prisma.attachment.delete({ where: { id } });
  await fs.rm(storedPath(attachment.storageKey), { force: true });
  res.json({ success: true, message: "Attachment deleted" });
}));

export default router;

