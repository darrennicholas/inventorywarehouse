import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { ROLE_PRESETS } from "../src/rbac/permissions.ts";
import { hasPermission } from "../src/rbac/permission-utils.ts";
import { assertApprovalAuthority, type ApprovalTx } from "../src/modules/approvals/approval-policy.service.ts";
import { reconstructStockBalances } from "../src/modules/operations/inventory-history.ts";
import { csvCell, csvDocument } from "../src/utils/csv.ts";
import { notificationEventKey } from "../src/modules/notifications/notification-key.ts";
import { assertUsableBatch } from "../src/modules/operations/batch-safety.ts";
import { warehouseScope, assertWarehouseAccess } from "../src/rbac/warehouse-scope.ts";
import { writeAuditLog } from "../src/modules/audit/audit.service.ts";
import { dateRange, sumItems } from "../src/modules/operations/transaction-query.ts";
import { reportError } from "../src/lib/monitoring.ts";
import { conservativeAvailableQuantity } from "../src/modules/operations/stock-availability-summary.ts";

const integrationEnabled = Boolean(
  process.env.DATABASE_URL && process.env.RUN_INTEGRATION_TESTS === "true"
);

test("stock report availability cannot exceed aggregate physical stock less reservations", () => {
  assert.equal(conservativeAvailableQuantity(6, 4, 2), 2);
  assert.equal(conservativeAvailableQuantity(20, 10, 0), 10);
  assert.equal(conservativeAvailableQuantity(2, 10, 3), 2);
  assert.equal(conservativeAvailableQuantity(5, 4, 8), 0);
});

test("permission helper enforces the role permission matrix", () => {
  assert.equal(hasPermission(ROLE_PRESETS.ADMIN, ["roles.manage"]), true);
  assert.equal(hasPermission(ROLE_PRESETS.WAREHOUSE_MANAGER, ["transfers.approve"]), true);
  assert.equal(hasPermission(ROLE_PRESETS.PROCUREMENT, ["purchases.approve"]), true);
  assert.equal(hasPermission(ROLE_PRESETS.WAREHOUSE_STAFF, ["purchases.approve"]), false);
  assert.equal(hasPermission(ROLE_PRESETS.AUDITOR, ["products.write"]), false);
});

test("warehouse scope follows staff assignment for custom roles", () => {
  const customStaff = { userId: "u1", sessionId: "s1", roleCode: "CUSTOM_COUNTER", staffId: "st1", warehouseId: "wh-a", permissions: [], csrfToken: "" };
  assert.deepEqual(warehouseScope(customStaff), ["wh-a"]);
  assert.throws(() => assertWarehouseAccess(customStaff, "wh-b"), /another warehouse/i);
  assert.throws(() => warehouseScope({ ...customStaff, warehouseId: null }), /not assigned/i);
  assert.equal(warehouseScope({ ...customStaff, roleCode: "ADMIN", warehouseId: null }), undefined);
  assert.equal(warehouseScope({ ...customStaff, roleCode: "CUSTOM_NO_STAFF", staffId: null, warehouseId: null }), undefined);
});

test("audit writes preserve actor and before/after snapshots on the supplied transaction client", async () => {
  let written: Record<string, unknown> | undefined;
  const transactionClient = { auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { written = data; return data; } } };
  await writeAuditLog({ userId: "actor-1", action: "UPDATE", entity: "Category", entityId: "category-1", beforeData: { name: "Old" }, afterData: { name: "New" }, requestId: "request-1" }, transactionClient as never);
  assert.equal(written?.userId, "actor-1");
  assert.deepEqual(written?.beforeData, { name: "Old" });
  assert.deepEqual(written?.afterData, { name: "New" });
  assert.equal(written?.requestId, "request-1");
});

test("approval always requires a different creator even when an old policy allows self approval", async () => {
  const tx = { approvalPolicy: { findFirst: async () => ({ requiresDifferentCreator: false, approverRole: { code: "PROCUREMENT", name: "Procurement" } }) } } as unknown as ApprovalTx;
  await assert.rejects(() => assertApprovalAuthority(tx, "PURCHASE", 100, { userId: "creator", roleCode: "PROCUREMENT" }, "creator"), /creator cannot approve/i);
  await assert.doesNotReject(() => assertApprovalAuthority(tx, "PURCHASE", 100, { userId: "reviewer", roleCode: "PROCUREMENT" }, "creator"));
  await assert.rejects(() => assertApprovalAuthority(tx, "PURCHASE", 100, { userId: "reviewer", roleCode: "WAREHOUSE_STAFF" }, "creator"), /requires the Procurement role/i);
});

test("stock history reconstructs signed movements and newer pages correctly", () => {
  assert.deepEqual(reconstructStockBalances(12, 2, [-3, 5]), [{ before: 13, after: 10 }, { before: 8, after: 13 }]);
  assert.deepEqual(reconstructStockBalances(4, 0, []), []);
});

test("transaction query helpers use inclusive Jakarta dates and safe totals", () => {
  assert.equal(sumItems([{ quantity: 2, unitPrice: 10 }, { quantity: 3, unitPrice: 5 }]), 35);
  const range = dateRange({ fromDate: "2026-11-01", toDate: "2026-11-03" }, "saleDate") as { saleDate: { gte: Date; lt: Date } };
  assert.equal(range.saleDate.gte.toISOString(), "2026-10-31T17:00:00.000Z");
  assert.equal(range.saleDate.lt.toISOString(), "2026-11-03T17:00:00.000Z");
  assert.equal(dateRange({ fromDate: "2026-02-30" }, "saleDate"), null);
});

test("error monitoring keeps correlation metadata and omits raw error content", () => {
  const original = console.error;
  let output = "";
  console.error = (value?: unknown) => { output = String(value); };
  try {
    reportError(new Error("password=secret; SELECT * FROM users"), { requestId: "req-1", method: "POST", route: "/api/sales", userId: "user-1" });
  } finally {
    console.error = original;
  }
  assert.match(output, /req-1/);
  assert.match(output, /user-1/);
  assert.doesNotMatch(output, /secret|SELECT \*/);
});

test("CSV output escapes quotes and blocks spreadsheet formula cells", () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell(-5), '"-5"');
  assert.ok(csvDocument([["Nama", "Jumlah"], ["Produk", 2]]).startsWith("\uFEFF"));
});

test("duplicate notification events share a key while changed events remain distinct", () => {
  const event = { permission: "purchases.read", type: "PURCHASE_STATUS", title: "Purchase", message: "PENDING", entity: "PurchaseOrder", entityId: "one" };
  assert.equal(notificationEventKey(event, 301_000), notificationEventKey(event, 302_000));
  assert.notEqual(notificationEventKey(event, 301_000), notificationEventKey({ ...event, message: "APPROVED" }, 301_000));
  assert.notEqual(notificationEventKey(event, 301_000), notificationEventKey(event, 601_000));
});

test("receiving and transfers cannot revive or silently rewrite batches", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const batch = { status: "ACTIVE", expiryDate: new Date("2027-01-01T00:00:00Z"), productionDate: new Date("2025-01-01T00:00:00Z") };
  assert.doesNotThrow(() => assertUsableBatch(batch, { expiryDate: batch.expiryDate }, now));
  assert.throws(() => assertUsableBatch({ ...batch, status: "QUARANTINED" }, {}, now), /quarantined/);
  assert.throws(() => assertUsableBatch({ ...batch, status: "EXPIRED" }, {}, now), /expired/);
  assert.throws(() => assertUsableBatch(batch, { expiryDate: new Date("2028-01-01T00:00:00Z") }, now), /differs/);
  assert.throws(() => assertUsableBatch(batch, { expiryDate: new Date("2025-01-01T00:00:00Z") }, now), /Expired goods/);
});

test("concurrent stock changes remain consistent and never go negative", { skip: !integrationEnabled }, async () => {
  const { prisma } = await import("../src/lib/prisma.ts");
  const { changeStock } = await import("../src/modules/operations/inventory.service.ts");
  const suffix = randomUUID().slice(0, 8);
  const warehouse = await prisma.warehouse.create({ data: { code: `TEST-WH-${suffix}`, name: `Test warehouse ${suffix}` } });
  const product = await prisma.product.create({ data: { sku: `TEST-SKU-${suffix}`, name: `Concurrency test ${suffix}`, minStock: 0 } });

  try {
    await prisma.$transaction((tx) => changeStock(tx, product.id, warehouse.id, 10));
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => prisma.$transaction((tx) => changeStock(tx, product.id, warehouse.id, -1))));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 10);
    assert.equal(results.filter((result) => result.status === "rejected").length, 2);
    const balance = await prisma.inventoryBalance.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } } });
    assert.equal(balance?.quantityOnHand, 0);
    await assert.rejects(() => prisma.$transaction((tx) => changeStock(tx, product.id, warehouse.id, -1)), /Insufficient stock/);
  } finally {
    await prisma.inventoryBalance.deleteMany({ where: { productId: product.id, warehouseId: warehouse.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.warehouse.delete({ where: { id: warehouse.id } });
    await prisma.$disconnect();
  }
});

test("concurrent sales reservations from separate users cannot reserve the same stock", { skip: !integrationEnabled }, async () => {
  const { prisma } = await import("../src/lib/prisma.ts");
  const { reserveSaleStock } = await import("../src/modules/operations/inventory.service.ts");
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true }, take: 2 });
  assert.equal(users.length, 2, "Run the full seed with at least two active users");
  const suffix = randomUUID().slice(0, 8);
  const warehouse = await prisma.warehouse.create({ data: { code: `RACE-WH-${suffix}`, name: `Reservation race ${suffix}` } });
  const product = await prisma.product.create({ data: { sku: `RACE-SKU-${suffix}`, name: `Reservation race ${suffix}`, minStock: 0 } });
  const location = await prisma.warehouseLocation.create({ data: { warehouseId: warehouse.id, code: `R-${suffix}`, name: "Concurrency test location" } });
  const sales: Array<{ id: string; itemId: string; userId: string }> = [];

  try {
    await prisma.inventoryBalance.create({ data: { productId: product.id, warehouseId: warehouse.id, locationId: location.id, quantityOnHand: 5 } });
    await prisma.inventoryLocationBalance.create({ data: { productId: product.id, warehouseId: warehouse.id, locationId: location.id, quantityOnHand: 5 } });
    for (let index = 0; index < 2; index += 1) {
      const sale = await prisma.sale.create({ data: {
        number: `RACE-SALE-${suffix}-${index}`,
        warehouseId: warehouse.id,
        createdById: users[index]!.id,
        status: "DRAFT",
        items: { create: { productId: product.id, quantity: 4, unitPrice: 1, total: 4 } },
      }, include: { items: true } });
      sales.push({ id: sale.id, itemId: sale.items[0]!.id, userId: users[index]!.id });
    }

    const attempts = await Promise.allSettled(sales.map((sale) => prisma.$transaction((tx) => reserveSaleStock(
      tx, sale.id, warehouse.id, sale.userId, [{ id: sale.itemId, productId: product.id, quantity: 4 }],
    ))));
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
    const balance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } } });
    assert.equal(balance.quantityOnHand, 5);
    assert.equal(balance.reservedQuantity, 4);
    assert.equal(await prisma.stockReservation.count({ where: { productId: product.id, status: "ACTIVE" } }), 1);
  } finally {
    await prisma.stockReservation.deleteMany({ where: { productId: product.id } });
    await prisma.sale.deleteMany({ where: { id: { in: sales.map((sale) => sale.id) } } });
    await prisma.inventoryLocationBalance.deleteMany({ where: { productId: product.id } });
    await prisma.inventoryBalance.deleteMany({ where: { productId: product.id } });
    await prisma.warehouseLocation.delete({ where: { id: location.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.warehouse.delete({ where: { id: warehouse.id } });
    await prisma.$disconnect();
  }
});

test("transaction rollback removes all writes from a failed transaction", { skip: !integrationEnabled }, async () => {
  const { prisma } = await import("../src/lib/prisma.ts");
  const user = await prisma.user.findFirst({ select: { id: true } });
  assert.ok(user, "Run the full seed before integration tests");
  const number = `TEST-ROLLBACK-${randomUUID().slice(0, 8)}`;

  await assert.rejects(
    () => prisma.$transaction(async (tx) => {
      await tx.expense.create({ data: { number, category: "Test", amount: 1000, createdById: user.id } });
      throw new Error("forced rollback");
    }),
    /forced rollback/
  );

  assert.equal(await prisma.expense.count({ where: { number } }), 0);
  await prisma.$disconnect();
});

test("enforced location capacity rejects concurrent inbound stock above the limit", { skip: !integrationEnabled }, async () => {
  const { prisma } = await import("../src/lib/prisma.ts");
  const { postStockIn } = await import("../src/modules/operations/stock-allocation.service.ts");
  const suffix = randomUUID().slice(0, 8);
  const warehouse = await prisma.warehouse.create({ data: { code: `CAP-${suffix}`, name: `Capacity ${suffix}` } });
  const location = await prisma.warehouseLocation.create({ data: { warehouseId: warehouse.id, code: "CAP", name: "Capacity location", capacity: 5, enforceCapacity: true } });
  const products = await Promise.all([1, 2].map((n) => prisma.product.create({ data: { sku: `CAP-${suffix}-${n}`, name: `Capacity item ${n}` } })));
  try {
    const results = await Promise.allSettled(products.map((product) => prisma.$transaction((tx) => postStockIn(tx, { productId: product.id, warehouseId: warehouse.id, locationId: location.id, quantity: 3, unitCost: 1 }))));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.match(String(rejected.reason), /insufficient capacity/i);
    const total = await prisma.inventoryLocationBalance.aggregate({ where: { locationId: location.id }, _sum: { quantityOnHand: true } });
    assert.equal(total._sum.quantityOnHand, 3);
  } finally {
    await prisma.inventoryLocationBalance.deleteMany({ where: { warehouseId: warehouse.id } });
    await prisma.inventoryBalance.deleteMany({ where: { warehouseId: warehouse.id } });
    await prisma.warehouseLocation.delete({ where: { id: location.id } });
    await prisma.product.deleteMany({ where: { id: { in: products.map((product) => product.id) } } });
    await prisma.warehouse.delete({ where: { id: warehouse.id } });
    await prisma.$disconnect();
  }
});
