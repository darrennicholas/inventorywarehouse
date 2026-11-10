import "dotenv/config";

import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import test from "node:test";

const enabled = process.env.RUN_INTEGRATION_TESTS === "true" && /test/i.test(new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled").pathname);

test("product create, update, and deactivate write before/after audit snapshots", { skip: !enabled }, async () => {
  const { prisma } = await import("../src/lib/prisma.ts");
  const { default: app } = await import("../src/app.ts");
  const { createCsrfToken, hashSessionToken } = await import("../src/middlewares/auth.middleware.ts");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { code: "ADMIN" }, isActive: true } });
  const token = randomUUID();
  const session = await prisma.authSession.create({ data: { userId: admin.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) } });
  const suffix = randomUUID().slice(0, 8);
  let productId = "";
  const idempotencyKeys: string[] = [];
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  async function request(method: string, path: string, body?: unknown) {
    const idempotencyKey = randomUUID();
    idempotencyKeys.push(idempotencyKey);
    const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      method,
      headers: {
        cookie: `stockflow_session=${token}`,
        origin: (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, ""),
        "x-csrf-token": createCsrfToken(session.id),
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as { data?: { id: string }; message?: string } };
  }

  try {
    const created = await request("POST", "/products", { sku: `AUDIT-${suffix}`, name: `Audit product ${suffix}` });
    assert.equal(created.status, 201, created.body.message);
    productId = created.body.data!.id;
    const updated = await request("PATCH", `/products/${productId}`, { name: `Updated audit product ${suffix}` });
    assert.equal(updated.status, 200, updated.body.message);
    const deactivated = await request("DELETE", `/products/${productId}`);
    assert.equal(deactivated.status, 200, deactivated.body.message);

    const logs = await prisma.auditLog.findMany({ where: { entity: "Product", entityId: productId }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(logs.map((log) => log.action), ["CREATE", "UPDATE", "DEACTIVATE"]);
    assert.equal((logs[1]?.beforeData as { name?: string }).name, `Audit product ${suffix}`);
    assert.equal((logs[1]?.afterData as { name?: string }).name, `Updated audit product ${suffix}`);
    assert.equal((logs[2]?.beforeData as { isActive?: boolean }).isActive, true);
    assert.equal((logs[2]?.afterData as { isActive?: boolean }).isActive, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (productId) {
      await prisma.notification.deleteMany({ where: { entity: "Product", entityId: productId } });
      await prisma.auditLog.deleteMany({ where: { entity: "Product", entityId: productId } });
      await prisma.product.delete({ where: { id: productId } });
    }
    await prisma.idempotencyKey.deleteMany({ where: { userId: admin.id, key: { in: idempotencyKeys } } });
    await prisma.authSession.delete({ where: { id: session.id } });
    await prisma.$disconnect();
  }
});
