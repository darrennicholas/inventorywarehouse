
import "dotenv/config";

import bcrypt from "bcryptjs";

import { prisma } from "../src/lib/prisma.ts";

import {
  PERMISSION_KEYS,
  ROLE_CODES,
  ROLE_NAMES,
  ROLE_PRESETS,
  type PermissionKey,
} from "../src/rbac/permissions.ts";

// ==========================================
// STOCKFLOW AUTHENTICATION SEED
// ==========================================

async function main(): Promise<void> {
  console.log("==================================");
  console.log(" STOCKFLOW AUTH & RBAC SEED");
  console.log("==================================");

  // ========================================
  // 1. ENVIRONMENT VALIDATION
  // ========================================

  const adminEmail = process.env.ADMIN_EMAIL
    ?.trim()
    .toLowerCase();

  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail) {
    throw new Error(
      "ADMIN_EMAIL is missing from backend/.env"
    );
  }

  if (!adminPassword || adminPassword.length < 12) {
    throw new Error(
      "ADMIN_PASSWORD must be at least 12 characters"
    );
  }

  // ========================================
  // 2. SEED PERMISSIONS
  // ========================================

  console.log("\n[1] Seeding permissions...");

  for (const key of PERMISSION_KEYS) {
    await prisma.permission.upsert({
      where: {
        key,
      },
      update: {},
      create: {
        key,
      },
    });
  }

  console.log(
    `${PERMISSION_KEYS.length} permissions processed.`
  );

  // ========================================
  // 3. FETCH PERMISSION IDS
  // ========================================

  console.log("\n[2] Loading permission IDs...");

  const allPermissions =
    await prisma.permission.findMany({
      where: {
        key: {
          in: [...PERMISSION_KEYS],
        },
      },
      select: {
        id: true,
        key: true,
      },
    });

  // MAP: permission key -> permission UUID
  const permissionMap = new Map<string, string>();

  for (const permission of allPermissions) {
    permissionMap.set(
      permission.key,
      permission.id
    );
  }

  // ========================================
  // 4. SEED SYSTEM ROLES
  // ========================================

  console.log("\n[3] Seeding system roles...");

  // Use typed ROLE_CODES instead of Object.entries().
  for (const roleCode of ROLE_CODES) {
    const roleName: string =
      ROLE_NAMES[roleCode];

    const permissionKeys:
      readonly PermissionKey[] =
      ROLE_PRESETS[roleCode];

    // Get UUIDs for the permissions of this role.
    const permissionIds: string[] = [];

    for (const key of permissionKeys) {
      const permissionId =
        permissionMap.get(key);

      if (!permissionId) {
        throw new Error(
          `Permission not found: ${key}`
        );
      }

      permissionIds.push(permissionId);
    }

    // Create/update role and permissions atomically.
    await prisma.$transaction(async (tx) => {
      const role = await tx.role.upsert({
        where: {
          code: roleCode,
        },

        create: {
          code: roleCode,
          name: roleName,
          description: null,
          isSystem: true,
          isActive: true,
        },

        update: {
          name: roleName,
          isSystem: true,
          isActive: true,
        },
      });

      // Synchronize system-role permissions.
      await tx.rolePermission.deleteMany({
        where: {
          roleId: role.id,
        },
      });

      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionIds.map(
            (permissionId) => ({
              roleId: role.id,
              permissionId,
            })
          ),
        });
      }
    });

    console.log(
      `${roleCode}: ${permissionIds.length} permissions`
    );
  }

  // ========================================
  // 5. FIND ADMIN ROLE
  // ========================================

  console.log("\n[4] Checking Admin role...");

  const adminRole =
    await prisma.role.findUniqueOrThrow({
      where: {
        code: "ADMIN",
      },
    });

  // ========================================
  // 6. CREATE INITIAL ADMIN
  // ========================================

  console.log("\n[5] Checking Admin user...");

  const existingAdmin =
    await prisma.user.findUnique({
      where: {
        email: adminEmail,
      },
    });

  if (!existingAdmin) {
    const passwordHash =
      await bcrypt.hash(adminPassword, 12);

    await prisma.user.create({
      data: {
        email: adminEmail,

        fullName: "System Administrator",

        passwordHash,

        roleId: adminRole.id,

        staffId: null,

        isActive: true,
      },
    });

    console.log(
      `Admin created: ${adminEmail}`
    );
  } else {
    // Do not silently give admin permissions
    // to an existing account with another role.
    if (existingAdmin.roleId !== adminRole.id) {
      throw new Error(
        "ADMIN_EMAIL belongs to a non-admin user"
      );
    }

    console.log(
      `Admin already exists: ${adminEmail}`
    );

    console.log(
      "Existing password was not overwritten."
    );
  }

  // ========================================
  // 7. CREATE ONE USER FOR EACH SYSTEM ROLE
  // ========================================

  console.log("\n[6] Seeding role users...");

  const demoPassword =
    process.env.DEMO_PASSWORD ?? adminPassword;

  const roleUsers = [
    {
      roleCode: "ADMIN" as const,
      email: adminEmail,
      fullName: "System Administrator",
    },
    {
      roleCode: "WAREHOUSE_MANAGER" as const,
      email: "warehouse.manager@stockflow.local",
      fullName: "Warehouse Manager",
    },
    {
      roleCode: "WAREHOUSE_STAFF" as const,
      email: "warehouse.staff@stockflow.local",
      fullName: "Warehouse Staff",
    },
    {
      roleCode: "PROCUREMENT" as const,
      email: "procurement@stockflow.local",
      fullName: "Procurement Officer",
    },
    {
      roleCode: "AUDITOR" as const,
      email: "auditor@stockflow.local",
      fullName: "Inventory Auditor",
    },
  ];

  for (const item of roleUsers) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: item.roleCode },
    });

    const existing = await prisma.user.findUnique({
      where: { email: item.email },
    });

    if (!existing) {
      await prisma.user.create({
        data: {
          email: item.email,
          fullName: item.fullName,
          passwordHash: await bcrypt.hash(
            demoPassword,
            12
          ),
          roleId: role.id,
          isActive: true,
        },
      });

      console.log(
        `Created ${item.roleCode} user: ${item.email}`
      );
    } else {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          fullName: item.fullName,
          roleId: role.id,
          isActive: true,
        },
      });

      console.log(
        `Updated ${item.roleCode} user: ${item.email}`
      );
    }
  }

  // ========================================
  // 8. SEED SUMMARY
  // ========================================

  const permissionCount =
    await prisma.permission.count();

  const roleCount =
    await prisma.role.count();

  const userCount =
    await prisma.user.count();

  const rolePermissionCount =
    await prisma.rolePermission.count();

  console.log("\n==================================");
  console.log(" SEED SUMMARY");
  console.log("==================================");

  console.log(
    `Permissions: ${permissionCount}`
  );

  console.log(
    `Roles: ${roleCount}`
  );

  console.log(
    `Role Permissions: ${rolePermissionCount}`
  );

  console.log(
    `Users: ${userCount}`
  );

  console.log("==================================");

  console.log(
    "Authentication & RBAC seed completed!"
  );
}

// ==========================================
// RUN SEED
// ==========================================

main()
  .catch((error: unknown) => {
    console.error(
      "\nSeed failed:",
      error
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
