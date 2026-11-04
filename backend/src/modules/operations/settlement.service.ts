import { Prisma } from "../../generated/prisma/client.ts";
import { AppError } from "../../utils/AppError.ts";
export type DocumentType = "PURCHASE" | "SALE";

export async function lockFinancialDocument(tx: Prisma.TransactionClient, type: DocumentType, id: string) {
  if (type === "PURCHASE") await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id}::uuid FOR UPDATE`;
  else await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${id}::uuid FOR UPDATE`;
}

/** Allocate invoice discount and tax proportionally. Cap cumulative returns at invoice total. */
export async function returnValue(tx: Prisma.TransactionClient, id: string) {
  const doc = await tx.returnOrder.findUnique({ where: { id }, include: { purchaseOrder: true, sale: true, items: { include: { purchaseOrderItem: true, saleItem: true } } } });
  if (!doc) throw new AppError(404, "Return not found");
  const invoice = doc.type === "PURCHASE" ? doc.purchaseOrder : doc.sale;
  if (!invoice) throw new AppError(409, "Source invoice is missing");
  const raw = doc.items.reduce((sum, item) => sum.plus(new Prisma.Decimal(item.purchaseOrderItem?.unitPrice ?? item.saleItem?.unitPrice ?? 0).mul(item.quantity)), new Prisma.Decimal(0));
  const value = invoice.subtotal.gt(0) ? raw.mul(invoice.total).div(invoice.subtotal).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN) : new Prisma.Decimal(0);
  return { doc, invoice, value: Prisma.Decimal.min(value, invoice.total) };
}

export async function financialSummary(tx: Prisma.TransactionClient, type: DocumentType, id: string, excludePaymentId?: string) {
  const invoice = type === "PURCHASE" ? await tx.purchaseOrder.findUnique({ where: { id } }) : await tx.sale.findUnique({ where: { id } });
  if (!invoice) throw new AppError(404, "Source invoice not found");
  const relation = type === "PURCHASE" ? { purchaseOrderId: id } : { saleId: id };
  const [payments, returns, outgoing, applications] = await Promise.all([
    tx.payment.aggregate({ where: { ...relation, status: "PAID", ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}) }, _sum: { amount: true } }),
    tx.returnOrder.findMany({ where: { ...relation, status: "POSTED" }, select: { id: true } }),
    tx.returnSettlement.findMany({ where: { returnOrder: { ...relation } }, select: { amount: true, isReversal: true } }),
    tx.creditApplication.aggregate({ where: relation, _sum: { amount: true } }),
  ]);
  let returnedValue = new Prisma.Decimal(0);
  for (const doc of returns) returnedValue = returnedValue.plus((await returnValue(tx, doc.id)).value);
  returnedValue = Prisma.Decimal.min(returnedValue, invoice.total);
  const adjustedTotal = invoice.total.minus(returnedValue);
  const cashPaid = payments._sum.amount ?? new Prisma.Decimal(0);
  const creditApplied = applications._sum.amount ?? new Prisma.Decimal(0);
  const settledReturns = outgoing.reduce((sum, row) => sum.plus(row.isReversal ? row.amount.negated() : row.amount), new Prisma.Decimal(0));
  const netPaid = cashPaid.plus(creditApplied).minus(settledReturns);
  return { originalTotal: invoice.total, returnedValue, adjustedTotal, cashPaid, creditApplied, settledReturns, paid: netPaid, outstanding: Prisma.Decimal.max(adjustedTotal.minus(netPaid), 0), refundable: Prisma.Decimal.max(netPaid.minus(adjustedTotal), 0), warehouseId: invoice.warehouseId, invoice };
}

export async function returnSettlementSummary(tx: Prisma.TransactionClient, id: string) {
  const { doc, value } = await returnValue(tx, id);
  const sourceId = doc.type === "PURCHASE" ? doc.purchaseOrderId : doc.saleId;
  const summary = await financialSummary(tx, doc.type, sourceId!);
  const settlements = await tx.returnSettlement.findMany({ where: { returnOrderId: id }, include: { applications: { select: { amount: true } }, createdBy: { select: { fullName: true } }, reversal: { select: { id: true } } }, orderBy: { createdAt: "desc" } });
  const used = settlements.reduce((sum, row) => sum.plus(row.isReversal ? row.amount.negated() : row.amount), new Prisma.Decimal(0));
  const available = doc.status === "POSTED" ? Prisma.Decimal.max(Prisma.Decimal.min(value.minus(used), summary.refundable), 0) : new Prisma.Decimal(0);
  return { returnValue: value, available, summary, settlements: settlements.map(({ applications, reversal, ...row }) => ({ ...row, creditRemaining: row.kind === "CREDIT" && !row.isReversal && !reversal ? Prisma.Decimal.max(row.amount.minus(applications.reduce((sum, app) => sum.plus(app.amount), new Prisma.Decimal(0))), 0) : new Prisma.Decimal(0) })) };
}
