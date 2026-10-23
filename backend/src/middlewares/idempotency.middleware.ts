import { createHash } from "node:crypto";
import type { RequestHandler, Response } from "express";

import { Prisma } from "../generated/prisma/client.ts";
import { prisma } from "../lib/prisma.ts";
import { authOf } from "./auth.middleware.ts";
import { AppError } from "../utils/AppError.ts";

const ttlMs = 24 * 60 * 60 * 1000;

function bodyHash(body: unknown) {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

function responseReplay(res: Response, status: number, body: unknown) {
  return res.status(status).json(body);
}

export const requireIdempotency: RequestHandler = async (req, res, next) => {
  const key = req.get("Idempotency-Key")?.trim();
  if (!key) {
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
    await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const existing = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId: auth.userId, key } } });
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
    res.json = ((body: unknown) => {
      void prisma.idempotencyKey.update({ where: { userId_key: { userId: auth.userId, key } }, data: { responseStatus: res.statusCode, responseBody: body as never } })
        .then(() => originalJson(body))
        .catch((error) => next(error));
      return res;
    }) as typeof res.json;

    res.once("finish", () => {
      if (res.statusCode >= 400) void prisma.idempotencyKey.deleteMany({ where: { userId: auth.userId, key } });
    });
    next();
  } catch (error) {
    next(error);
  }
};
