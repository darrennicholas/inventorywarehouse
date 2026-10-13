import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.js";
import { AppError } from "../../utils/AppError.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { adjustmentSchema, expenseSchema, paymentSchema, purchaseSchema, saleSchema, transferSchema, } from "./operations.validation.js";
const router = Router();
function sumItems(items) {
    return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}
async function changeStock(tx, productId, warehouseId, delta) {
    const current = await tx.inventoryBalance.findUnique({
        where: { productId_warehouseId: { productId, warehouseId } },
    });
    const next = (current?.quantityOnHand ?? 0) + delta;
    if (next < 0) {
        throw new AppError(400, `Insufficient stock for product ${productId}`);
    }
    return tx.inventoryBalance.upsert({
        where: { productId_warehouseId: { productId, warehouseId } },
        update: { quantityOnHand: next },
        create: { productId, warehouseId, quantityOnHand: next },
    });
}
async function ensureProducts(tx, ids) {
    const products = await tx.product.findMany({
        where: { id: { in: ids }, isActive: true },
        select: { id: true },
    });
    if (products.length !== new Set(ids).size) {
        throw new AppError(400, "One or more selected products are invalid or inactive");
    }
}
async function ensureWarehouse(tx, id) {
    const warehouse = await tx.warehouse.findUnique({ where: { id } });
    if (!warehouse || !warehouse.isActive)
        throw new AppError(400, "Warehouse is invalid or inactive");
}
const purchaseInclude = {
    supplier: { select: { id: true, code: true, name: true } },
    warehouse: { select: { id: true, code: true, name: true } },
    createdBy: { select: { id: true, fullName: true } },
    items: { include: { product: { select: { id: true, sku: true, name: true } } } },
};
const saleInclude = {
    customer: { select: { id: true, code: true, name: true } },
    warehouse: { select: { id: true, code: true, name: true } },
    createdBy: { select: { id: true, fullName: true } },
    items: { include: { product: { select: { id: true, sku: true, name: true } } } },
};
const editStatusSchema = z.object({
    status: z.string().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    expectedDate: z.coerce.date().nullable().optional(),
}).strict();
const expenseEditSchema = z.object({
    category: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    amount: z.coerce.number().min(0).optional(),
    warehouseId: z.uuid().nullable().optional(),
    expenseDate: z.coerce.date().optional(),
    isPaid: z.boolean().optional(),
}).strict();
const paymentEditSchema = z.object({
    method: z.enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD", "E_WALLET", "OTHER"]).optional(),
    status: z.enum(["PENDING", "PAID", "VOID"]).optional(),
    paymentDate: z.coerce.date().optional(),
    referenceNo: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
}).strict();
async function ensureTransitionAllowed(currentStatus, nextStatus, allowed) {
    if (!allowed.includes(nextStatus))
        throw new AppError(400, `Invalid status: ${nextStatus}`);
    if (["RECEIVED", "COMPLETED", "POSTED", "CANCELLED"].includes(currentStatus)) {
        throw new AppError(409, "A posted transaction cannot be edited");
    }
}
router.get("/options", requirePermission("inventory.read"), asyncHandler(async (_req, res) => {
    const [products, warehouses, suppliers, customers, purchaseOrders, sales, expenses] = await Promise.all([
        prisma.product.findMany({ where: { isActive: true }, select: { id: true, sku: true, name: true }, orderBy: { name: "asc" } }),
        prisma.warehouse.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
        prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
        prisma.customer.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
        prisma.purchaseOrder.findMany({ select: { id: true, number: true }, orderBy: { orderDate: "desc" }, take: 100 }),
        prisma.sale.findMany({ select: { id: true, number: true }, orderBy: { saleDate: "desc" }, take: 100 }),
        prisma.expense.findMany({ select: { id: true, number: true }, orderBy: { expenseDate: "desc" }, take: 100 }),
    ]);
    res.json({ success: true, data: { products, warehouses, suppliers, customers, purchaseOrders, sales, expenses } });
}));
router.get("/purchases", requirePermission("purchases.read"), asyncHandler(async (_req, res) => {
    const data = await prisma.purchaseOrder.findMany({ include: purchaseInclude, orderBy: { orderDate: "desc" } });
    res.json({ success: true, data });
}));
router.post("/purchases", requirePermission("purchases.write"), asyncHandler(async (req, res) => {
    const input = purchaseSchema.parse(req.body);
    const userId = authOf(req).userId;
    const subtotal = sumItems(input.items);
    const tax = input.tax ?? 0;
    const data = await prisma.$transaction(async (tx) => {
        await ensureWarehouse(tx, input.warehouseId);
        await ensureProducts(tx, input.items.map((item) => item.productId));
        const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
        if (!supplier?.isActive)
            throw new AppError(400, "Supplier is invalid or inactive");
        const purchase = await tx.purchaseOrder.create({
            data: {
                number: input.number,
                supplierId: input.supplierId,
                warehouseId: input.warehouseId,
                createdById: userId,
                status: input.status ?? "DRAFT",
                expectedDate: input.expectedDate ?? null,
                notes: input.notes ?? null,
                subtotal,
                tax,
                total: subtotal + tax,
                items: { create: input.items.map((item) => ({ ...item, total: item.quantity * item.unitPrice, receivedQuantity: input.status === "RECEIVED" ? item.quantity : 0 })) },
            },
            include: purchaseInclude,
        });
        if (input.status === "RECEIVED") {
            for (const item of input.items) {
                await changeStock(tx, item.productId, input.warehouseId, item.quantity);
                await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: input.warehouseId, quantity: item.quantity, movementType: "PURCHASE_RECEIPT", unitCost: item.unitPrice, purchaseOrderId: purchase.id, createdById: userId } });
            }
        }
        return purchase;
    });
    res.status(201).json({ success: true, message: "Purchase created successfully", data });
}));
router.patch("/purchases/:id", requirePermission("purchases.write"), asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = editStatusSchema.parse(req.body);
    const userId = authOf(req).userId;
    const current = await prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!current)
        throw new AppError(404, "Purchase not found");
    const nextStatus = input.status ?? current.status;
    if (input.status && input.status !== current.status)
        await ensureTransitionAllowed(current.status, input.status, ["DRAFT", "PENDING", "APPROVED", "RECEIVED", "CANCELLED"]);
    const data = await prisma.$transaction(async (tx) => {
        if (nextStatus === "RECEIVED" && current.status !== "RECEIVED") {
            for (const item of current.items) {
                await changeStock(tx, item.productId, current.warehouseId, item.quantity);
                await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: current.warehouseId, quantity: item.quantity, movementType: "PURCHASE_RECEIPT", unitCost: item.unitPrice, purchaseOrderId: id, createdById: userId } });
            }
            for (const item of current.items) {
                await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQuantity: item.quantity } });
            }
        }
        return tx.purchaseOrder.update({ where: { id }, data: { status: nextStatus, notes: input.notes, expectedDate: input.expectedDate }, include: purchaseInclude });
    });
    res.json({ success: true, message: "Purchase updated successfully", data });
}));
router.delete("/purchases/:id", requirePermission("purchases.delete"), asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const current = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!current)
        throw new AppError(404, "Purchase not found");
    if (["RECEIVED", "CANCELLED"].includes(current.status))
        throw new AppError(409, "A posted or cancelled purchase cannot be deleted");
    const data = await prisma.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" }, include: purchaseInclude });
    res.json({ success: true, message: "Purchase cancelled successfully", data });
}));
router.get("/sales", requirePermission("sales.read"), asyncHandler(async (_req, res) => {
    const data = await prisma.sale.findMany({ include: saleInclude, orderBy: { saleDate: "desc" } });
    res.json({ success: true, data });
}));
router.post("/sales", requirePermission("sales.write"), asyncHandler(async (req, res) => {
    const input = saleSchema.parse(req.body);
    const userId = authOf(req).userId;
    const subtotal = sumItems(input.items);
    const discount = input.discount ?? 0;
    const tax = input.tax ?? 0;
    const data = await prisma.$transaction(async (tx) => {
        await ensureWarehouse(tx, input.warehouseId);
        await ensureProducts(tx, input.items.map((item) => item.productId));
        const sale = await tx.sale.create({
            data: {
                number: input.number,
                customerId: input.customerId ?? null,
                warehouseId: input.warehouseId,
                createdById: userId,
                status: input.status ?? "DRAFT",
                notes: input.notes ?? null,
                subtotal,
                discount,
                tax,
                total: subtotal - discount + tax,
                items: { create: input.items.map((item) => ({ ...item, total: item.quantity * item.unitPrice })) },
            },
            include: saleInclude,
        });
        if (input.status === "COMPLETED") {
            for (const item of input.items) {
                await changeStock(tx, item.productId, input.warehouseId, -item.quantity);
                await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: input.warehouseId, quantity: -item.quantity, movementType: "SALE_ISSUE", unitCost: item.unitPrice, saleId: sale.id, createdById: userId } });
            }
        }
        return sale;
    });
    res.status(201).json({ success: true, message: "Sale created successfully", data });
}));
router.patch("/sales/:id", requirePermission("sales.write"), asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = editStatusSchema.pick({ status: true, notes: true }).parse(req.body);
    const userId = authOf(req).userId;
    const current = await prisma.sale.findUnique({ where: { id }, include: { items: true } });
    if (!current)
        throw new AppError(404, "Sale not found");
    const nextStatus = input.status ?? current.status;
    if (input.status && input.status !== current.status)
        await ensureTransitionAllowed(current.status, input.status, ["DRAFT", "COMPLETED", "CANCELLED"]);
    const data = await prisma.$transaction(async (tx) => {
        if (nextStatus === "COMPLETED" && current.status !== "COMPLETED") {
            for (const item of current.items) {
                await changeStock(tx, item.productId, current.warehouseId, -item.quantity);
                await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: current.warehouseId, quantity: -item.quantity, movementType: "SALE_ISSUE", unitCost: item.unitPrice, saleId: id, createdById: userId } });
            }
        }
        return tx.sale.update({ where: { id }, data: { status: nextStatus, notes: input.notes }, include: saleInclude });
    });
    res.json({ success: true, message: "Sale updated successfully", data });
}));
router.delete("/sales/:id", requirePermission("sales.delete"), asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const current = await prisma.sale.findUnique({ where: { id } });
    if (!current)
        throw new AppError(404, "Sale not found");
    if (["COMPLETED", "CANCELLED"].includes(current.status))
        throw new AppError(409, "A completed or cancelled sale cannot be deleted");
    const data = await prisma.sale.update({ where: { id }, data: { status: "CANCELLED" }, include: saleInclude });
    res.json({ success: true, message: "Sale cancelled successfully", data });
}));
router.get("/adjustments", requirePermission("adjustments.read"), asyncHandler(async (_req, res) => {
    const data = await prisma.stockAdjustment.findMany({ include: { warehouse: true, createdBy: { select: { id: true, fullName: true } }, items: { include: { product: { select: { id: true, sku: true, name: true } } } } }, orderBy: { adjustmentDate: "desc" } });
    res.json({ success: true, data });
}));
router.post("/adjustments", requirePermission("adjustments.write"), asyncHandler(async (req, res) => {
    const input = adjustmentSchema.parse(req.body);
    const userId = authOf(req).userId;
    const data = await prisma.$transaction(async (tx) => {
        await ensureWarehouse(tx, input.warehouseId);
        await ensureProducts(tx, input.items.map((item) => item.productId));
        const adjustment = await tx.stockAdjustment.create({ data: { number: input.number, warehouseId: input.warehouseId, createdById: userId, type: input.type, status: input.status ?? "DRAFT", reason: input.reason, items: { create: input.items } }, include: { warehouse: true, items: true } });
        if (input.status === "POSTED") {
            for (const item of input.items) {
                const quantity = input.type === "INCREASE" ? item.quantity : -item.quantity;
                await changeStock(tx, item.productId, input.warehouseId, quantity);
                await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: input.warehouseId, quantity, movementType: input.type === "INCREASE" ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", adjustmentId: adjustment.id, createdById: userId, note: input.reason } });
            }
        }
        return adjustment;
    });
    res.status(201).json({ success: true, message: "Adjustment created successfully", data });
}));
router.patch("/adjustments/:id", requirePermission("adjustments.write"), asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = editStatusSchema.pick({ status: true }).parse(req.body);
    const userId = authOf(req).userId;
    const current = await prisma.stockAdjustment.findUnique({ where: { id }, include: { items: true } });
    if (!current)
        throw new AppError(404, "Adjustment not found");
    const nextStatus = input.status ?? current.status;
    if (input.status && input.status !== current.status)
        await ensureTransitionAllowed(current.status, input.status, ["DRAFT", "POSTED", "CANCELLED"]);
    const data = await prisma.$transaction(async (tx) => {
        if (nextStatus === "POSTED" && current.status !== "POSTED") {
            for (const item of current.items) {
                const quantity = current.type === "INCREASE" ? item.quantity : -item.quantity;
                await changeStock(tx, item.productId, current.warehouseId, quantity);
                await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: current.warehouseId, quantity, movementType: current.type === "INCREASE" ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", adjustmentId: id, createdById: userId, note: current.reason } });
            }
        }
        return tx.stockAdjustment.update({ where: { id }, data: { status: nextStatus }, include: { warehouse: true, items: true } });
    });
    res.json({ success: true, message: "Adjustment updated successfully", data });
}));
router.delete("/adjustments/:id", requirePermission("adjustments.delete"), asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const current = await prisma.stockAdjustment.findUnique({ where: { id } });
    if (!current)
        throw new AppError(404, "Adjustment not found");
    if (["POSTED", "CANCELLED"].includes(current.status))
        throw new AppError(409, "A posted or cancelled adjustment cannot be deleted");
    const data = await prisma.stockAdjustment.update({ where: { id }, data: { status: "CANCELLED" }, include: { warehouse: true, items: true } });
    res.json({ success: true, message: "Adjustment cancelled successfully", data });
}));
router.get("/transfers", requirePermission("transfers.read"), asyncHandler(async (_req, res) => {
    const data = await prisma.stockTransfer.findMany({ include: { fromWarehouse: true, toWarehouse: true, createdBy: { select: { id: true, fullName: true } }, items: { include: { product: { select: { id: true, sku: true, name: true } } } } }, orderBy: { transferDate: "desc" } });
    res.json({ success: true, data });
}));
router.post("/transfers", requirePermission("transfers.write"), asyncHandler(async (req, res) => {
    const input = transferSchema.parse(req.body);
    const userId = authOf(req).userId;
    const data = await prisma.$transaction(async (tx) => {
        await ensureWarehouse(tx, input.fromWarehouseId);
        await ensureWarehouse(tx, input.toWarehouseId);
        await ensureProducts(tx, input.items.map((item) => item.productId));
        const transfer = await tx.stockTransfer.create({ data: { number: input.number, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId, createdById: userId, status: input.status ?? "DRAFT", notes: input.notes ?? null, items: { create: input.items } }, include: { items: true } });
        if (input.status === "COMPLETED") {
            for (const item of input.items) {
                await changeStock(tx, item.productId, input.fromWarehouseId, -item.quantity);
                await changeStock(tx, item.productId, input.toWarehouseId, item.quantity);
                await tx.stockMovement.createMany({ data: [
                        { productId: item.productId, warehouseId: input.fromWarehouseId, quantity: -item.quantity, movementType: "TRANSFER_OUT", transferId: transfer.id, createdById: userId },
                        { productId: item.productId, warehouseId: input.toWarehouseId, quantity: item.quantity, movementType: "TRANSFER_IN", transferId: transfer.id, createdById: userId },
                    ] });
            }
        }
        return transfer;
    });
    res.status(201).json({ success: true, message: "Transfer created successfully", data });
}));
router.patch("/transfers/:id", requirePermission("transfers.write"), asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = editStatusSchema.pick({ status: true, notes: true }).parse(req.body);
    const userId = authOf(req).userId;
    const current = await prisma.stockTransfer.findUnique({ where: { id }, include: { items: true } });
    if (!current)
        throw new AppError(404, "Transfer not found");
    const nextStatus = input.status ?? current.status;
    if (input.status && input.status !== current.status)
        await ensureTransitionAllowed(current.status, input.status, ["DRAFT", "IN_TRANSIT", "COMPLETED", "CANCELLED"]);
    const data = await prisma.$transaction(async (tx) => {
        if (nextStatus === "COMPLETED" && current.status !== "COMPLETED") {
            for (const item of current.items) {
                await changeStock(tx, item.productId, current.fromWarehouseId, -item.quantity);
                await changeStock(tx, item.productId, current.toWarehouseId, item.quantity);
                await tx.stockMovement.createMany({ data: [
                        { productId: item.productId, warehouseId: current.fromWarehouseId, quantity: -item.quantity, movementType: "TRANSFER_OUT", transferId: id, createdById: userId },
                        { productId: item.productId, warehouseId: current.toWarehouseId, quantity: item.quantity, movementType: "TRANSFER_IN", transferId: id, createdById: userId },
                    ] });
            }
        }
        return tx.stockTransfer.update({ where: { id }, data: { status: nextStatus, notes: input.notes }, include: { fromWarehouse: true, toWarehouse: true, items: true } });
    });
    res.json({ success: true, message: "Transfer updated successfully", data });
}));
router.delete("/transfers/:id", requirePermission("transfers.delete"), asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const current = await prisma.stockTransfer.findUnique({ where: { id } });
    if (!current)
        throw new AppError(404, "Transfer not found");
    if (["COMPLETED", "CANCELLED"].includes(current.status))
        throw new AppError(409, "A completed or cancelled transfer cannot be deleted");
    const data = await prisma.stockTransfer.update({ where: { id }, data: { status: "CANCELLED" }, include: { fromWarehouse: true, toWarehouse: true, items: true } });
    res.json({ success: true, message: "Transfer cancelled successfully", data });
}));
router.get("/expenses", requirePermission("expenses.read"), asyncHandler(async (_req, res) => {
    const data = await prisma.expense.findMany({ include: { warehouse: true, createdBy: { select: { id: true, fullName: true } } }, orderBy: { expenseDate: "desc" } });
    res.json({ success: true, data });
}));
router.post("/expenses", requirePermission("expenses.write"), asyncHandler(async (req, res) => {
    const input = expenseSchema.parse(req.body);
    const data = await prisma.expense.create({ data: { ...input, createdById: authOf(req).userId, warehouseId: input.warehouseId ?? null, description: input.description ?? null } });
    res.status(201).json({ success: true, message: "Expense created successfully", data });
}));
router.patch("/expenses/:id", requirePermission("expenses.write"), asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = expenseEditSchema.parse(req.body);
    if (input.warehouseId)
        await ensureWarehouse(prisma, input.warehouseId);
    const data = await prisma.expense.update({ where: { id }, data: input, include: { warehouse: true, createdBy: { select: { id: true, fullName: true } } } });
    res.json({ success: true, message: "Expense updated successfully", data });
}));
router.delete("/expenses/:id", requirePermission("expenses.delete"), asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const current = await prisma.expense.findUnique({ where: { id } });
    if (!current)
        throw new AppError(404, "Expense not found");
    if (current.isPaid)
        throw new AppError(409, "Paid expenses cannot be deleted");
    await prisma.expense.delete({ where: { id } });
    res.json({ success: true, message: "Expense deleted successfully" });
}));
router.get("/payments", requirePermission("payments.read"), asyncHandler(async (_req, res) => {
    const data = await prisma.payment.findMany({ include: { purchaseOrder: { select: { number: true } }, sale: { select: { number: true } }, expense: { select: { number: true } }, paidBy: { select: { fullName: true } } }, orderBy: { paymentDate: "desc" } });
    res.json({ success: true, data });
}));
router.post("/payments", requirePermission("payments.write"), asyncHandler(async (req, res) => {
    const input = paymentSchema.parse(req.body);
    const relationCount = [input.purchaseOrderId, input.saleId, input.expenseId].filter(Boolean).length;
    if (relationCount !== 1)
        throw new AppError(400, "A payment must be linked to exactly one purchase, sale, or expense");
    const data = await prisma.payment.create({ data: { ...input, paidById: authOf(req).userId, purchaseOrderId: input.purchaseOrderId ?? null, saleId: input.saleId ?? null, expenseId: input.expenseId ?? null, referenceNo: input.referenceNo ?? null, notes: input.notes ?? null } });
    res.status(201).json({ success: true, message: "Payment recorded successfully", data });
}));
router.patch("/payments/:id", requirePermission("payments.write"), asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = paymentEditSchema.parse(req.body);
    const data = await prisma.payment.update({ where: { id }, data: input, include: { paidBy: { select: { id: true, fullName: true } } } });
    res.json({ success: true, message: "Payment updated successfully", data });
}));
router.delete("/payments/:id", requirePermission("payments.delete"), asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const current = await prisma.payment.findUnique({ where: { id } });
    if (!current)
        throw new AppError(404, "Payment not found");
    const data = await prisma.payment.update({ where: { id }, data: { status: "VOID" }, include: { paidBy: { select: { id: true, fullName: true } } } });
    res.json({ success: true, message: "Payment voided successfully", data });
}));
router.get("/stock-report", requirePermission("reports.read"), asyncHandler(async (req, res) => {
    const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
    const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
    const balances = await prisma.inventoryBalance.findMany({ where: { warehouseId, productId }, include: { product: { select: { id: true, sku: true, name: true, minStock: true, unit: { select: { code: true } } } }, warehouse: { select: { id: true, code: true, name: true } } }, orderBy: [{ warehouse: { name: "asc" } }, { product: { name: "asc" } }] });
    res.json({ success: true, data: balances.map((balance) => ({ ...balance, isLowStock: balance.quantityOnHand <= balance.product.minStock })) });
}));
export default router;
