import { DEFAULT_ROLES, isPermission, type Permission } from "@jewellery/shared";

/** Permissions of a role (spec 004 R3). An unknown or deleted role has none. */
export async function permissionsForRole(db: D1Database, role: string): Promise<Permission[]> {
  const row = await db.prepare("SELECT permissions_json FROM roles WHERE name = ?1").bind(role).first<{ permissions_json: string }>();
  if (!row) return [];
  const list = JSON.parse(row.permissions_json) as string[];
  return list.filter(isPermission);
}

/** The four default roles, written into the roles table (used by tests and by `owner:set`). */
export const SEED_ROLES = DEFAULT_ROLES;
