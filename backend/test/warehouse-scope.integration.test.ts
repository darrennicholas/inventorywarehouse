import "dotenv/config";

import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import test from "node:test";

const enabled = process.env.RUN_INTEGRATION_TESTS === "true" && /test/i.test(new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled").pathname);

test("warehouse routes deny unassigned custom roles by default and honor explicit cross-warehouse grants", { skip: !enabled }, async () => {
  const { prisma } = await import("../src/lib/prisma.ts");
  const { default: app } = await import("../src/app.ts");
  const { hashSessionToken } = await import("../src/middlewares/auth.middleware.ts");

  const suffix = randomUUID().slice(0, 8);
  const warehouseScopedRole = await prisma.role.create({ data: { code: `TEST_SCOPE_${suffix}`, name: "Test scoped role", permissions: { create: { permission: { connect: { key: "warehouses.read" } } } } } });
  const unassignedRole = await prisma.role.create({ data: { code: `TEST_GLOBAL_${suffix}`, name: "Test unassigned role", permissions: { create: { permission: { connect: { key: "warehouses.read" } } } } } });
  const inventoryPermission = await prisma.permission.findUniqueOrThrow({ where: { key: "inventory.read" } });
  await prisma.rolePermission.createMany({ data: [warehouseScopedRole, unassignedRole].map((role) => ({ roleId: role.id, permissionId: inventoryPermission.id })) });
  const [warehouseA, warehouseB] = await Promise.all([
    prisma.warehouse.create({ data: { code: `SCOPE-A-${suffix}`, name: `Scope warehouse A ${suffix}` } }),
    prisma.warehouse.create({ data: { code: `SCOPE-B-${suffix}`, name: `Scope warehouse B ${suffix}` } }),
  ]);
  const staff = await prisma.staff.create({ data: { staffCode: `SCOPE-${suffix}`, fullName: "Scoped test staff", warehouseId: warehouseA.id } });
  const scopedUser = await prisma.user.create({ data: { email: `scope-${suffix}@example.test`, fullName: "Scoped test user", passwordHash: "unused", roleId: warehouseScopedRole.id, staffId: staff.id } });
  const unassignedUser = await prisma.user.create({ data: { email: `global-${suffix}@example.test`, fullName: "Unassigned test user", passwordHash: "unused", roleId: unassignedRole.id } });
  const users = [scopedUser, unassignedUser];
  const tokens = users.map(() => randomUUID());
  const sessions = await Promise.all(users.map((user, index) => prisma.authSession.create({ data: { userId: user.id, tokenHash: hashSessionToken(tokens[index]!), expiresAt: new Date(Date.now() + 3600000) } })));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  async function getWarehouses(userIndex: number) {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/warehouses`, { headers: { cookie: `stockflow_session=${tokens[userIndex]}` } });
    return { status: response.status, body: await response.json() as { data?: Array<{ id: string }>; message?: string } };
  }
  async function getStockBatches(userIndex: number, warehouseId: string) {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/operations/batches?warehouseId=${warehouseId}`, { headers: { cookie: `stockflow_session=${tokens[userIndex]}` } });
    return { status: response.status, body: await response.json() as { message?: string } };
  }

  try {
    const scoped = await getWarehouses(0);
    assert.equal(scoped.status, 200, scoped.body.message);
    assert.deepEqual(scoped.body.data?.map((warehouse) => warehouse.id), [warehouseA.id]);

    const otherWarehouse = await fetch(`http://127.0.0.1:${address.port}/api/warehouses/${warehouseB.id}`, { headers: { cookie: `stockflow_session=${tokens[0]}` } });
    assert.equal(otherWarehouse.status, 403);
    assert.equal((await getStockBatches(0, warehouseA.id)).status, 200, "a custom role linked to staff can read stock in its assigned warehouse");
    assert.equal((await getStockBatches(0, warehouseB.id)).status, 403, "stock endpoints must enforce the same staff warehouse scope");

    const unassigned = await getWarehouses(1);
    assert.equal(unassigned.status, 403);
    assert.match(unassigned.body.message ?? "", /warehouse assignment or cross-warehouse permission/i);
    assert.equal((await getStockBatches(1, warehouseA.id)).status, 403, "an unassigned custom role cannot bypass scope through a stock endpoint");

    const allWarehousePermission = await prisma.permission.findUniqueOrThrow({ where: { key: "warehouses.access_all" } });
    await prisma.rolePermission.create({ data: { roleId: unassignedRole.id, permissionId: allWarehousePermission.id } });
    const explicitlyGranted = await getWarehouses(1);
    assert.equal(explicitlyGranted.status, 200, explicitlyGranted.body.message);
    const visibleIds = new Set(explicitlyGranted.body.data?.map((warehouse) => warehouse.id));
    assert.ok(visibleIds.has(warehouseA.id));
    assert.ok(visibleIds.has(warehouseB.id));
    assert.equal((await getStockBatches(1, warehouseB.id)).status, 200, "explicit cross-warehouse permission should apply consistently to stock reads");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.authSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    await prisma.staff.delete({ where: { id: staff.id } });
    await prisma.role.deleteMany({ where: { id: { in: [warehouseScopedRole.id, unassignedRole.id] } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: [warehouseA.id, warehouseB.id] } } });
    await prisma.$disconnect();
  }
});
