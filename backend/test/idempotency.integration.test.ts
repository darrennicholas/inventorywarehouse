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
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  async function post(key: string, body: unknown) {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/categories`, {
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
    return { status: response.status, body: await response.json() as { data?: { id: string }; message?: string } };
  }

  const categoryNames: string[] = [];
  try {
    const replayName = `Idempotency replay ${suffix}`;
    categoryNames.push(replayName);
    const payload = { name: replayName, description: "Created once with a replayed response" };
    const first = await post(replayKey, payload);
    const replay = await post(replayKey, payload);
    assert.equal(first.status, 201, first.body.message);
    assert.equal(replay.status, 201, replay.body.message);
    assert.deepEqual(replay.body, first.body, "retry should return the stored response");
    assert.equal(await prisma.category.count({ where: { name: replayName } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { entity: "Category", entityId: first.body.data!.id, action: "CREATE" } }), 1);

    const conflicting = await post(replayKey, { name: `${replayName} changed` });
    assert.equal(conflicting.status, 409);
    assert.match(conflicting.body.message ?? "", /different request/i);
    assert.equal(await prisma.category.count({ where: { name: { startsWith: replayName } } }), 1);

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
    await prisma.idempotencyKey.deleteMany({ where: { userId: admin.id, key: { in: [replayKey, raceKey] } } });
    await prisma.authSession.delete({ where: { id: session.id } });
    await prisma.$disconnect();
  }
});
