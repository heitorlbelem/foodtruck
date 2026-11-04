export type Permission = "catalog:read" | "catalog:write";

export const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  owner: ["catalog:read", "catalog:write"],
};

export function can(role: string, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
