import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess, scopedWarehouseFilter, warehouseScope } from "../../rbac/warehouse-scope.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { pageMeta, pagination } from "../../utils/pagination.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { expenseListQuerySchema, expenseSchema, paymentListQuerySchema, paymentSchema, type ExpenseInput, type PaymentInput } from "./operations.validation.ts";
import { csvDocument } from "../../utils/csv.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { financialSummary } from "./settlement.service.ts";

const router = Router();
function dateRange(query: Record<string, unknown>, field: string) {
  const range: { gte?: Date; lt?: Date } = {};
  const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const from = validDate(query.fromDate) ? query.fromDate : "";
  const to = validDate(query.toDate) ? query.toDate : "";
  if (from) range.gte = new Date(`${from}T00:00:00.000+07:00`);
  if (to) { const exclusive = new Date(`${to}T00:00:00.000+07:00`); exclusive.setUTCDate(exclusive.getUTCDate() + 1); range.lt = exclusive; }
  return Object.keys(range).length ? { [field]: range } : null;
}
const expenseEditSchema = z.object({ category: z.string().trim().min(2).max(100).optional(), description: z.string().trim().max(1000).nullable().optional(), amount: z.coerce.number().min(0).optional(), warehouseId: z.uuid().nullable().optional(), expenseDate: z.coerce.date().optional() }).strict();
const paymentEditSchema = z.object({ method: z.enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD", "E_WALLET", "OTHER"]).optional(), status: z.enum(["PENDING", "PAID", "VOID"]).optional(), paymentDate: z.coerce.date().optional(), referenceNo: z.string().trim().max(120).nullable().optional(), notes: z.string().trim().max(500).nullable().optional() }).strict();

function paymentFilter(req: Request, query: z.infer<typeof paymentListQuerySchema>) {
  const scope = warehouseScope(authOf(req));
  const clauses: Prisma.PaymentWhereInput[] = [];
  if (scope) clauses.push({ OR: [{ purchaseOrder: { warehouseId: { in: scope } } }, { sale: { warehouseId: { in: scope } } }, { expense: { warehouseId: { in: scope } } }] });
  const { search, status } = query;
  if (search) clauses.push({ OR: [{ number: { contains: search, mode: "insensitive" } }, { referenceNo: { contains: search, mode: "insensitive" } }, { purchaseOrder: { number: { contains: search, mode: "insensitive" } } }, { sale: { number: { contains: search, mode: "insensitive" } } }, { expense: { number: { contains: search, mode: "insensitive" } } }] });
  if (status) clauses.push({ status });
  const dates = dateRange(query as Record<string, unknown>, "paymentDate"); if (dates) clauses.push(dates);
  return clauses.length ? { AND: clauses } : undefined;
}

function assertExpenseWarehouseAccess(auth: ReturnType<typeof authOf>, warehouseId: string | null | undefined) {
  const scope = warehouseScope(auth);
  if (scope && (!warehouseId || !scope.includes(warehouseId))) {
    throw new AppError(403, "You cannot access a general expense or an expense from another warehouse");
  }
  if (warehouseId) assertWarehouseAccess(auth, warehouseId);
}

const paymentInclude = { purchaseOrder: { select: { number: true } }, sale: { select: { number: true } }, expense: { select: { number: true } }, paidBy: { select: { fullName: true } } } as const;

type PaymentLink = { type: "PURCHASE" | "SALE" | "EXPENSE"; purchaseOrderId?: string | null; saleId?: string | null; expenseId?: string | null };
async function paymentDocument(tx: Prisma.TransactionClient, link: PaymentLink, auth: ReturnType<typeof authOf>) {
  const permission = link.type === "PURCHASE" ? "purchases.read" : link.type === "SALE" ? "sales.read" : "expenses.read";
  if (!auth.permissions.includes(permission)) throw new AppError(403, "Read access to the linked document is required");
  const id = link.type === "PURCHASE" ? link.purchaseOrderId : link.type === "SALE" ? link.saleId : link.expenseId;
  if (!id || [link.purchaseOrderId, link.saleId, link.expenseId].filter(Boolean).length !== 1) throw new AppError(400, "Payment type must match exactly one linked document");
  if (link.type === "PURCHASE") await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id}::uuid FOR UPDATE`;
  else if (link.type === "SALE") await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${id}::uuid FOR UPDATE`;
  else await tx.$queryRaw`SELECT "id" FROM "Expense" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const doc = link.type === "PURCHASE" ? await tx.purchaseOrder.findUnique({ where: { id }, select: { warehouseId: true, total: true, paymentDueDate: true } })
    : link.type === "SALE" ? await tx.sale.findUnique({ where: { id }, select: { warehouseId: true, total: true, paymentDueDate: true } })
    : await tx.expense.findUnique({ where: { id }, select: { warehouseId: true, amount: true } });
  if (!doc) throw new AppError(404, "Linked payment document not found");
  if (doc.warehouseId) assertWarehouseAccess(auth, doc.warehouseId);
  else if (warehouseScope(auth)) throw new AppError(403, "A warehouse-scoped user cannot access a general expense");
  return { id, warehouseId: doc.warehouseId, total: "total" in doc ? doc.total : doc.amount, paymentDueDate: "paymentDueDate" in doc ? doc.paymentDueDate : null };
}
async function assertPaymentLimit(tx: Prisma.TransactionClient, link: PaymentLink, id: string, total: Prisma.Decimal, amount: Prisma.Decimal | number, excludeId?: string) {
  if (link.type !== "EXPENSE") {
    const summary = await financialSummary(tx, link.type, id, excludeId);
    if (["DRAFT", "CANCELLED"].includes(summary.invoice.status)) throw new AppError(409, "Payments require an active invoice that is no longer a draft");
    if (new Prisma.Decimal(amount).lte(0)) throw new AppError(400, "Payment amount must be greater than zero");
    if (new Prisma.Decimal(amount).gt(summary.outstanding)) throw new AppError(409, "Payment exceeds the outstanding balance after returns and credit applications", undefined, "PAYMENT_EXCEEDS_BALANCE");
    return;
  }
  const relation = { expenseId: id };
  const existing = await tx.payment.aggregate({ where: { ...relation, status: "PAID", ...(excludeId ? { id: { not: excludeId } } : {}) }, _sum: { amount: true } });
  if (new Prisma.Decimal(amount).lte(0)) throw new AppError(400, "Payment amount must be greater than zero");
  if (new Prisma.Decimal(existing._sum.amount ?? 0).plus(amount).gt(total)) throw new AppError(409, "Payment exceeds the outstanding balance of the linked document", undefined, "PAYMENT_EXCEEDS_BALANCE");
}

async function syncExpensePaymentState(tx: Prisma.TransactionClient, expenseId: string, userId: string) {
  const expense = await tx.expense.findUniqueOrThrow({ where: { id: expenseId }, select: { id: true, amount: true, isPaid: true } });
  const payments = await tx.payment.aggregate({ where: { expenseId, status: "PAID" }, _sum: { amount: true } });
  const paidAmount = payments._sum.amount ?? new Prisma.Decimal(0);
  const isPaid = paidAmount.gte(expense.amount);
  if (isPaid !== expense.isPaid) {
    await tx.expense.update({ where: { id: expenseId }, data: { isPaid } });
    await writeAuditLog({ userId, action: "PAYMENT_STATE_SYNC", entity: "Expense", entityId: expenseId, beforeData: { isPaid: expense.isPaid }, afterData: { isPaid, paidAmount, amount: expense.amount } }, tx as never);
  }
  return { isPaid, paidAmount };
}

router.get("/payment-summary", requirePermission("payments.read"), asyncHandler(async (req, res) => {
  const query = z.object({ type: z.enum(["PURCHASE", "SALE", "EXPENSE"]), id: z.uuid() }).parse(req.query);
  const auth = authOf(req); const permission = query.type === "PURCHASE" ? "purchases.read" : query.type === "SALE" ? "sales.read" : "expenses.read";
  if (!auth.permissions.includes(permission)) throw new AppError(403, "You cannot view the linked document");
  const link: PaymentLink = query.type === "PURCHASE" ? { type: query.type, purchaseOrderId: query.id } : query.type === "SALE" ? { type: query.type, saleId: query.id } : { type: query.type, expenseId: query.id };
  const data = await prisma.$transaction(async (tx) => {
    const doc = await paymentDocument(tx, link, auth);
    const relation = query.type === "PURCHASE" ? { purchaseOrderId: query.id } : query.type === "SALE" ? { saleId: query.id } : { expenseId: query.id };
    const payments = await tx.payment.findMany({ where: relation, select: { id: true, number: true, amount: true, status: true, paymentDate: true, method: true }, orderBy: [{ paymentDate: "desc" }, { id: "desc" }], take: 50 });
    const sum = await tx.payment.aggregate({ where: { ...relation, status: "PAID" }, _sum: { amount: true } });
    const paid = sum._sum.amount ?? new Prisma.Decimal(0);
    if (query.type !== "EXPENSE") {
      const summary = await financialSummary(tx, query.type, query.id);
      return { total: summary.adjustedTotal, originalTotal: summary.originalTotal, returnedValue: summary.returnedValue, paid: summary.paid, cashPaid: summary.cashPaid, creditApplied: summary.creditApplied, settledReturns: summary.settledReturns, outstanding: summary.outstanding, refundable: summary.refundable, paymentDueDate: doc.paymentDueDate, payments, historyLimit: 50 };
    }
    return { total: doc.total, paid, outstanding: Prisma.Decimal.max(doc.total.minus(paid), 0), paymentDueDate: doc.paymentDueDate, payments, historyLimit: 50 };
  });
  res.json({ success: true, data });
}));

router.patch("/payment-due-date", requirePermission("payments.write"), asyncHandler(async (req, res) => {
  const input = z.object({ type: z.enum(["PURCHASE", "SALE"]), id: z.uuid(), date: z.iso.date().nullable() }).strict().parse(req.body);
  const auth = authOf(req); if (!auth.permissions.includes(input.type === "PURCHASE" ? "purchases.read" : "sales.read")) throw new AppError(403, "You cannot view the linked document");
  const link: PaymentLink = input.type === "PURCHASE" ? { type: input.type, purchaseOrderId: input.id } : { type: input.type, saleId: input.id };
  const data = await prisma.$transaction(async (tx) => {
    const doc = await paymentDocument(tx, link, auth); const paymentDueDate = input.date ? new Date(`${input.date}T00:00:00.000Z`) : null;
    if (input.type === "PURCHASE") await tx.purchaseOrder.update({ where: { id: input.id }, data: { paymentDueDate } });
    else await tx.sale.update({ where: { id: input.id }, data: { paymentDueDate } });
    await writeAuditLog({ userId: auth.userId, action: "PAYMENT_DUE_DATE", entity: input.type === "PURCHASE" ? "PurchaseOrder" : "Sale", entityId: input.id, beforeData: { paymentDueDate: doc.paymentDueDate }, afterData: { paymentDueDate } }, tx as never);
    return { paymentDueDate };
  });
  res.json({ success: true, data });
}));

router.get("/payments.csv", requirePermission("payments.read"), asyncHandler(async (req, res) => {
  const query = paymentListQuerySchema.parse(req.query);
  const data = await prisma.payment.findMany({ where: paymentFilter(req, query), include: paymentInclude, orderBy: [{ paymentDate: "desc" }, { id: "desc" }] });
  const rows = [["Nomor", "Tanggal", "Tipe", "Dokumen", "Metode", "Status", "Jumlah", "Dicatat oleh"], ...data.map((row) => [row.number, row.paymentDate.toISOString(), row.type, row.purchaseOrder?.number ?? row.sale?.number ?? row.expense?.number ?? "", row.method, row.status, Number(row.amount), row.paidBy.fullName])];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="payment-report.csv"');
  res.send(csvDocument(rows));
}));

router.get("/expenses", requirePermission("expenses.read"), asyncHandler(async (req, res) => {
  const query = expenseListQuerySchema.parse(req.query);
  const { page, pageSize, skip, take } = pagination(query);
  const clauses: Prisma.ExpenseWhereInput[] = [];
  const base = scopedWarehouseFilter(authOf(req));
  if (base) clauses.push(base);
  const { search, status } = query;
  if (search) clauses.push({ OR: [{ number: { contains: search, mode: "insensitive" } }, { category: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }] });
  if (status) clauses.push({ isPaid: status === "PAID" });
  const dates = dateRange(query as Record<string, unknown>, "expenseDate"); if (dates) clauses.push(dates);
  const where = clauses.length ? { AND: clauses } : undefined;
  const [data, total] = await Promise.all([prisma.expense.findMany({ where, include: { warehouse: true, createdBy: { select: { id: true, fullName: true } } }, orderBy: { expenseDate: "desc" }, skip, take }), prisma.expense.count({ where })]);
  res.json({ success: true, data, meta: pageMeta(page, pageSize, total) });
}));
router.post("/expenses", requirePermission("expenses.write"), asyncHandler(async (req, res) => {
  const input: ExpenseInput = expenseSchema.parse(req.body);
  const auth = authOf(req);
  assertExpenseWarehouseAccess(auth, input.warehouseId);
  const data = await prisma.$transaction(async (tx) => {
    const created = await tx.expense.create({ data: { ...input, createdById: auth.userId, warehouseId: input.warehouseId ?? null, description: input.description ?? null } });
    await writeAuditLog({ userId: auth.userId, action: "CREATE", entity: "Expense", entityId: created.id, afterData: created, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    return created;
  });
  await notifyByPermission({ permission: "expenses.read", type: "EXPENSE_CREATED", title: "New expense recorded", message: `${data.number} was recorded for ${data.amount}.`, entity: "Expense", entityId: data.id, warehouseId: data.warehouseId ?? undefined });
  res.status(201).json({ success: true, message: "Expense created successfully", data });
}));

router.patch("/expenses/:id", requirePermission("expenses.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const input = expenseEditSchema.parse(req.body);
  const auth = authOf(req);
  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Expense" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const current = await tx.expense.findUnique({ where: { id } });
    if (!current) throw new AppError(404, "Expense not found");
    assertExpenseWarehouseAccess(auth, current.warehouseId);
    if (input.warehouseId !== undefined) {
      assertExpenseWarehouseAccess(auth, input.warehouseId);
    }
    if (input.warehouseId) {
      const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId } });
      if (!warehouse?.isActive) throw new AppError(400, "Warehouse is invalid or inactive");
    }
    const paid = await tx.payment.aggregate({ where: { expenseId: id, status: "PAID" }, _sum: { amount: true } });
    if (input.amount !== undefined && new Prisma.Decimal(input.amount).lt(paid._sum.amount ?? 0)) {
      throw new AppError(409, "Expense amount cannot be lower than payments already recorded");
    }
    await tx.expense.update({ where: { id }, data: input });
    await syncExpensePaymentState(tx, id, auth.userId);
    const updated = await tx.expense.findUniqueOrThrow({ where: { id }, include: { warehouse: true, createdBy: { select: { id: true, fullName: true } } } });
    await writeAuditLog({ userId: auth.userId, action: "UPDATE", entity: "Expense", entityId: id, beforeData: current, afterData: updated, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "expenses.read", type: "EXPENSE_UPDATED", title: "Expense updated", message: `${data.number} was updated.`, entity: "Expense", entityId: data.id, warehouseId: data.warehouseId ?? undefined });
  res.json({ success: true, message: "Expense updated successfully", data });
}));

router.delete("/expenses/:id", requirePermission("expenses.delete"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const auth = authOf(req);
  const current = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Expense" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const expense = await tx.expense.findUnique({ where: { id } });
    if (!expense) throw new AppError(404, "Expense not found");
    assertExpenseWarehouseAccess(auth, expense.warehouseId);
    if (await tx.payment.count({ where: { expenseId: id } })) throw new AppError(409, "Expenses with payment history cannot be deleted");
    await writeAuditLog({ userId: auth.userId, action: "DELETE", entity: "Expense", entityId: id, beforeData: expense, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    await tx.expense.delete({ where: { id } });
    return expense;
  });
  await notifyByPermission({ permission: "expenses.read", type: "EXPENSE_DELETED", title: "Expense removed", message: `${current.number} was deleted.`, entity: "Expense", entityId: current.id, warehouseId: current.warehouseId ?? undefined });
  res.json({ success: true, message: "Expense deleted successfully" });
}));

router.get("/payments", requirePermission("payments.read"), asyncHandler(async (req, res) => {
  const query = paymentListQuerySchema.parse(req.query);
  const { page, pageSize, skip, take } = pagination(query);
  const where = paymentFilter(req, query);
  const [data, total] = await Promise.all([prisma.payment.findMany({ where, include: paymentInclude, orderBy: [{ paymentDate: "desc" }, { id: "desc" }], skip, take }), prisma.payment.count({ where })]);
  res.json({ success: true, data, meta: pageMeta(page, pageSize, total) });
}));
router.post("/payments", requirePermission("payments.write"), asyncHandler(async (req, res) => {
  const input: PaymentInput = paymentSchema.parse(req.body); const auth = authOf(req);
  const { data, warehouseId } = await prisma.$transaction(async (tx) => {
    const doc = await paymentDocument(tx, input, auth);
    if (input.amount <= 0) throw new AppError(400, "Payment amount must be greater than zero");
    if ((input.status ?? "PAID") === "PAID") await assertPaymentLimit(tx, input, doc.id, doc.total, input.amount);
    const data = await tx.payment.create({ data: { ...input, paidById: auth.userId, purchaseOrderId: input.purchaseOrderId ?? null, saleId: input.saleId ?? null, expenseId: input.expenseId ?? null, referenceNo: input.referenceNo ?? null, notes: input.notes ?? null } });
    await writeAuditLog({ userId: auth.userId, action: "CREATE", entity: "Payment", entityId: data.id, afterData: data, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    if (input.type === "EXPENSE" && input.expenseId) await syncExpensePaymentState(tx, input.expenseId, auth.userId);
    return { data, warehouseId: doc.warehouseId };
  });
  await notifyByPermission({ permission: "payments.read", type: "PAYMENT_CREATED", title: "Payment recorded", message: `${data.number} was recorded as ${data.status.toLowerCase()}.`, entity: "Payment", entityId: data.id, warehouseId: warehouseId ?? undefined }); res.status(201).json({ success: true, message: "Payment recorded successfully", data });
}));
router.patch("/payments/:id", requirePermission("payments.write"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id); const input = paymentEditSchema.parse(req.body); const auth = authOf(req);
  if (input.status === "VOID") throw new AppError(409, "Use the authorized void action to cancel a payment");
  const { data, warehouseId } = await prisma.$transaction(async (tx) => {
    const current = await tx.payment.findUnique({ where: { id } }); if (!current) throw new AppError(404, "Payment not found");
    const doc = await paymentDocument(tx, current, auth);
    const latest = await tx.payment.findUnique({ where: { id } }); if (!latest) throw new AppError(404, "Payment not found");
    if (latest.status === "VOID") throw new AppError(409, "Voided payments cannot be edited; record a new payment if needed");
    if (latest.status === "PAID" && input.status && input.status !== "PAID") throw new AppError(409, "A paid payment cannot be reverted by editing; use the authorized void action");
    if (latest.status !== "PAID" && input.status === "PAID") await assertPaymentLimit(tx, latest, doc.id, doc.total, latest.amount, id);
    const data = await tx.payment.update({ where: { id }, data: input, include: { paidBy: { select: { id: true, fullName: true } } } });
    await writeAuditLog({ userId: auth.userId, action: "UPDATE", entity: "Payment", entityId: id, beforeData: latest, afterData: data, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    if (latest.type === "EXPENSE" && latest.expenseId) await syncExpensePaymentState(tx, latest.expenseId, auth.userId);
    return { data, warehouseId: doc.warehouseId };
  });
  await notifyByPermission({ permission: "payments.read", type: "PAYMENT_UPDATED", title: "Payment updated", message: `${data.number} was updated.`, entity: "Payment", entityId: data.id, warehouseId: warehouseId ?? undefined }); res.json({ success: true, message: "Payment updated successfully", data });
}));
router.delete("/payments/:id", requirePermission("payments.delete"), asyncHandler(async (req, res) => {
  const id = z.uuid().parse(req.params.id); const auth = authOf(req);
  const { data, warehouseId } = await prisma.$transaction(async (tx) => {
    const current = await tx.payment.findUnique({ where: { id } }); if (!current) throw new AppError(404, "Payment not found");
    const doc = await paymentDocument(tx, current, auth);
    const latest = await tx.payment.findUnique({ where: { id } });
    if (!latest) throw new AppError(404, "Payment not found");
    if (latest.status === "VOID") throw new AppError(409, "Payment is already void");
    if (latest.type !== "EXPENSE" && latest.status === "PAID") {
      const without = await financialSummary(tx, latest.type, doc.id, latest.id);
      if (without.paid.isNegative()) throw new AppError(409, "This payment funds an existing refund or credit and cannot be voided");
      const refunded = await tx.returnSettlement.aggregate({ where: { kind: "REFUND", returnOrder: latest.type === "PURCHASE" ? { purchaseOrderId: doc.id } : { saleId: doc.id } }, _sum: { amount: true } });
      if (without.cashPaid.lt(refunded._sum.amount ?? 0)) throw new AppError(409, "This cash payment funds an existing cash refund and cannot be voided");
    }
    const data = await tx.payment.update({ where: { id }, data: { status: "VOID" }, include: { paidBy: { select: { id: true, fullName: true } } } });
    await writeAuditLog({ userId: auth.userId, action: "VOID", entity: "Payment", entityId: id, beforeData: latest, afterData: data, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
    if (latest.type === "EXPENSE" && latest.expenseId) await syncExpensePaymentState(tx, latest.expenseId, auth.userId);
    return { data, warehouseId: doc.warehouseId };
  });
  await notifyByPermission({ permission: "payments.read", type: "PAYMENT_VOID", title: "Payment voided", message: `${data.number} was voided.`, entity: "Payment", entityId: data.id, warehouseId: warehouseId ?? undefined }); res.json({ success: true, message: "Payment voided successfully", data });
}));

export default router;
