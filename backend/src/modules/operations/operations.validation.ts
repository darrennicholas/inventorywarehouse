import { z } from "zod";
import { paginationQuerySchema } from "../../utils/pagination.ts";

const uuid = z.uuid();
const positiveInt = z.coerce.number().int().positive().max(1_000_000);
const money = z.coerce.number().min(0).max(999_999_999_999.99);

const purchaseItem = z.object({
  productId: uuid,
  quantity: positiveInt,
  unitPrice: money,
  batchNumber: z.string().trim().max(80).nullable().optional(),
  productionDate: z.coerce.date().nullable().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
}).strict();

const saleItem = z.object({
  productId: uuid,
  quantity: positiveInt,
  unitPrice: money,
}).strict();

const adjustmentItem = z.object({
  productId: uuid,
  quantity: positiveInt,
  locationId: uuid.nullable().optional(),
  batchId: uuid.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
}).strict();

const transferItem = z.object({
  productId: uuid,
  quantity: positiveInt,
  sourceLocationId: uuid.nullable().optional(),
  destinationLocationId: uuid.nullable().optional(),
  batchId: uuid.nullable().optional(),
}).strict();

export const purchaseSchema = z.object({
  number: z.string().trim().min(2).max(40),
  supplierId: uuid,
  warehouseId: uuid,
  status: z.enum(["DRAFT", "PENDING", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]).optional(),
  expectedDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  tax: money.optional(),
  items: z.array(purchaseItem).min(1).max(100),
}).strict();

export const purchaseReceiveSchema = z.object({
  receiptNumber: z.string().trim().min(2).max(40).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  items: z.array(z.object({
    productId: uuid,
    quantity: z.coerce.number().int().min(0),
    damagedQuantity: z.coerce.number().int().min(0).default(0),
    batchNumber: z.string().trim().max(80).nullable().optional(),
    productionDate: z.coerce.date().nullable().optional(),
    expiryDate: z.coerce.date().nullable().optional(),
    locationId: uuid.nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  }).strict().refine((item) => item.quantity + item.damagedQuantity > 0, "Jumlah barang baik dan rusak harus lebih dari nol.")).min(1).max(100).optional(),
}).strict();

export const saleSchema = z.object({
  number: z.string().trim().min(2).max(40),
  customerId: uuid.nullable().optional(),
  warehouseId: uuid,
  status: z.enum(["DRAFT", "RESERVED"]).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  discount: money.optional(),
  tax: money.optional(),
  items: z.array(saleItem).min(1).max(100),
}).strict().superRefine((input, ctx) => {
  const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  if ((input.discount ?? 0) > subtotal) ctx.addIssue({ code: "custom", path: ["discount"], message: "Discount cannot exceed subtotal" });
  if (new Set(input.items.map((item) => item.productId)).size !== input.items.length) ctx.addIssue({ code: "custom", path: ["items"], message: "Combine duplicate products into one sale line" });
});

export const adjustmentSchema = z.object({
  number: z.string().trim().min(2).max(40),
  warehouseId: uuid,
  type: z.enum(["INCREASE", "DECREASE"]),
  status: z.enum(["DRAFT", "POSTED", "CANCELLED"]).optional(),
  reason: z.string().trim().min(2).max(500),
  items: z.array(adjustmentItem).min(1).max(100),
}).strict();

export const transferSchema = z.object({
  number: z.string().trim().min(2).max(40),
  fromWarehouseId: uuid,
  toWarehouseId: uuid,
  status: z.enum(["DRAFT", "IN_TRANSIT", "COMPLETED", "CANCELLED"]).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  items: z.array(transferItem).min(1).max(100),
}).strict().refine((value) => value.fromWarehouseId !== value.toWarehouseId, {
  message: "Source and destination warehouse must be different",
  path: ["toWarehouseId"],
});

export const expenseSchema = z.object({
  number: z.string().trim().min(2).max(40),
  category: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).nullable().optional(),
  amount: money,
  warehouseId: uuid.nullable().optional(),
  expenseDate: z.coerce.date().optional(),
}).strict();

export const paymentSchema = z.object({
  number: z.string().trim().min(2).max(40),
  type: z.enum(["PURCHASE", "SALE", "EXPENSE"]),
  purchaseOrderId: uuid.nullable().optional(),
  saleId: uuid.nullable().optional(),
  expenseId: uuid.nullable().optional(),
  amount: money,
  method: z.enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD", "E_WALLET", "OTHER"]),
  status: z.enum(["PENDING", "PAID", "VOID"]).optional(),
  paymentDate: z.coerce.date().optional(),
  referenceNo: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
}).strict();

const emptyQueryValue = (schema: z.ZodType) =>
  z.preprocess((value) => value === "" ? undefined : value, schema);

export function transactionListQuerySchema<const T extends readonly [string, ...string[]]>(statuses: T) {
  return paginationQuerySchema.extend({
    status: emptyQueryValue(z.enum(statuses).optional()),
    fromDate: emptyQueryValue(z.iso.date().optional()),
    toDate: emptyQueryValue(z.iso.date().optional()),
  }).superRefine((query, context) => {
    if (query.fromDate && query.toDate && query.fromDate > query.toDate) {
      context.addIssue({ code: "custom", path: ["toDate"], message: "Tanggal akhir harus sama atau setelah tanggal awal." });
    }
  });
}

export const purchaseListQuerySchema = transactionListQuerySchema(["DRAFT", "PENDING", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"] as const);
export const saleListQuerySchema = transactionListQuerySchema(["DRAFT", "RESERVED", "PICKING", "PACKED", "PARTIALLY_SHIPPED", "SHIPPED", "COMPLETED", "CANCELLED"] as const);
export const adjustmentListQuerySchema = transactionListQuerySchema(["DRAFT", "REVISION", "POSTED", "CANCELLED"] as const);
export const transferListQuerySchema = transactionListQuerySchema(["DRAFT", "REVISION", "IN_TRANSIT", "COMPLETED", "CANCELLED"] as const);
export const transactionIdParamsSchema = z.object({ id: z.uuid() });
export const transactionReasonSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
const nonEmptyPatch = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) => schema.refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });
export const purchaseEditSchema = nonEmptyPatch(z.object({
  status: z.enum(["DRAFT", "PENDING", "RECEIVED", "CANCELLED"]).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  expectedDate: z.coerce.date().nullable().optional(),
}).strict());
export const saleEditSchema = nonEmptyPatch(z.object({
  status: z.enum(["DRAFT", "RESERVED", "COMPLETED", "CANCELLED"]).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).strict());
export const adjustmentEditSchema = nonEmptyPatch(z.object({ status: z.enum(["DRAFT", "CANCELLED"]).optional() }).strict());
export const transferEditSchema = nonEmptyPatch(z.object({
  status: z.enum(["DRAFT", "COMPLETED", "CANCELLED"]).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).strict());
export const expenseListQuerySchema = paginationQuerySchema.extend({
  status: emptyQueryValue(z.enum(["PAID", "UNPAID"]).optional()),
  fromDate: emptyQueryValue(z.iso.date().optional()),
  toDate: emptyQueryValue(z.iso.date().optional()),
}).superRefine((query, context) => {
  if (query.fromDate && query.toDate && query.fromDate > query.toDate) {
    context.addIssue({ code: "custom", path: ["toDate"], message: "Tanggal akhir harus sama atau setelah tanggal awal." });
  }
});
export const paymentListQuerySchema = paginationQuerySchema.extend({
  status: emptyQueryValue(z.enum(["PENDING", "PAID", "VOID"]).optional()),
  fromDate: emptyQueryValue(z.iso.date().optional()),
  toDate: emptyQueryValue(z.iso.date().optional()),
}).superRefine((query, context) => {
  if (query.fromDate && query.toDate && query.fromDate > query.toDate) {
    context.addIssue({ code: "custom", path: ["toDate"], message: "Tanggal akhir harus sama atau setelah tanggal awal." });
  }
});

export type PurchaseInput = z.output<typeof purchaseSchema>;
export type PurchaseReceiveInput = z.output<typeof purchaseReceiveSchema>;
export type SaleInput = z.output<typeof saleSchema>;
export type AdjustmentInput = z.output<typeof adjustmentSchema>;
export type TransferInput = z.output<typeof transferSchema>;
export type ExpenseInput = z.output<typeof expenseSchema>;
export type PaymentInput = z.output<typeof paymentSchema>;
