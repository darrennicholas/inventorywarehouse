import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.ts";
import { PERMISSION_KEYS, ROLE_CODES, ROLE_NAMES, ROLE_PRESETS } from "../src/rbac/permissions.ts";

/**
 * Additive / non-destructive RBAC seed.
 * - Existing users: do NOT update role, name, password or active status.
 * - Existing system roles: do NOT delete custom permission grants.
 * - Existing roles are NOT reactivated automatically.
 * - New demo accounts are only created when missing.
 */
async function main(): Promise<void> {
  console.log("STOCKFLOW RBAC seed: additive mode");
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail) throw new Error("ADMIN_EMAIL is missing from backend/.env");
  if (!adminPassword || adminPassword.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");

  for (const key of PERMISSION_KEYS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  const permissions = await prisma.permission.findMany({ where: { key: { in: [...PERMISSION_KEYS] } }, select: { id: true, key: true } });
  const byKey = new Map(permissions.map(row => [row.key, row.id]));

  for (const code of ROLE_CODES) {
    await prisma.$transaction(async tx => {
      const role = await tx.role.upsert({
        where: { code },
        create: { code, name: ROLE_NAMES[code], isSystem: true, isActive: true },
        update: {},
      });
      const ids = ROLE_PRESETS[code].map(key => {
        const id = byKey.get(key);
        if (!id) throw new Error(`Missing permission: ${key}`);
        return id;
      });
      await tx.rolePermission.createMany({
        data: ids.map(permissionId => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
      console.log(`${code}: ensured ${ids.length} preset permissions (custom grants preserved)`);
    });
  }

  // Add the default nominal approval matrix only for a fresh installation.
  // Existing policy records are deliberately preserved for administrators.
  if (await prisma.approvalPolicy.count() === 0) {
    const roleId = new Map((await prisma.role.findMany({ where: { code: { in: [...ROLE_CODES] } }, select: { id: true, code: true } })).map((role) => [role.code, role.id]));
    const policy = (subject: "PURCHASE" | "ADJUSTMENT" | "RETURN" | "STOCK_OPNAME", minimumAmount: number, maximumAmount: number | null, roleCode: "ADMIN" | "WAREHOUSE_MANAGER" | "PROCUREMENT") => ({
      subject,
      minimumAmount,
      maximumAmount,
      approverRoleId: roleId.get(roleCode)!,
      requiresDifferentCreator: true,
      isActive: true,
    });
    await prisma.approvalPolicy.createMany({ data: [
      policy("PURCHASE", 0, 9_999_999, "PROCUREMENT"),
      policy("PURCHASE", 10_000_000, 49_999_999, "WAREHOUSE_MANAGER"),
      policy("PURCHASE", 50_000_000, null, "ADMIN"),
      policy("ADJUSTMENT", 0, 4_999_999, "WAREHOUSE_MANAGER"),
      policy("ADJUSTMENT", 5_000_000, null, "ADMIN"),
      policy("RETURN", 0, 4_999_999, "WAREHOUSE_MANAGER"),
      policy("RETURN", 5_000_000, null, "ADMIN"),
      policy("STOCK_OPNAME", 0, 4_999_999, "WAREHOUSE_MANAGER"),
      policy("STOCK_OPNAME", 5_000_000, null, "ADMIN"),
    ] });
    console.log("Approval matrix: created default policies");
  }

  const demoPassword = process.env.DEMO_PASSWORD ?? adminPassword;
  const users = [
    { code: "ADMIN" as const, email: adminEmail, name: "System Administrator", password: adminPassword },
    { code: "WAREHOUSE_MANAGER" as const, email: process.env.WAREHOUSE_MANAGER_EMAIL?.trim().toLowerCase() ?? "warehouse.manager@stockflow.local", name: "Warehouse Manager", password: process.env.WAREHOUSE_MANAGER_PASSWORD ?? demoPassword },
    { code: "WAREHOUSE_STAFF" as const, email: process.env.WAREHOUSE_STAFF_EMAIL?.trim().toLowerCase() ?? "warehouse.staff@stockflow.local", name: "Warehouse Staff", password: process.env.WAREHOUSE_STAFF_PASSWORD ?? demoPassword },
    { code: "PROCUREMENT" as const, email: process.env.PROCUREMENT_EMAIL?.trim().toLowerCase() ?? "procurement@stockflow.local", name: "Procurement Officer", password: process.env.PROCUREMENT_PASSWORD ?? demoPassword },
    { code: "AUDITOR" as const, email: process.env.AUDITOR_EMAIL?.trim().toLowerCase() ?? "auditor@stockflow.local", name: "Inventory Auditor", password: process.env.AUDITOR_PASSWORD ?? demoPassword },
  ];
  if (new Set(users.map(x => x.email)).size !== users.length) throw new Error("Demo emails must be unique");
  for (const user of users) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: user.code } });
    const existing = await prisma.user.findUnique({ where: { email: user.email } });
    if (existing) {
      if (user.code === "ADMIN" && existing.roleId !== role.id) throw new Error("ADMIN_EMAIL belongs to a non-admin user");
      console.log(`Existing account kept unchanged: ${user.email}`);
      continue;
    }
    if (user.password.length < 12) throw new Error(`${user.code}_PASSWORD must be at least 12 characters`);
    await prisma.user.create({ data: { email: user.email, fullName: user.name, passwordHash: await bcrypt.hash(user.password, 12), roleId: role.id, isActive: true } });
    console.log(`Created ${user.code}: ${user.email}`);
  }
  console.log(`Permissions: ${await prisma.permission.count()}, Roles: ${await prisma.role.count()}, Users: ${await prisma.user.count()}`);
}

main().catch(error => { console.error("RBAC seed failed:", error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
