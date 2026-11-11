import "dotenv/config";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import test from "node:test";

const enabled = process.env.RUN_INTEGRATION_TESTS === "true" && /test/i.test(new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled").pathname);

test("rejected stock documents are revised and approved with an audit trail", { skip: !enabled }, async () => {
  const { prisma } = await import("../src/lib/prisma.ts");
  const { default: app } = await import("../src/app.ts");
  const { hashSessionToken, createCsrfToken } = await import("../src/middlewares/auth.middleware.ts");
  const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: "WAREHOUSE_MANAGER" } });
  const creator = await prisma.user.create({ data: { email: `integration-${randomUUID()}@example.test`, fullName: "Integration creator", passwordHash: "unused", roleId: managerRole.id } });
  const reviewer = await prisma.user.findFirstOrThrow({ where: { role: { code: "ADMIN" }, isActive: true } });
  const tokens = [randomUUID(), randomUUID()];
  const sessions = await Promise.all([creator, reviewer].map((user, i) => prisma.authSession.create({ data: { userId: user.id, tokenHash: hashSessionToken(tokens[i]), expiresAt: new Date(Date.now() + 3600000) } })));
  const suffix = randomUUID().slice(0, 8);
  const [from, to] = await Promise.all(["A", "B"].map((x) => prisma.warehouse.create({ data: { code: `IT-${x}-${suffix}`, name: `Test warehouse ${x}` } })));
  const [source, destination] = await Promise.all([from, to].map((warehouse) => prisma.warehouseLocation.create({ data: { warehouseId: warehouse.id, code: "A", name: "Test location" } })));
  const product = await prisma.product.create({ data: { sku: `IT-${suffix}`, name: "Integration product" } });
  await prisma.inventoryBalance.create({ data: { productId: product.id, warehouseId: from.id, quantityOnHand: 5, averageUnitCost: 2, locationId: source.id } });
  await prisma.inventoryLocationBalance.create({ data: { productId: product.id, warehouseId: from.id, locationId: source.id, quantityOnHand: 5 } });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const port = address.port;
  async function request(path: string, user: number, method = "GET", body?: unknown) {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, headers: { cookie: `stockflow_session=${tokens[user]}`, origin: (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, ""), "x-csrf-token": createCsrfToken(sessions[user].id), "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as { data?: { id: string; status: string }; message?: string } };
  }
  async function getWorkflowActions(id: string, user: number) {
    const response = await fetch(`http://127.0.0.1:${port}/api/operations/workflow/adjustments/${id}/history`, { headers: { cookie: `stockflow_session=${tokens[user]}` } });
    return { status: response.status, body: await response.json() as { actions?: string[]; message?: string } };
  }
  let adjustmentId = "", transferId = "";
  try {
    const adjustment = { number: `IT-ADJ-${suffix}`, warehouseId: from.id, type: "DECREASE", status: "DRAFT", reason: "Physical count", items: [{ productId: product.id, quantity: 2, locationId: source.id, batchId: null }] };
    const created = await request("/operations/adjustments", 0, "POST", adjustment); assert.equal(created.status, 201, created.body.message ?? "Adjustment creation failed"); adjustmentId = created.body.data!.id;
    assert.deepEqual((await getWorkflowActions(adjustmentId, 0)).body.actions, []);
    const reviewerActions = await getWorkflowActions(adjustmentId, 1); assert.equal(reviewerActions.status, 200, reviewerActions.body.message ?? "Loading workflow actions failed"); assert.deepEqual(reviewerActions.body.actions, ["approve", "reject"]);
    assert.equal((await request(`/operations/workflow/adjustments/${adjustmentId}/reject`, 0, "POST", { reason: "Incorrect quantity" })).status, 403);
    assert.equal((await request(`/operations/workflow/adjustments/${adjustmentId}/reject`, 1, "POST", { reason: "Incorrect quantity" })).status, 200);
    assert.equal((await request(`/operations/adjustments/${adjustmentId}/approve`, 1, "POST")).status, 409);
    assert.equal((await request(`/operations/adjustments/${adjustmentId}`, 0, "PATCH", { status: "DRAFT" })).status, 409);
    const revised = { ...adjustment, items: [{ ...adjustment.items[0], quantity: 1 }] };
    assert.equal((await request(`/operations/adjustments/${adjustmentId}/revise`, 1, "POST", revised)).status, 403);
    assert.equal((await request(`/operations/adjustments/${adjustmentId}/revise`, 0, "POST", revised)).status, 200);
    assert.equal((await prisma.inventoryBalance.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: from.id } } })).quantityOnHand, 5);
    assert.equal((await request(`/operations/adjustments/${adjustmentId}/approve`, 1, "POST")).status, 200);
    assert.equal((await prisma.inventoryBalance.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: from.id } } })).quantityOnHand, 4);
    const transfer = { number: `IT-TRF-${suffix}`, fromWarehouseId: from.id, toWarehouseId: to.id, status: "DRAFT", notes: "Transfer", items: [{ productId: product.id, quantity: 2, sourceLocationId: source.id, destinationLocationId: destination.id, batchId: null }] };
    const made = await request("/operations/transfers", 0, "POST", transfer); assert.equal(made.status, 201, made.body.message ?? "Transfer creation failed"); transferId = made.body.data!.id;
    assert.equal((await request(`/operations/workflow/transfers/${transferId}/reject`, 1, "POST", { reason: "Incorrect quantity" })).status, 200);
    assert.equal((await request(`/operations/transfers/${transferId}/revise`, 0, "POST", { ...transfer, items: [{ ...transfer.items[0], quantity: 1 }] })).status, 200);
    assert.equal((await request(`/operations/transfers/${transferId}/approve`, 1, "POST")).status, 200);
    assert.equal((await request(`/operations/transfers/${transferId}`, 0, "PATCH", { status: "COMPLETED" })).status, 200);
    assert.equal((await prisma.inventoryBalance.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: from.id } } })).quantityOnHand, 3);
    assert.equal((await prisma.inventoryBalance.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: to.id } } })).quantityOnHand, 1);
    for (const id of [adjustmentId, transferId]) assert.equal(await prisma.auditLog.count({ where: { entityId: id, action: "RESUBMIT" } }), 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.notification.deleteMany({ where: { entityId: { in: [adjustmentId, transferId] } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [adjustmentId, transferId] } } });
    await prisma.stockMovementAllocation.deleteMany({ where: { movement: { productId: product.id } } });
    await prisma.stockMovement.deleteMany({ where: { productId: product.id } });
    await prisma.stockAdjustment.deleteMany({ where: { id: adjustmentId || undefined, warehouseId: from.id } });
    await prisma.stockTransfer.deleteMany({ where: { id: transferId || undefined, fromWarehouseId: from.id } });
    await prisma.inventoryLocationBalance.deleteMany({ where: { productId: product.id } });
    await prisma.inventoryBalance.deleteMany({ where: { productId: product.id } });
    await prisma.warehouseLocation.deleteMany({ where: { id: { in: [source.id, destination.id] } } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.warehouse.deleteMany({ where: { id: { in: [from.id, to.id] } } });
    await prisma.authSession.deleteMany({ where: { id: { in: sessions.map((session) => session.id) } } });
    await prisma.notification.deleteMany({ where: { userId: creator.id } });
    await prisma.user.delete({ where: { id: creator.id } });
    await prisma.$disconnect();
  }
});
