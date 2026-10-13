
import { randomBytes } from "node:crypto";

import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { prisma } from "../../lib/prisma.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";

import {
  authOf,
  createCsrfToken,
  hashSessionToken,
  requireAllowedOrigin,
  requireAuth,
  requireCsrf,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "../../middlewares/auth.middleware.ts";

const router = Router();

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const loginSchema = z.object({
  email: z.string()
    .trim()
    .toLowerCase()
    .pipe(z.email()),
  password: z.string().min(1),
}).strict();

const userSelect = {
  id: true,
  fullName: true,
  email: true,
  isActive: true,
  staff: {
    select: {
      id: true,
      staffCode: true,
      fullName: true,
      warehouseId: true,
    },
  },
  role: {
    select: {
      id: true,
      code: true,
      name: true,
      permissions: {
        select: {
          permission: {
            select: {
              key: true,
            },
          },
        },
      },
    },
  },
} as const;

type SelectedUser = {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  staff: {
    id: string;
    staffCode: string;
    fullName: string;
    warehouseId: string | null;
  } | null;
  role: {
    id: string;
    code: string;
    name: string;
    permissions: {
      permission: {
        key: string;
      };
    }[];
  };
};

function serializeUser(user: SelectedUser) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    isActive: user.isActive,
    staff: user.staff,
    role: {
      id: user.role.id,
      code: user.role.code,
      name: user.role.name,
    },
    permissions: user.role.permissions.map(
      (item) => item.permission.key
    ),
  };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts",
  },
});

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// ==========================================
// POST /api/auth/login
// ==========================================

router.post(
  "/login",
  requireAllowedOrigin,
  loginLimiter,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: {
        email: input.email,
      },
      include: {
        role: true,
        staff: {
          select: {
            isActive: true,
          },
        },
      },
    });

    if (
      !user ||
      !user.isActive ||
      !user.role.isActive ||
      user.staff?.isActive === false ||
      !(await bcrypt.compare(
        input.password,
        user.passwordHash
      ))
    ) {
      throw new AppError(
        401,
        "Invalid email or password"
      );
    }

    const token = randomBytes(32)
      .toString("base64url");

    const session = await prisma.authSession.create({
      data: {
        tokenHash: hashSessionToken(token),
        userId: user.id,
        expiresAt: new Date(
          Date.now() + SESSION_MAX_AGE
        ),
      },
    });

    const currentUser =
      await prisma.user.findUniqueOrThrow({
        where: {
          id: user.id,
        },
        select: userSelect,
      });

    res.cookie(SESSION_COOKIE, token, {
      ...sessionCookieOptions,
      maxAge: SESSION_MAX_AGE,
    });

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: serializeUser(currentUser),
        csrfToken: createCsrfToken(session.id),
      },
    });
  })
);

// ==========================================
// GET /api/auth/me
// ==========================================

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = authOf(req);

    const currentUser =
      await prisma.user.findUniqueOrThrow({
        where: {
          id: auth.userId,
        },
        select: userSelect,
      });

    res.status(200).json({
      success: true,
      data: {
        user: serializeUser(currentUser),
        csrfToken: auth.csrfToken,
      },
    });
  })
);

// ==========================================
// POST /api/auth/logout
// ==========================================

router.post(
  "/logout",
  requireAllowedOrigin,
  requireAuth,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const auth = authOf(req);

    await prisma.authSession.deleteMany({
      where: {
        id: auth.sessionId,
      },
    });

    res.clearCookie(
      SESSION_COOKIE,
      sessionCookieOptions
    );

    res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  })
);

export default router;
