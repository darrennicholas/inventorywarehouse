import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { createUserSchema, updateUserSchema, userSelect } from "./user.validation.ts";
import { ensureAdminRemains, getManageableUser, validateAssignableRole, validateStaff } from "./user.service.ts";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { authOf } from "../../middlewares/auth.middleware.ts";

const router = Router();

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
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
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
      await writeAuditLog({ userId: caller.userId, action: "CREATE", entity: "User", entityId: created.id, afterData: created, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);
      return created;
    });
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

          await writeAuditLog({ userId: caller.userId, action: "UPDATE", entity: "User", entityId: id, beforeData: { id: currentUser.id, email: currentUser.email, fullName: currentUser.fullName, roleId: currentUser.roleId, isActive: currentUser.isActive, staffId: currentUser.staffId }, afterData: updated, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);

          return updated;
        }
      );

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

          await writeAuditLog({ userId: caller.userId, action: "DEACTIVATE", entity: "User", entityId: id, beforeData: { id: currentUser.id, isActive: currentUser.isActive }, afterData: updated, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") }, tx as never);

          return updated;
        }
      );

    await notifyByPermission({ permission: "users.manage", type: "USER_DEACTIVATED", title: "User account deactivated", message: `${user.fullName} was deactivated.`, entity: "User", entityId: user.id });

    res.status(200).json({
      success: true,
      message: "User deactivated successfully",
      data: user,
    });
  })
);

// ==========================================

export default router;
