import { prisma } from "../../lib/prisma.ts";
import { AppError } from "../../utils/AppError.ts";
const warehouseScopedPrefixes = ["inventory.", "purchases.", "sales.", "purchase-returns.", "sales-returns.", "fulfillment.", "adjustments.", "transfers.", "expenses.", "payments.", "reports.", "stock-opnames.", "warehouses."];

export function roleNeedsWarehouseAssignment(permissions: string[]): boolean {
  return !permissions.includes("warehouses.access_all") && permissions.some((key) => key === "dashboard.read" || warehouseScopedPrefixes.some((prefix) => key.startsWith(prefix)));
}

export async function validateWarehouseAssignment(roleId: string, staffId: string | null): Promise<void> {
  const role = await prisma.role.findUniqueOrThrow({ where: { id: roleId }, select: { permissions: { select: { permission: { select: { key: true } } } } } });
  if (!roleNeedsWarehouseAssignment(role.permissions.map((entry) => entry.permission.key))) return;
  if (!staffId) throw new AppError(400, "Role ini memerlukan staff yang ditugaskan ke gudang aktif.", undefined, "WAREHOUSE_ASSIGNMENT_REQUIRED");
  const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { isActive: true, warehouse: { select: { isActive: true } } } });
  if (!staff?.isActive || !staff.warehouse?.isActive) throw new AppError(400, "Pilih staff aktif yang memiliki penugasan ke gudang aktif.", undefined, "WAREHOUSE_ASSIGNMENT_REQUIRED");
}
// HELPER: VALIDATE ASSIGNABLE ROLE
// ==========================================

export async function validateAssignableRole(
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

export async function getManageableUser(
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

export async function validateStaff(
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

export async function ensureAdminRemains(
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
