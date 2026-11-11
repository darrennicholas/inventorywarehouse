import "dotenv/config";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import test from "node:test";

const enabled = process.env.RUN_INTEGRATION_TESTS === "true" && /test/i.test(new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled").pathname);

test("scoped accounts, stocktake pagination, dashboard aggregation and shipment actions", { skip: !enabled }, async () => {
  const { prisma } = await import("../src/lib/prisma.ts");
  const { default: app } = await import("../src/app.ts");
  const { createCsrfToken, hashSessionToken } = await import("../src/middlewares/auth.middleware.ts");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { code: "ADMIN" }, isActive: true } });
  const scoped = await prisma.user.findFirstOrThrow({ where: { role: { code: "WAREHOUSE_STAFF" }, staff: { warehouseId: { not: null } } }, include: { staff: true } });
  const warehouseId = scoped.staff!.warehouseId!;
  const other = await prisma.warehouse.create({ data: { code: `T-${randomUUID().slice(0, 8)}`, name: "Other warehouse" } });
  const suffix = randomUUID().slice(0, 8);
  const product = await prisma.product.create({ data: { sku: `T-${suffix}`, name: "Stocktake fixture" } });
  const staff = await prisma.staff.create({ data: { staffCode: `T-${suffix}`, fullName: "Assigned test staff", warehouseId } });
  const sessions = await Promise.all([warehouseId, warehouseId, other.id].map((wid, index) => prisma.stockTakeSession.create({ data: { number: `T-${suffix}-${index}`, warehouseId: wid, createdById: admin.id, status: "COUNTING", lines: { create: [{ productId: product.id, systemQuantity: 0 }] } } })));
  const stamp = new Date("2025-06-01T10:00:00.000Z");
  await prisma.expense.createMany({ data: [10, 20].map((amount, index) => ({ number: `E-${suffix}-${index}`, category: "Test", amount, warehouseId, createdById: admin.id, expenseDate: stamp })) });
  await prisma.stockMovement.createMany({ data: [{ movementType: "PURCHASE_RECEIPT" as const, quantity: 5, warehouseId }, { movementType: "SALE_ISSUE" as const, quantity: -2, warehouseId }, { movementType: "PURCHASE_RECEIPT" as const, quantity: 99, warehouseId: other.id }].map((row) => ({ ...row, productId: product.id, createdById: admin.id, occurredAt: stamp })) });
  const sale = await prisma.sale.create({ data: { number: `S-${suffix}`, warehouseId, createdById: admin.id, items: { create: [{ productId: product.id, quantity: 2, unitPrice: 1, total: 2 }] } }, include: { items: true } });
  const shipment = await prisma.saleShipment.create({ data: { number: `SH-${suffix}`, saleId: sale.id, warehouseId, createdById: admin.id, items: { create: [{ saleItemId: sale.items[0].id, productId: product.id, quantity: 2 }] } } });
  const tokens = [randomUUID(), randomUUID()];
  const authSessions = await Promise.all([admin, scoped].map((user, index) => prisma.authSession.create({ data: { userId: user.id, tokenHash: hashSessionToken(tokens[index]), expiresAt: new Date(Date.now() + 3600000) } })));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  let createdUserId: string | undefined;
  try {
    const listResponse = await fetch(`${base}/stock-opnames?page=1&pageSize=1&search=${suffix}`, { headers: { cookie: `stockflow_session=${tokens[1]}` } });
    assert.equal(listResponse.status, 200); const list = await listResponse.json() as { data: Array<{ id: string; _count: { lines: number } }>; meta: { total: number } };
    assert.equal(list.meta.total, 2); assert.equal(list.data.length, 1); assert.equal(list.data[0]._count.lines, 1); assert.notEqual(list.data[0].id, sessions[2].id);
    const detail = await fetch(`${base}/stock-opnames/${list.data[0].id}`, { headers: { cookie: `stockflow_session=${tokens[1]}` } }); assert.equal(detail.status, 200);
    const dashboard = await fetch(`${base}/operations/dashboard-summary?from=2025-06-01&to=2025-06-01&warehouseId=${warehouseId}`, { headers: { cookie: `stockflow_session=${tokens[0]}` } });
    const dashboardData = await dashboard.json() as { data: { kpis: { expenseValue: number }; trend: Array<{ receipts: number; issues: number }> } }; assert.equal(dashboard.status, 200); assert.equal(dashboardData.data.kpis.expenseValue, 30); assert.equal(dashboardData.data.trend[0].receipts, 5); assert.equal(dashboardData.data.trend[0].issues, 2);
    const shipments = await fetch(`${base}/fulfillment?search=${suffix}`, { headers: { cookie: `stockflow_session=${tokens[0]}` } }); const shipmentData = await shipments.json() as { data: Array<{ availableActions: string[] }> }; assert.equal(shipments.status, 200); assert.ok(shipmentData.data[0].availableActions.includes("pick")); assert.ok(!shipmentData.data[0].availableActions.includes("pack"));
    await prisma.saleShipmentItem.updateMany({ where: { shipmentId: shipment.id }, data: { pickedQuantity: 2 } });
    const ready = await fetch(`${base}/fulfillment?search=${suffix}`, { headers: { cookie: `stockflow_session=${tokens[0]}` } }); const readyData = await ready.json() as { data: Array<{ availableActions: string[] }> }; assert.ok(readyData.data[0].availableActions.includes("pack"));
    const postUser = (staffId: string | null) => fetch(`${base}/users`, { method: "POST", headers: { cookie: `stockflow_session=${tokens[0]}`, origin: (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, ""), "x-csrf-token": createCsrfToken(authSessions[0].id), "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ fullName: "Test scoped account", email: `scoped-${suffix}@example.test`, password: "validation-password-123", roleId: scoped.roleId, staffId }) });
    const missing = await postUser(null); const missingBody = await missing.json() as { code?: string }; assert.equal(missing.status, 400); assert.equal(missingBody.code, "WAREHOUSE_ASSIGNMENT_REQUIRED");
    const assigned = await postUser(staff.id); const assignedBody = await assigned.json() as { data?: { id: string }; message?: string }; assert.equal(assigned.status, 201, assignedBody.message); createdUserId = assignedBody.data?.id;
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.authSession.deleteMany({ where: { id: { in: authSessions.map((entry) => entry.id) } } });
    if (createdUserId) await prisma.user.delete({ where: { id: createdUserId } });
    await prisma.saleShipment.delete({ where: { id: shipment.id } }); await prisma.sale.delete({ where: { id: sale.id } });
    await prisma.stockMovement.deleteMany({ where: { productId: product.id } }); await prisma.expense.deleteMany({ where: { number: { startsWith: `E-${suffix}` } } });
    await prisma.stockTakeSession.deleteMany({ where: { id: { in: sessions.map((entry) => entry.id) } } }); await prisma.product.delete({ where: { id: product.id } });
    await prisma.staff.delete({ where: { id: staff.id } }); await prisma.warehouse.delete({ where: { id: other.id } }); await prisma.$disconnect();
  }
});
