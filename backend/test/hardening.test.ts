import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { ROLE_PRESETS } from "../src/rbac/permissions.ts";
import { hasPermission } from "../src/rbac/permission-utils.ts";

const integrationEnabled = Boolean(
  process.env.DATABASE_URL && process.env.RUN_INTEGRATION_TESTS === "true"
);

test("permission helper enforces the role permission matrix", () => {
  assert.equal(hasPermission(ROLE_PRESETS.ADMIN, ["roles.manage"]), true);
  assert.equal(hasPermission(ROLE_PRESETS.WAREHOUSE_MANAGER, ["transfers.approve"]), true);
  assert.equal(hasPermission(ROLE_PRESETS.PROCUREMENT, ["purchases.approve"]), true);
  assert.equal(hasPermission(ROLE_PRESETS.WAREHOUSE_STAFF, ["purchases.approve"]), false);
  assert.equal(hasPermission(ROLE_PRESETS.AUDITOR, ["products.write"]), false);
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
