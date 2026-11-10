import { Router } from "express";
import { z } from "zod";
import { createRoleSchema, roleInclude, updateRoleSchema } from "./role.validation.ts";
import { getEditableRole, resolvePermissions } from "./role.service.ts";
import { prisma } from "../../lib/prisma.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { authOf } from "../../middlewares/auth.middleware.ts";

const router = Router();

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
    const role = await prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
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
      await writeAuditLog({ userId: caller.userId, action: "CREATE", entity: "Role", entityId: created.id, afterData: created, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
      return created;
    });

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
          const updated = await tx.role.findUniqueOrThrow({
            where: {
              id,
            },

            include: roleInclude,
          });
          await writeAuditLog({ userId: caller.userId, action: "UPDATE", entity: "Role", entityId: id, beforeData: currentRole, afterData: updated, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
          return updated;
        }
      );

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

    const role = await prisma.$transaction(async (tx) => {
      const deactivated = await tx.role.update({
        where: { id },
        data: { isActive: false },
        include: roleInclude,
      });
      await writeAuditLog({ userId: caller.userId, action: "DEACTIVATE", entity: "Role", entityId: id, beforeData: { id: deactivated.id, isActive: true }, afterData: deactivated, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
      return deactivated;
    });
    await notifyByPermission({ permission: "roles.manage", type: "ROLE_DEACTIVATED", title: "Role deactivated", message: `${role.name} was deactivated.`, entity: "Role", entityId: role.id });

    res.status(200).json({
      success: true,
      message: "Role deactivated successfully",
      data: role,
    });
  })
);

// ==========================================

export default router;
