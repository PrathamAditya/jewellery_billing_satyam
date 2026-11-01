// No imports on purpose: scripts/owner-set.ts runs this file directly with Node.

export const OWNER_USERNAME = "owner";
export const OWNER_ACTOR = "owner-script";

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * SQL that creates the owner, or replaces the owner's password hash (recovery, spec 002 R3).
 * Only the hash goes in. A password change ends every existing session of that user and is audited.
 */
export function ownerUpsertSql(args: { id: string; passwordHash: string; now: string; auditId: string }): string {
  const { id, passwordHash, now, auditId } = args;
  const owner = `(SELECT id FROM users WHERE username = ${q(OWNER_USERNAME)})`;
  return [
    `INSERT INTO users (id, created_at, created_by, updated_at, updated_by, username, password_hash, role)`,
    `VALUES (${q(id)}, ${q(now)}, ${q(OWNER_ACTOR)}, ${q(now)}, ${q(OWNER_ACTOR)}, ${q(OWNER_USERNAME)}, ${q(passwordHash)}, 'owner')`,
    `ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at, updated_by = excluded.updated_by;`,
    `DELETE FROM sessions WHERE user_id = ${owner};`,
    `INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail_json)`,
    `VALUES (${q(auditId)}, ${q(now)}, ${q(OWNER_ACTOR)}, 'owner_password_set', 'user', ${owner}, NULL);`,
    ``,
  ].join("\n");
}
