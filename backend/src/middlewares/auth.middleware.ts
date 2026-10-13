
import "dotenv/config";

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import type {
  Request,
  RequestHandler,
} from "express";

import { prisma } from "../lib/prisma.ts";
import { AppError } from "../utils/AppError.ts";

export const SESSION_COOKIE = "stockflow_session";

const secret = process.env.SESSION_SECRET ?? "";

if (secret.length < 32) {
  throw new Error(
    "SESSION_SECRET must contain at least 32 characters"
  );
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api",
};

export type AuthContext = {
  userId: string;
  sessionId: string;
  permissions: string[];
  csrfToken: string;
};

type AuthorizedRequest = Request & {
  auth?: AuthContext;
};

export function hashSessionToken(token: string) {
  return createHash("sha256")
    .update(token)
    .digest("hex");
}

export function createCsrfToken(sessionId: string) {
  return createHmac("sha256", secret)
    .update(`csrf:${sessionId}`)
    .digest("hex");
}

function readSessionCookie(req: Request): string | null {
  const rawCookies = req.headers.cookie;

  if (!rawCookies) return null;

  const items = rawCookies.split(";");

  for (const item of items) {
    const [name, ...values] = item.trim().split("=");

    if (name === SESSION_COOKIE) {
      try {
        return decodeURIComponent(values.join("="));
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function authOf(req: Request): AuthContext {
  const auth = (req as AuthorizedRequest).auth;

  if (!auth) {
    throw new AppError(401, "Unauthorized");
  }

  return auth;
}

// ==========================================
// VERIFY SESSION
// ==========================================

export const requireAuth: RequestHandler = async (
  req,
  _res,
  next
) => {
  try {
    const token = readSessionCookie(req);

    if (!token) {
      throw new AppError(401, "Please login first");
    }

    const session = await prisma.authSession.findUnique({
      where: {
        tokenHash: hashSessionToken(token),
      },
      include: {
        user: {
          include: {
            staff: {
              select: {
                isActive: true,
              },
            },
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!session || session.expiresAt <= new Date()) {
      throw new AppError(
        401,
        "Session expired. Please login again."
      );
    }

    if (
      !session.user.isActive ||
      !session.user.role.isActive ||
      session.user.staff?.isActive === false
    ) {
      throw new AppError(
        403,
        "Account or role is inactive"
      );
    }

    (req as AuthorizedRequest).auth = {
      userId: session.userId,
      sessionId: session.id,
      csrfToken: createCsrfToken(session.id),
      permissions: session.user.role.permissions.map(
        (item) => item.permission.key
      ),
    };

    next();
  } catch (error) {
    next(error);
  }
};

// ==========================================
// VERIFY PERMISSIONS
// ==========================================

export function requirePermission(
  ...permissionKeys: string[]
): RequestHandler {
  return (req, _res, next) => {
    try {
      const auth = authOf(req);

      const allowed = permissionKeys.some((key) =>
        auth.permissions.includes(key)
      );

      if (!allowed) {
        throw new AppError(
          403,
          "You do not have permission to perform this action"
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

// ==========================================
// PROTECT CRUD MODULES
// ==========================================

export function protectModule(
  moduleName: string
): RequestHandler {
  return (req, res, next) => {
    const action =
      req.method === "GET" || req.method === "HEAD"
        ? "read"
        : req.method === "DELETE"
          ? "delete"
          : "write";

    return requirePermission(
      `${moduleName}.${action}`
    )(req, res, next);
  };
}

// ==========================================
// CSRF PROTECTION
// ==========================================

export const requireCsrf: RequestHandler = (
  req,
  _res,
  next
) => {
  try {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      next();
      return;
    }

    const actual = Buffer.from(
      req.get("X-CSRF-Token") ?? ""
    );

    const expected = Buffer.from(authOf(req).csrfToken);

    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new AppError(403, "Invalid CSRF token");
    }

    next();
  } catch (error) {
    next(error);
  }
};

// ==========================================
// VERIFY REQUEST ORIGIN
// ==========================================

export const requireAllowedOrigin: RequestHandler = (
  req,
  _res,
  next
) => {
  try {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      next();
      return;
    }

    const allowedOrigin = (
      process.env.FRONTEND_URL ??
      "http://localhost:3000"
    ).replace(/\/$/, "");

    const origin = req.get("Origin");

    if (origin !== allowedOrigin) {
      throw new AppError(
        403,
        "Invalid request origin"
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};
