import { MIN_PASSWORD_LENGTH, newId } from "@jewellery/shared";
import { hashPassword } from "../auth/password";
import { ownerUpsertSql } from "../auth/owner";
import type { SqliteDatabase } from "../db/sqlite";

/**
 * Spec 081: creates the owner (username `owner`) or resets its password on the local database, with the same SQL
 * as `npm run owner:set -- --local` (ownerUpsertSql). It runs in one transaction. The caller passes the password;
 * it is never written anywhere.
 */
export async function setLocalOwnerPassword(db: SqliteDatabase, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The owner password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const sql = ownerUpsertSql({
    id: newId(),
    passwordHash: await hashPassword(password),
    now: new Date().toISOString(),
    auditId: newId(),
  });
  await db.batch([db.prepare(sql)]);
}
