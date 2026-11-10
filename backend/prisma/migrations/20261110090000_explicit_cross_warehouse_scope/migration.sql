INSERT INTO "Permission" ("id", "key", "description")
VALUES (
  gen_random_uuid(),
  'warehouses.access_all',
  'Access data across all warehouses. Without this permission, an account must have an assigned staff warehouse.'
)
ON CONFLICT ("key") DO NOTHING;

-- Preserve intended access for built-in cross-warehouse roles. Custom roles
-- receive this permission only when an administrator grants it explicitly.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" AS role
CROSS JOIN "Permission" AS permission
WHERE role."code" IN ('ADMIN', 'WAREHOUSE_MANAGER', 'PROCUREMENT', 'AUDITOR')
  AND permission."key" = 'warehouses.access_all'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
