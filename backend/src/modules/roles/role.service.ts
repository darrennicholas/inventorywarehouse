import { prisma } from "../../lib/prisma.ts";
import { AppError } from "../../utils/AppError.ts";
import { roleInclude } from "./role.validation.ts";
// HELPER: VALIDATE PERMISSIONS
// ==========================================

// Ensure permission keys exist in DB.
//
// A user cannot grant a permission
// that they do not possess.

export async function resolvePermissions(
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

export async function getEditableRole(
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
