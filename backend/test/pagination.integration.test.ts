import "dotenv/config";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import test from "node:test";

const enabled = process.env.RUN_INTEGRATION_TESTS === "true" && /test/i.test(new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled").pathname);
test("master data and quarantine queues page and search in the database", { skip: !enabled }, async () => {
  const { prisma } = await import("../src/lib/prisma.ts");
  const { default: app } = await import("../src/app.ts");
  const { hashSessionToken } = await import("../src/middlewares/auth.middleware.ts");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { code: "ADMIN" }, isActive: true } });
  const token = randomUUID(); const session = await prisma.authSession.create({ data: { userId: admin.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) } });
  const key = `P${randomUUID().slice(0, 8)}`;
  const warehouses = await Promise.all([1, 2].map((n) => prisma.warehouse.create({ data: { code: `${key}-${n}`, name: `${key} warehouse ${n}` } })));
  const location = await prisma.warehouseLocation.create({ data: { warehouseId: warehouses[0].id, code: "Q", name: "Quarantine", locationType: "QUARANTINE" } });
  await Promise.all([1, 2].flatMap((n) => [prisma.category.create({ data: { name: `${key} category ${n}` } }), prisma.brand.create({ data: { name: `${key} brand ${n}` } }), prisma.unit.create({ data: { code: `${key}-${n}`, name: `${key} unit ${n}` } }), prisma.customer.create({ data: { code: `${key}-${n}`, name: `${key} customer ${n}` } }), prisma.supplier.create({ data: { code: `${key}-${n}`, name: `${key} supplier ${n}` } }), prisma.staff.create({ data: { staffCode: `${key}-${n}`, fullName: `${key} staff ${n}` } })]));
  const products = await Promise.all(Array.from({ length: 22 }, (_, n) => prisma.product.create({ data: { sku: `${key}-${n}`, name: `${key} product ${n}` } })));
  await prisma.inventoryLocationBalance.createMany({ data: products.map((product) => ({ productId: product.id, warehouseId: warehouses[0].id, locationId: location.id, quantityOnHand: 1 })) });
  const sourceBalance = await prisma.inventoryLocationBalance.findFirstOrThrow({ where: { locationId: location.id } });
  await prisma.quarantineDecision.createMany({ data: Array.from({ length: 22 }, () => ({ locationBalanceId: sourceBalance.id, quantity: 1, action: "SCRAP" as const, reason: "Integration fixture", createdById: admin.id })) });
  await prisma.stockTransfer.createMany({ data: Array.from({ length: 22 }, (_, n) => ({ number: `${key}-T-${n}`, fromWarehouseId: warehouses[0].id, toWarehouseId: warehouses[1].id, createdById: admin.id, status: "IN_TRANSIT" as const, updatedAt: new Date("2000-01-01T00:00:00Z") })) });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  async function get(path: string) { const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { headers: { cookie: `stockflow_session=${token}` } }); assert.equal(response.status, 200); return response.json() as Promise<{ data: unknown; meta: { total: number } }>; }
  try {
    for (const resource of ["categories", "brands", "units", "customers", "suppliers", "staff", "warehouses"]) {
      const first = await get(`/${resource}?page=1&pageSize=1&search=${key}`); const second = await get(`/${resource}?page=2&pageSize=1&search=${key}`);
      assert.equal(first.meta.total, 2, resource); assert.equal((first.data as unknown[]).length, 1); assert.equal((second.data as unknown[]).length, 1); assert.notDeepEqual(first.data, second.data);
    }
    const productsPage = await get(`/products?page=2&pageSize=10&search=${key}`); assert.equal(productsPage.meta.total, 22); assert.equal((productsPage.data as unknown[]).length, 10);
    const queue = await get(`/operations/quarantine?warehouseId=${warehouses[0].id}&page=2&search=${key}`) as unknown as { data: { rows: unknown[]; rowMeta: { total: number } } };
    assert.equal(queue.data.rowMeta.total, 22); assert.equal(queue.data.rows.length, 2);
    const decisions = await get(`/operations/quarantine?warehouseId=${warehouses[0].id}&decisionPage=2`) as unknown as { data: { decisions: unknown[]; decisionMeta: { total: number } } }; assert.equal(decisions.data.decisionMeta.total, 22); assert.equal(decisions.data.decisions.length, 2);
    const attention = await get(`/operations/attention?kind=transfers&page=2&search=${key}`) as unknown as { data: { rows: unknown[]; total: number } }; assert.equal(attention.data.total, 22); assert.equal(attention.data.rows.length, 2);
    const valuation = await get(`/operations/valuation-profit?warehouseId=${warehouses[0].id}&from=2000-01-01&to=2000-01-31`) as unknown as { data: { inventoryValue: string | null; historicalSnapshotAvailable: boolean; inventoryValuationSource: string } }; assert.equal(valuation.data.inventoryValue, null); assert.equal(valuation.data.historicalSnapshotAvailable, false); assert.equal(valuation.data.inventoryValuationSource, "UNAVAILABLE");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.quarantineDecision.deleteMany({ where: { locationBalanceId: sourceBalance.id } });
    await prisma.stockTransfer.deleteMany({ where: { fromWarehouseId: warehouses[0].id } });
    await prisma.inventoryLocationBalance.deleteMany({ where: { locationId: location.id } });
    await prisma.product.deleteMany({ where: { id: { in: products.map((product) => product.id) } } });
    await prisma.warehouseLocation.delete({ where: { id: location.id } });
    await prisma.warehouse.deleteMany({ where: { id: { in: warehouses.map((warehouse) => warehouse.id) } } });
    await prisma.category.deleteMany({ where: { name: { startsWith: key } } });
    await prisma.brand.deleteMany({ where: { name: { startsWith: key } } });
    await prisma.unit.deleteMany({ where: { code: { startsWith: key } } });
    await prisma.customer.deleteMany({ where: { code: { startsWith: key } } });
    await prisma.supplier.deleteMany({ where: { code: { startsWith: key } } });
    await prisma.staff.deleteMany({ where: { staffCode: { startsWith: key } } });
    await prisma.authSession.delete({ where: { id: session.id } }); await prisma.$disconnect();
  }
});
