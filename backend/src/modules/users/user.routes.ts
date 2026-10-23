
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "../../lib/prisma.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";

import {
  authOf,
} from "../../middlewares/auth.middleware.ts";

// ==========================================
// INITIALIZE USER ROUTER
// ==========================================

const router = Router();

// ==========================================
// VALIDATION SCHEMAS
// ==========================================

const createUserSchema = z.object({
  fullName: z.string()
    .trim()
    .min(2)
    .max(120),

  email: z.string()
    .trim()
    .toLowerCase()
    .pipe(z.email()),

  password: z.string()
    .min(12)
    .max(128),

  roleId: z.uuid(),

  staffId: z.uuid()
    .nullable()
    .optional(),

  isActive: z.boolean()
    .optional(),
}).strict();

const updateUserSchema = createUserSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    {
      message: "At least one field is required",
    }
  );

// ==========================================
// USER RESPONSE FIELDS
// ==========================================

// Never return passwordHash.

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,

  role: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
    },
  },

  staff: {
    select: {
      id: true,
      staffCode: true,
      fullName: true,
    },
  },
} as const;

// ==========================================
// HELPER: VALIDATE ASSIGNABLE ROLE
// ==========================================

async function validateAssignableRole(
  roleId: string,
  callerPermissions: string[]
): Promise<void> {
  const role = await prisma.role.findUnique({
    where: {
      id: roleId,
    },

    include: {
      permissions: {
        include: {
          permission: true,
        },
      },
    },
  });

  if (!role) {
    throw new AppError(
      404,
      "Role not found"
    );
  }

  if (!role.isActive) {
    throw new AppError(
      400,
      "Selected role is inactive"
    );
  }

  const allowed = new Set(callerPermissions);

  const hasForbiddenPermission =
    role.permissions.some(
      (item) =>
        !allowed.has(item.permission.key)
    );

  if (hasForbiddenPermission) {
    throw new AppError(
      403,
      "You cannot assign a role with permissions you do not have"
    );
  }
}

// ==========================================
// HELPER: VALIDATE EXISTING USER
// ==========================================

async function getManageableUser(
  userId: string,
  callerPermissions: string[]
) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },

    include: {
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
  });

  if (!user) {
    throw new AppError(
      404,
      "User not found"
    );
  }

  const allowed = new Set(callerPermissions);

  const hasForbiddenPermission =
    user.role.permissions.some(
      (item) =>
        !allowed.has(item.permission.key)
    );

  if (hasForbiddenPermission) {
    throw new AppError(
      403,
      "You cannot manage a user with higher permissions"
    );
  }

  return user;
}

// ==========================================
// HELPER: VALIDATE STAFF ASSIGNMENT
// ==========================================

async function validateStaff(
  staffId: string | null,
  excludeUserId?: string
): Promise<void> {
  if (!staffId) {
    return;
  }

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },
  });

  if (!staff) {
    throw new AppError(
      404,
      "Staff not found"
    );
  }

  if (!staff.isActive) {
    throw new AppError(
      400,
      "Selected staff is inactive"
    );
  }

  const linkedUser = await prisma.user.findFirst({
    where: {
      staffId,

      ...(excludeUserId
        ? {
            id: {
              not: excludeUserId,
            },
          }
        : {}),
    },

    select: {
      id: true,
    },
  });

  if (linkedUser) {
    throw new AppError(
      409,
      "This staff is already linked to another user"
    );
  }
}

// ==========================================
// HELPER: PROTECT LAST ACTIVE ADMIN
// ==========================================

async function ensureAdminRemains(
  currentUser: {
    isActive: boolean;
    role: {
      code: string;
    };
  },
  willRemoveAdminAccess: boolean
): Promise<void> {
  if (
    !currentUser.isActive ||
    currentUser.role.code !== "ADMIN" ||
    !willRemoveAdminAccess
  ) {
    return;
  }

  const activeAdmins = await prisma.user.count({
    where: {
      isActive: true,

      role: {
        code: "ADMIN",
        isActive: true,
      },
    },
  });

  if (activeAdmins <= 1) {
    throw new AppError(
      409,
      "At least one active Administrator must remain"
    );
  }
}

// ==========================================
// GET /api/users/options
// ==========================================

// Return options for User form:
// - Active roles
// - Active staff

router.get(
  "/options",

  asyncHandler(async (_req, res) => {
    const [roles, staff] = await Promise.all([
      prisma.role.findMany({
        where: {
          isActive: true,
        },

        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
        },

        orderBy: {
          name: "asc",
        },
      }),

      prisma.staff.findMany({
        where: {
          isActive: true,
        },

        select: {
          id: true,
          staffCode: true,
          fullName: true,
        },

        orderBy: {
          fullName: "asc",
        },
      }),
    ]);

    res.status(200).json({
      success: true,

      data: {
        roles,
        staff,
      },
    });
  })
);

// ==========================================
// GET /api/users
// ==========================================

// Retrieve all registered accounts.

router.get(
  "/",

  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: userSelect,

      orderBy: {
        createdAt: "desc",
      },
    });

    res.status(200).json({
      success: true,
      data: users,
    });
  })
);

// ==========================================
// GET /api/users/:id
// ==========================================

router.get(
  "/:id",

  asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);

    const user = await prisma.user.findUnique({
      where: {
        id,
      },

      select: userSelect,
    });

    if (!user) {
      throw new AppError(
        404,
        "User not found"
      );
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  })
);

// ==========================================
// POST /api/users
// ==========================================

// Create a new account.

router.post(
  "/",

  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(
      req.body
    );

    const caller = authOf(req);

    // Validate role permissions.
    await validateAssignableRole(
      input.roleId,
      caller.permissions
    );

    // Validate optional Staff.
    await validateStaff(
      input.staffId ?? null
    );

    // Check email uniqueness.
    const existingEmail =
      await prisma.user.findUnique({
        where: {
          email: input.email,
        },
      });

    if (existingEmail) {
      throw new AppError(
        409,
        "Email is already registered"
      );
    }

    // Hash password.
    const passwordHash =
      await bcrypt.hash(
        input.password,
        12
      );

    // Create account.
    const user = await prisma.user.create({
      data: {
        fullName: input.fullName,

        email: input.email,

        passwordHash,

        roleId: input.roleId,

        staffId: input.staffId ?? null,

        isActive: input.isActive ?? true,
      },

      select: userSelect,
    });

    await writeAuditLog({ userId: caller.userId, action: "CREATE", entity: "User", entityId: user.id, afterData: user, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") });
    await notifyByPermission({ permission: "users.manage", type: "USER_CREATED", title: "User account created", message: `${user.fullName} was added with role ${user.role.name}.`, entity: "User", entityId: user.id });

    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: user,
    });
  })
);

// ==========================================
// PATCH /api/users/:id
// ==========================================

// Supported:
// - Change fullName
// - Change email
// - Change role
// - Change Staff
// - Reset password
// - Activate/deactivate account

router.patch(
  "/:id",

  asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);

    const input = updateUserSchema.parse(
      req.body
    );

    const caller = authOf(req);

    // Retrieve and authorize target User.
    const currentUser =
      await getManageableUser(
        id,
        caller.permissions
      );

    // Validate role if changed.
    if (input.roleId !== undefined) {
      await validateAssignableRole(
        input.roleId,
        caller.permissions
      );
    }

    // Validate Staff if changed.
    if (input.staffId !== undefined) {
      await validateStaff(
        input.staffId,
        id
      );
    }

    const changingRole =
      input.roleId !== undefined &&
      input.roleId !== currentUser.roleId;

    const deactivating =
      input.isActive === false &&
      currentUser.isActive;

    // Prevent modifying your own access.
    if (
      id === caller.userId &&
      (changingRole || deactivating)
    ) {
      throw new AppError(
        409,
        "You cannot change your own role or deactivate yourself"
      );
    }

    // Keep at least one active Admin.
    await ensureAdminRemains(
      currentUser,
      changingRole || deactivating
    );

    // Hash new password outside transaction.
    const passwordHash =
      input.password !== undefined
        ? await bcrypt.hash(
            input.password,
            12
          )
        : undefined;

    // Password must not be passed directly
    // into Prisma user.update().
    const {
      password: _password,
      ...fields
    } = input;

    void _password;

    const updatedUser =
      await prisma.$transaction(
        async (tx) => {
          const updated =
            await tx.user.update({
              where: {
                id,
              },

              data: {
                ...fields,

                ...(passwordHash
                  ? { passwordHash }
                  : {}),
              },

              select: userSelect,
            });

          // Revoke old sessions when security
          // credentials or access change.
          if (
            passwordHash !== undefined ||
            changingRole ||
            deactivating
          ) {
            await tx.authSession.deleteMany({
              where: {
                userId: id,
              },
            });
          }

          return updated;
        }
      );

    await writeAuditLog({ userId: caller.userId, action: "UPDATE", entity: "User", entityId: id, beforeData: { id: currentUser.id, email: currentUser.email, fullName: currentUser.fullName, roleId: currentUser.roleId, isActive: currentUser.isActive, staffId: currentUser.staffId }, afterData: updatedUser, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") });
    await notifyByPermission({ permission: "users.manage", type: "USER_UPDATED", title: "User access updated", message: `${updatedUser.fullName} account or role was updated.`, entity: "User", entityId: updatedUser.id });

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: updatedUser,
    });
  })
);

// ==========================================
// DELETE /api/users/:id
// ==========================================

// Soft deactivate, NOT physical deletion.
// Existing User data is preserved.

router.delete(
  "/:id",

  asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);

    const caller = authOf(req);

    if (id === caller.userId) {
      throw new AppError(
        409,
        "You cannot deactivate your own account"
      );
    }

    const currentUser =
      await getManageableUser(
        id,
        caller.permissions
      );

    await ensureAdminRemains(
      currentUser,
      currentUser.isActive
    );

    const user =
      await prisma.$transaction(
        async (tx) => {
          // Soft deactivate.
          const updated =
            await tx.user.update({
              where: {
                id,
              },

              data: {
                isActive: false,
              },

              select: userSelect,
            });

          // Revoke active sessions.
          await tx.authSession.deleteMany({
            where: {
              userId: id,
            },
          });

          return updated;
        }
      );

    await writeAuditLog({ userId: caller.userId, action: "DEACTIVATE", entity: "User", entityId: id, beforeData: { id: currentUser.id, isActive: currentUser.isActive }, afterData: user, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") });
    await notifyByPermission({ permission: "users.manage", type: "USER_DEACTIVATED", title: "User account deactivated", message: `${user.fullName} was deactivated.`, entity: "User", entityId: user.id });

    res.status(200).json({
      success: true,
      message: "User deactivated successfully",
      data: user,
    });
  })
);

// ==========================================
// EXPORT USER ROUTER
// ==========================================

export default router;
