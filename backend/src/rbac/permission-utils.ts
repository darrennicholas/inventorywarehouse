export function hasPermission(
  grantedPermissions: readonly string[],
  requiredPermissions: readonly string[]
): boolean {
  return requiredPermissions.some((key) => grantedPermissions.includes(key));
}
