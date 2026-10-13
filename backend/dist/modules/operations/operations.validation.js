import { z } from "zod";
const uuid = z.uuid();
const positiveInt = z.coerce.number().int().positive();
const money = z.coerce.number().min(0);
const purchaseItem = z.object({
    productId: uuid,
    quantity: positiveInt,
    unitPrice: money,
}).strict();
const saleItem = z.object({
    productId: uuid,
    quantity: positiveInt,
    unitPrice: money,
}).strict();
const adjustmentItem = z.object({
    productId: uuid,
    quantity: positiveInt,
    notes: z.string().trim().max(500).nullable().optional(),
}).strict();
const transferItem = z.object({
    productId: uuid,
    quantity: positiveInt,
}).strict();
export const purchaseSchema = z.object({
    number: z.string().trim().min(2).max(40),
    supplierId: uuid,
    warehouseId: uuid,
    status: z.enum(["DRAFT", "PENDING", "APPROVED", "RECEIVED", "CANCELLED"]).optional(),
    expectedDate: z.coerce.date().nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    tax: money.optional(),
    items: z.array(purchaseItem).min(1),
}).strict();
export const saleSchema = z.object({
    number: z.string().trim().min(2).max(40),
    customerId: uuid.nullable().optional(),
    warehouseId: uuid,
    status: z.enum(["DRAFT", "COMPLETED", "CANCELLED"]).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    discount: money.optional(),
    tax: money.optional(),
    items: z.array(saleItem).min(1),
}).strict();
export const adjustmentSchema = z.object({
    number: z.string().trim().min(2).max(40),
    warehouseId: uuid,
    type: z.enum(["INCREASE", "DECREASE"]),
    status: z.enum(["DRAFT", "POSTED", "CANCELLED"]).optional(),
    reason: z.string().trim().min(2).max(500),
    items: z.array(adjustmentItem).min(1),
}).strict();
export const transferSchema = z.object({
    number: z.string().trim().min(2).max(40),
    fromWarehouseId: uuid,
    toWarehouseId: uuid,
    status: z.enum(["DRAFT", "IN_TRANSIT", "COMPLETED", "CANCELLED"]).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    items: z.array(transferItem).min(1),
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
    isPaid: z.boolean().optional(),
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
