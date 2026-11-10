import { createHash } from "node:crypto";
import type { RequestHandler, Response } from "express";

import { Prisma } from "../generated/prisma/client.ts";
import { prisma } from "../lib/prisma.ts";
import { authOf } from "./auth.middleware.ts";
import { AppError } from "../utils/AppError.ts";

const ttlMs = 24 * 60 * 60 * 1000;
const cleanupIntervalMs = 15 * 60 * 1000;
let lastCleanupAt = 0;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

function bodyHash(body: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(body ?? null))).digest("hex");
}

function responseReplay(res: Response, status: number, body: unknown) {
  return res.status(status).json(body);
}

export const requireIdempotency: RequestHandler = async (req, res, next) => {
  const key = req.get("Idempotency-Key")?.trim();
  if (!key) {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      next(new AppError(400, "Idempotency-Key is required for write requests"));
      return;
    }
    next();
    return;
  }
  if (key.length < 8 || key.length > 160) {
    next(new AppError(400, "Idempotency-Key must contain between 8 and 160 characters"));
    return;
  }

  try {
    const auth = authOf(req);
    const hash = bodyHash(req.body);
    const now = new Date();
    if (Date.now() - lastCleanupAt >= cleanupIntervalMs) {
      lastCleanupAt = Date.now();
      void prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => {
        // Expired rows are also removed lazily below; cleanup is best-effort.
        lastCleanupAt = 0;
      });
    }
    let existing = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId: auth.userId, key } } });
    if (existing && existing.expiresAt <= now) {
      await prisma.idempotencyKey.deleteMany({ where: { id: existing.id, expiresAt: { lte: now } } });
      existing = null;
    }
    if (existing) {
      if (existing.method !== req.method || existing.path !== req.originalUrl || existing.requestHash !== hash) {
        throw new AppError(409, "Idempotency-Key was already used for a different request");
      }
      if (existing.responseStatus === 0) throw new AppError(409, "The same request is already being processed");
      responseReplay(res, existing.responseStatus, existing.responseBody);
      return;
    }

    try {
      await prisma.idempotencyKey.create({ data: { key, userId: auth.userId, method: req.method, path: req.originalUrl, requestHash: hash, responseStatus: 0, responseBody: {}, expiresAt: new Date(Date.now() + ttlMs) } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      throw new AppError(409, "The same request is already being processed");
    }

    const originalJson = res.json.bind(res);
    let responseStarted = false;
    res.json = ((body: unknown) => {
      if (responseStarted) return res;
      responseStarted = true;
      const status = res.statusCode;
      void (async () => {
        try {
          if (status >= 400 && status < 500) {
            // Validation and business conflicts roll back/no-op; allow a corrected request to use a fresh key.
            await prisma.idempotencyKey.deleteMany({ where: { userId: auth.userId, key } });
          } else {
            const responseBody = JSON.parse(JSON.stringify(body ?? null)) as never;
            await prisma.idempotencyKey.update({ where: { userId_key: { userId: auth.userId, key } }, data: { responseStatus: status, responseBody } });
          }
          res.json = originalJson;
          originalJson(body);
        } catch {
          // Never call next() while the intercepted res.json is installed: the
          // global error handler also uses res.json and would recursively retry.
          // Keep the pending key so a client cannot repeat a mutation whose
          // database outcome is uncertain.
          res.json = originalJson;
          res.status(503);
          originalJson({
            success: false,
            message: "The request outcome could not be recorded. Check the transaction before trying again with a new key.",
            ...(res.locals.requestId ? { requestId: res.locals.requestId } : {}),
          });
        }
      })();
      return res;
    }) as typeof res.json;
    next();
  } catch (error) {
    next(error);
  }
};
