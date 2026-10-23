import { z } from "zod";

/**
 * StockFlow Return API payload validation.
 * Cross-record validation (source ownership, batch, quantities, etc.)
 * belongs in return.service.ts, inside a database transaction.
 */
const uuid = z.uuid();
const positiveQuantity = z.number().int().positive().max(1_000_000_000);

export const returnConditionSchema = z.enum([
  "GOOD", "DAMAGED", "EXPIRED", "DEFECTIVE",
]);
export const returnDispositionSchema = z.enum([
  "RESTOCK", "QUARANTINE", "SCRAP",
]);
export const returnTypeSchema = z.enum(["PURCHASE", "SALE"]);
export const returnStatusSchema = z.enum([
  "DRAFT", "PENDING", "APPROVED", "POSTED", "CANCELLED",
]);

const itemBase = z.object({
  productId: uuid,
  locationId: uuid,
  batchId: uuid.nullable().optional(),
  quantity: positiveQuantity,
  condition: returnConditionSchema,
  disposition: returnDispositionSchema,
  notes: z.string().trim().max(1000).nullable().optional(),
});

const purchaseItemSchema = itemBase.extend({
  purchaseOrderItemId: uuid,
}).strict();

const saleItemSchema = itemBase.extend({
  saleItemId: uuid,
}).strict();

const header = z.object({
  number: z.string().trim().min(1).max(100),
  warehouseId: uuid,
  reason: z.string().trim().min(3).max(2000),
  notes: z.string().trim().max(2000).nullable().optional(),
});

/** Type and source ID are derived by the /purchase and /sales route. */
export const createPurchaseReturnSchema = header.extend({
  purchaseOrderId: uuid,
  items: z.array(purchaseItemSchema).min(1).max(200),
}).strict().superRefine((data, ctx) => {
  const seen = new Set<string>();
  for (const [i, item] of data.items.entries()) {
    // A source item may be split across batches/locations.
    const key = `${item.purchaseOrderItemId}:${item.locationId}:${item.batchId ?? "NONE"}`;
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["items", i], message: "Duplicate source item / location / batch allocation" });
    seen.add(key);
  }
});

export const createSalesReturnSchema = header.extend({
  saleId: uuid,
  items: z.array(saleItemSchema).min(1).max(200),
}).strict().superRefine((data, ctx) => {
  const seen = new Set<string>();
  for (const [i, item] of data.items.entries()) {
    const key = `${item.saleItemId}:${item.locationId}:${item.batchId ?? "NONE"}`;
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["items", i], message: "Duplicate source item / location / batch allocation" });
    seen.add(key);
  }
});

/** Only draft returns may be edited. No status updates through PATCH. */
export const updateReturnSchema = z.object({
  reason: z.string().trim().min(3).max(2000).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, {
  message: "At least one field must be provided",
});

export const returnIdParamsSchema = z.object({ id: uuid });
export const returnListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: returnStatusSchema.optional(),
  warehouseId: uuid.optional(),
  search: z.string().trim().max(100).optional(),
}).strict();

export type CreatePurchaseReturnInput = z.infer<typeof createPurchaseReturnSchema>;
export type CreateSalesReturnInput = z.infer<typeof createSalesReturnSchema>;
export type UpdateReturnInput = z.infer<typeof updateReturnSchema>;
export type ReturnListQuery = z.infer<typeof returnListQuerySchema>;
