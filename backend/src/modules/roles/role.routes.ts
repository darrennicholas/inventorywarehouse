
import { Router } from "express";
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
// INITIALIZE ROLE ROUTER
// ==========================================

const router = Router();

// ==========================================
// VALIDATION SCHEMAS
// ==========================================

const createRoleSchema = z.object({
  code: z.string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(50)
    .regex(
      /^[A-Z][A-Z0-9_]*$/,
      "Role code must contain uppercase letters, numbers or underscores"
    ),

  name: z.string()
    .trim()
    .min(2)
    .max(100),

  description: z.string()
    .trim()
    .max(300)
    .nullable()
    .optional(),

  permissions: z.array(
    z.string().min(1)
  ).max(100),

  isActive: z.boolean()
    .optional(),
}).strict();

const updateRoleSchema = createRoleSchema
  .partial()
  .refine(
    (value) =>
      Object.keys(value).length > 0,
    {
      message: "At least one field is required",
    }
  );

// ==========================================
// ROLE QUERY RELATIONS
// ==========================================

const roleInclude = {
  permissions: {
    include: {
      permission: true,
    },
  },
} as const;

// ==========================================
// HELPER: VALIDATE PERMISSIONS
// ==========================================

// Ensure permission keys exist in DB.
//
// A user cannot grant a permission
// that they do not possess.

async function resolvePermissions(
  keys: string[],
  callerPermissions: string[]
) {
  const uniqueKeys = [...new Set(keys)];

  const allowed =
    new Set(callerPermissions);

  // Check privilege escalation.
  const forbiddenKeys = uniqueKeys.filter(
    (key) => !allowed.has(key)
  );

  if (forbiddenKeys.length > 0) {
    throw new AppError(
      403,
      "You cannot grant permissions you do not have"
    );
  }

  // Retrieve permission records.
  const permissionRecords =
    await prisma.permission.findMany({
      where: {
        key: {
          in: uniqueKeys,
        },
      },

      select: {
        id: true,
        key: true,
      },
    });

  // All requested keys must exist.
  if (
    permissionRecords.length !==
    uniqueKeys.length
  ) {
    throw new AppError(
      400,
      "One or more permissions do not exist"
    );
  }

  return permissionRecords;
}

// ==========================================
// HELPER: VALIDATE EDITABLE ROLE
// ==========================================

async function getEditableRole(
  roleId: string,
  callerPermissions: string[]
) {
  const role = await prisma.role.findUnique({
    where: {
      id: roleId,
    },

    include: roleInclude,
  });

  if (!role) {
    throw new AppError(
      404,
      "Role not found"
    );
  }

  // Protect seeded system roles.
  if (role.isSystem) {
    throw new AppError(
      409,
      "System roles cannot be modified"
    );
  }

  // Prevent privilege escalation.
  const allowed =
    new Set(callerPermissions);

  const hasForbiddenPermission =
    role.permissions.some(
      (item) =>
        !allowed.has(item.permission.key)
    );

  if (hasForbiddenPermission) {
    throw new AppError(
      403,
      "You cannot manage a role with higher permissions"
    );
  }

  return role;
}

// ==========================================
// GET /api/roles/permissions
// ==========================================

// Retrieve every permission
// available in StockFlow.

router.get(
  "/permissions",

  asyncHandler(async (_req, res) => {
    const permissions =
      await prisma.permission.findMany({
        orderBy: {
          key: "asc",
        },
      });

    res.status(200).json({
      success: true,
      data: permissions,
    });
  })
);

// ==========================================
// GET /api/roles
// ==========================================

// Retrieve all roles with permissions.

router.get(
  "/",

  asyncHandler(async (_req, res) => {
    const roles = await prisma.role.findMany({
      include: roleInclude,

      orderBy: {
        name: "asc",
      },
    });

    res.status(200).json({
      success: true,
      data: roles,
    });
  })
);

// ==========================================
// GET /api/roles/:id
// ==========================================

router.get(
  "/:id",

  asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);

    const role = await prisma.role.findUnique({
      where: {
        id,
      },

      include: roleInclude,
    });

    if (!role) {
      throw new AppError(
        404,
        "Role not found"
      );
    }

    res.status(200).json({
      success: true,
      data: role,
    });
  })
);

// ==========================================
// POST /api/roles
// ==========================================

// Create custom Role and assign Permissions.

router.post(
  "/",

  asyncHandler(async (req, res) => {
    const input = createRoleSchema.parse(
      req.body
    );

    const caller = authOf(req);

    // Validate selected permissions.
    const selectedPermissions =
      await resolvePermissions(
        input.permissions,
        caller.permissions
      );

    // Ensure unique role code.
    const existingRole =
      await prisma.role.findUnique({
        where: {
          code: input.code,
        },
      });

    if (existingRole) {
      throw new AppError(
        409,
        "Role code already exists"
      );
    }

    // Create Role and RolePermission.
    const role = await prisma.role.create({
      data: {
        code: input.code,

        name: input.name,

        description:
          input.description ?? null,

        isSystem: false,

        isActive:
          input.isActive ?? true,

        permissions: {
          create: selectedPermissions.map(
            (permission) => ({
              permissionId: permission.id,
            })
          ),
        },
      },

      include: roleInclude,
    });

    await writeAuditLog({ userId: caller.userId, action: "CREATE", entity: "Role", entityId: role.id, afterData: role, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") });
    await notifyByPermission({ permission: "roles.manage", type: "ROLE_CREATED", title: "Role created", message: `${role.name} was created with ${role.permissions.length} permission(s).`, entity: "Role", entityId: role.id });

    res.status(201).json({
      success: true,
      message: "Role created successfully",
      data: role,
    });
  })
);

// ==========================================
// PATCH /api/roles/:id
// ==========================================

// Update custom Role.
//
// Supports:
// - Role code
// - Role name
// - Description
// - Permission assignments
// - Active status

router.patch(
  "/:id",

  asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);

    const input = updateRoleSchema.parse(
      req.body
    );

    const caller = authOf(req);

    // Check if editable.
    const currentRole = await getEditableRole(
      id,
      caller.permissions
    );

    // Prevent disabling roles used
    // by active accounts.
    if (input.isActive === false) {
      const activeUsers =
        await prisma.user.count({
          where: {
            roleId: id,
            isActive: true,
          },
        });

      if (activeUsers > 0) {
        throw new AppError(
          409,
          "Cannot deactivate a role assigned to active users"
        );
      }
    }

    // If permissions are provided,
    // resolve all permission IDs.
    const selectedPermissions =
      input.permissions === undefined
        ? undefined
        : await resolvePermissions(
            input.permissions,
            caller.permissions
          );

    const {
      permissions: _permissions,
      ...fields
    } = input;

    void _permissions;

    // Update role in one DB transaction.
    const updatedRole =
      await prisma.$transaction(
        async (tx) => {
          await tx.role.update({
            where: {
              id,
            },

            data: fields,
          });

          // Synchronize RolePermission
          // only when provided.
          if (
            selectedPermissions !== undefined
          ) {
            await tx.rolePermission.deleteMany({
              where: {
                roleId: id,
              },
            });

            if (
              selectedPermissions.length > 0
            ) {
              await tx.rolePermission.createMany({
                data:
                  selectedPermissions.map(
                    (permission) => ({
                      roleId: id,
                      permissionId:
                        permission.id,
                    })
                  ),
              });
            }
          }

          // Return updated role.
          return tx.role.findUniqueOrThrow({
            where: {
              id,
            },

            include: roleInclude,
          });
        }
      );

    await writeAuditLog({ userId: caller.userId, action: "UPDATE", entity: "Role", entityId: id, beforeData: currentRole, afterData: updatedRole, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") });
    await notifyByPermission({ permission: "roles.manage", type: "ROLE_UPDATED", title: "Role permission updated", message: `${updatedRole.name} permission mapping was updated.`, entity: "Role", entityId: updatedRole.id });

    res.status(200).json({
      success: true,
      message: "Role updated successfully",
      data: updatedRole,
    });
  })
);

// ==========================================
// DELETE /api/roles/:id
// ==========================================

// Soft deactivate custom role.
//
// Does not physically delete records.

router.delete(
  "/:id",

  asyncHandler(async (req, res) => {
    const id = z.uuid().parse(req.params.id);

    const caller = authOf(req);

    // Protect system roles and
    // prevent privilege escalation.
    await getEditableRole(
      id,
      caller.permissions
    );

    // Do not deactivate a role used
    // by active accounts.
    const activeUsers =
      await prisma.user.count({
        where: {
          roleId: id,
          isActive: true,
        },
      });

    if (activeUsers > 0) {
      throw new AppError(
        409,
        "Cannot deactivate a role assigned to active users"
      );
    }

    const role = await prisma.role.update({
      where: {
        id,
      },

      data: {
        isActive: false,
      },

      include: roleInclude,
    });

    await writeAuditLog({ userId: caller.userId, action: "DEACTIVATE", entity: "Role", entityId: id, beforeData: { id: role.id, isActive: true }, afterData: role, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") });
    await notifyByPermission({ permission: "roles.manage", type: "ROLE_DEACTIVATED", title: "Role deactivated", message: `${role.name} was deactivated.`, entity: "Role", entityId: role.id });

    res.status(200).json({
      success: true,
      message: "Role deactivated successfully",
      data: role,
    });
  })
);

// ==========================================
// EXPORT ROLE ROUTER
// ==========================================

export default router;
