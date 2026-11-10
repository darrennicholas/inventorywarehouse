import "dotenv/config";

import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import test from "node:test";

const enabled = process.env.RUN_INTEGRATION_TESTS === "true" && /test/i.test(new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled").pathname);

test("idempotency replays a completed mutation, rejects key reuse, and prevents duplicate concurrent writes", { skip: !enabled }, async () => {
  const { prisma } = await import("../src/lib/prisma.ts");
  const { default: app } = await import("../src/app.ts");
  const { createCsrfToken, hashSessionToken } = await import("../src/middlewares/auth.middleware.ts");

  const admin = await prisma.user.findFirstOrThrow({ where: { role: { code: "ADMIN" }, isActive: true } });
  const token = randomUUID();
  const session = await prisma.authSession.create({ data: { userId: admin.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) } });
  const suffix = randomUUID().slice(0, 8);
  const replayKey = `replay-${randomUUID()}`;
  const raceKey = `race-${randomUUID()}`;
  const validationKey = `valid-${randomUUID()}`;
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  async function post(key: string | null, body: unknown) {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/categories`, {
      method: "POST",
      headers: {
        cookie: `stockflow_session=${token}`,
        origin: (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, ""),
        "x-csrf-token": createCsrfToken(session.id),
        "content-type": "application/json",
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as { data?: { id: string }; message?: string } };
  }

  const categoryNames: string[] = [];
  try {
    const missingKey = await post(null, { name: `Idempotency missing ${suffix}` });
    assert.equal(missingKey.status, 400);
    assert.match(missingKey.body.message ?? "", /Idempotency-Key is required/i);

    const replayName = `Idempotency replay ${suffix}`;
    categoryNames.push(replayName);
    const payload = { name: replayName, description: "Created once with a replayed response" };
    const first = await post(replayKey, payload);
    const replay = await post(replayKey, { description: payload.description, name: payload.name });
    assert.equal(first.status, 201, first.body.message);
    assert.equal(replay.status, 201, replay.body.message);
    assert.deepEqual(replay.body, first.body, "retry should return the stored response");
    assert.equal(await prisma.category.count({ where: { name: replayName } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { entity: "Category", entityId: first.body.data!.id, action: "CREATE" } }), 1);

    const conflicting = await post(replayKey, { name: `${replayName} changed` });
    assert.equal(conflicting.status, 409);
    assert.match(conflicting.body.message ?? "", /different request/i);
    assert.equal(await prisma.category.count({ where: { name: { startsWith: replayName } } }), 1);

    const correctedName = `Idempotency corrected ${suffix}`;
    categoryNames.push(correctedName);
    const invalid = await post(validationKey, { name: "" });
    assert.equal(invalid.status, 422);
    const corrected = await post(validationKey, { name: correctedName });
    assert.equal(corrected.status, 201, corrected.body.message);
    assert.equal(await prisma.category.count({ where: { name: correctedName } }), 1, "a rolled-back validation error should release its idempotency claim");

    const concurrentName = `Idempotency concurrent ${suffix}`;
    categoryNames.push(concurrentName);
    const concurrentPayload = { name: concurrentName };
    const concurrent = await Promise.all([post(raceKey, concurrentPayload), post(raceKey, concurrentPayload)]);
    assert.ok(concurrent.every((result) => result.status === 201 || result.status === 409), JSON.stringify(concurrent.map((result) => result.status)));
    assert.equal(await prisma.category.count({ where: { name: concurrentName } }), 1, "concurrent retry must create one record");
    const concurrentId = concurrent.find((result) => result.status === 201)?.body.data?.id;
    assert.ok(concurrentId);
    assert.equal(await prisma.auditLog.count({ where: { entity: "Category", entityId: concurrentId, action: "CREATE" } }), 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const categories = await prisma.category.findMany({ where: { name: { in: categoryNames } }, select: { id: true } });
    const ids = categories.map((category) => category.id);
    await prisma.notification.deleteMany({ where: { entity: "Category", entityId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entity: "Category", entityId: { in: ids } } });
    await prisma.category.deleteMany({ where: { id: { in: ids } } });
    await prisma.idempotencyKey.deleteMany({ where: { userId: admin.id, key: { in: [replayKey, raceKey, validationKey] } } });
    await prisma.authSession.delete({ where: { id: session.id } });
    await prisma.$disconnect();
  }
});

test("idempotency retry does not duplicate purchase receipt stock or payment", { skip: !enabled }, async () => {
  const { prisma } = await import("../src/lib/prisma.ts");
  const { default: app } = await import("../src/app.ts");
  const { createCsrfToken, hashSessionToken } = await import("../src/middlewares/auth.middleware.ts");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { code: "ADMIN" }, isActive: true } });
  const token = randomUUID();
  const session = await prisma.authSession.create({ data: { userId: admin.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) } });
  const suffix = randomUUID().slice(0, 8);
  const receiptNumber = `IT-GR-${suffix}`;
  const purchaseNumber = `IT-RETRY-PO-${suffix}`;
  const paymentNumber = `IT-RETRY-PAY-${suffix}`;
  const receiptKey = `receipt-${randomUUID()}`;
  const paymentKey = `payment-${randomUUID()}`;
  const paymentRaceKeys = [`payment-race-${randomUUID()}`, `payment-race-${randomUUID()}`];
  const warehouse = await prisma.warehouse.create({ data: { code: `IT-WH-${suffix}`, name: `Idempotency warehouse ${suffix}` } });
  const supplier = await prisma.supplier.create({ data: { code: `IT-SUP-${suffix}`, name: `Idempotency supplier ${suffix}` } });
  const product = await prisma.product.create({ data: { sku: `IT-SKU-${suffix}`, name: `Idempotency product ${suffix}` } });
  const purchase = await prisma.purchaseOrder.create({ data: {
    number: purchaseNumber,
    supplierId: supplier.id,
    warehouseId: warehouse.id,
    createdById: admin.id,
    approvedById: admin.id,
    approvedAt: new Date(),
    status: "APPROVED",
    subtotal: 50,
    total: 50,
    items: { create: { productId: product.id, quantity: 5, unitPrice: 10, total: 50 } },
  } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  async function post(path: string, key: string, body: unknown) {
    const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      method: "POST",
      headers: {
        cookie: `stockflow_session=${token}`,
        origin: (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, ""),
        "x-csrf-token": createCsrfToken(session.id),
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as { data?: { id?: string; status?: string }; message?: string } };
  }

  try {
    const receiptPayload = { receiptNumber, items: [{ productId: product.id, quantity: 3, damagedQuantity: 0 }] };
    const firstReceipt = await post(`/operations/purchases/${purchase.id}/receive`, receiptKey, receiptPayload);
    assert.equal(firstReceipt.status, 200, firstReceipt.body.message);
    const retriedReceipt = await post(`/operations/purchases/${purchase.id}/receive`, receiptKey, receiptPayload);
    assert.equal(retriedReceipt.status, 200, retriedReceipt.body.message);
    assert.deepEqual(retriedReceipt.body, firstReceipt.body);
    assert.equal(await prisma.goodsReceipt.count({ where: { number: receiptNumber } }), 1);
    assert.equal(await prisma.stockMovement.count({ where: { purchaseOrderId: purchase.id, movementType: "PURCHASE_RECEIPT" } }), 1);
    const balance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } } });
    assert.equal(balance.quantityOnHand, 3);

    const paymentPayload = { number: paymentNumber, type: "PURCHASE", purchaseOrderId: purchase.id, amount: 20, method: "CASH", status: "PAID" };
    const firstPayment = await post("/operations/payments", paymentKey, paymentPayload);
    assert.equal(firstPayment.status, 201, firstPayment.body.message);
    const retriedPayment = await post("/operations/payments", paymentKey, paymentPayload);
    assert.equal(retriedPayment.status, 201, retriedPayment.body.message);
    assert.deepEqual(retriedPayment.body, firstPayment.body);
    assert.equal(await prisma.payment.count({ where: { number: paymentNumber } }), 1);
    const paymentRaces = await Promise.all(paymentRaceKeys.map((key, index) => post("/operations/payments", key, {
      number: `IT-RETRY-RACE-${suffix}-${index}`,
      type: "PURCHASE",
      purchaseOrderId: purchase.id,
      amount: 20,
      method: "CASH",
      status: "PAID",
    })));
    assert.equal(paymentRaces.filter((result) => result.status === 201).length, 1, "only one concurrent payment may consume the remaining invoice balance");
    assert.equal(paymentRaces.filter((result) => result.status === 409).length, 1);
    const paid = await prisma.payment.aggregate({ where: { purchaseOrderId: purchase.id, status: "PAID" }, _sum: { amount: true } });
    assert.equal(Number(paid._sum.amount), 40);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const createdPayments = await prisma.payment.findMany({ where: { purchaseOrderId: purchase.id }, select: { id: true } });
    const entityIds = [purchase.id, ...createdPayments.map((payment) => payment.id)];
    await prisma.notification.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.idempotencyKey.deleteMany({ where: { userId: admin.id, key: { in: [receiptKey, paymentKey, ...paymentRaceKeys] } } });
    await prisma.payment.deleteMany({ where: { purchaseOrderId: purchase.id } });
    await prisma.goodsReceipt.deleteMany({ where: { purchaseOrderId: purchase.id } });
    await prisma.stockMovementAllocation.deleteMany({ where: { movement: { purchaseOrderId: purchase.id } } });
    await prisma.stockMovement.deleteMany({ where: { purchaseOrderId: purchase.id } });
    await prisma.inventoryLocationBalance.deleteMany({ where: { productId: product.id } });
    await prisma.inventoryBalance.deleteMany({ where: { productId: product.id } });
    await prisma.purchaseOrder.delete({ where: { id: purchase.id } });
    await prisma.warehouseLocation.deleteMany({ where: { warehouseId: warehouse.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.supplier.delete({ where: { id: supplier.id } });
    await prisma.warehouse.delete({ where: { id: warehouse.id } });
    await prisma.authSession.delete({ where: { id: session.id } });
    await prisma.$disconnect();
  }
});
