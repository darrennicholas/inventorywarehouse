import { Router } from "express";
import { prisma } from "../../lib/prisma.ts";
import { authOf, requirePermission } from "../../middlewares/auth.middleware.ts";
import { warehouseScope } from "../../rbac/warehouse-scope.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";

const router = Router();
router.get("/options", requirePermission("inventory.read"), asyncHandler(async (req, res) => {
  const auth = authOf(req);
  const scope = warehouseScope(auth);
  const [products, warehouses, suppliers, customers, purchaseOrders, sales, expenses, locations, batches] = await Promise.all([
    prisma.product.findMany({ where: { isActive: true }, select: { id: true, sku: true, barcode: true, name: true, trackBatch: true }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { isActive: true, ...(scope ? { id: { in: scope } } : {}) }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    auth.permissions.includes("suppliers.read") ? prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }) : [],
    auth.permissions.includes("customers.read") ? prisma.customer.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }) : [],
    auth.permissions.includes("purchases.read") ? prisma.purchaseOrder.findMany({ where: scope ? { warehouseId: { in: scope } } : undefined, select: { id: true, number: true }, orderBy: { orderDate: "desc" }, take: 100 }) : [],
    auth.permissions.includes("sales.read") ? prisma.sale.findMany({ where: scope ? { warehouseId: { in: scope } } : undefined, select: { id: true, number: true }, orderBy: { saleDate: "desc" }, take: 100 }) : [],
    auth.permissions.includes("expenses.read") ? prisma.expense.findMany({ where: scope ? { warehouseId: { in: scope } } : undefined, select: { id: true, number: true }, orderBy: { expenseDate: "desc" }, take: 100 }) : [],
    prisma.warehouseLocation.findMany({ where: { isActive: true, ...(scope ? { warehouseId: { in: scope } } : {}) }, select: { id: true, warehouseId: true, code: true, name: true, locationType: true, }, orderBy: { code: "asc" } }),
    prisma.productBatch.findMany({ where: { status: "ACTIVE", quantityOnHand: { gt: 0 }, ...(scope ? { warehouseId: { in: scope } } : {}) }, select: { id: true, productId: true, warehouseId: true, batchNumber: true, product: { select: { sku: true, name: true } } }, orderBy: [{ expiryDate: "asc" }, { batchNumber: "asc" }], take: 500 }),
  ]);
  res.json({ success: true, data: { products, warehouses, suppliers, customers, purchaseOrders, sales, expenses, locations, batches } });
}));

export default router;
