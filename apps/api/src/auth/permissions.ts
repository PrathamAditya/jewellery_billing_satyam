import { DEFAULT_ROLES, PERMISSIONS, isPermission, type Permission } from "@jewellery/shared";

/** Spec 004 R2: the owner role is locked, so it holds every permission in the shared list (spec 052: no migration needed for a new one). */
export const LOCKED_OWNER = "owner";

/** Permissions of a role (spec 004 R3). An unknown or deleted role has none. */
export async function permissionsForRole(db: D1Database, role: string): Promise<Permission[]> {
  if (role === LOCKED_OWNER) return [...PERMISSIONS];
  const row = await db.prepare("SELECT permissions_json FROM roles WHERE name = ?1").bind(role).first<{ permissions_json: string }>();
  if (!row) return [];
  const list = JSON.parse(row.permissions_json) as string[];
  return list.filter(isPermission);
}

/** The four default roles, written into the roles table (used by tests and by `owner:set`). */
export const SEED_ROLES = DEFAULT_ROLES;
