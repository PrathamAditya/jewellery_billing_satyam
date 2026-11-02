import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SqliteDatabase } from "../db/sqlite";

/**
 * Spec 081: where the local database lives. `JB_DATA_DIR` overrides the default, which is
 * `Documents/JewelleryBilling` in the owner's home folder (Q117). The file is `billing.sqlite` in that folder.
 */
export function resolveDataDir(env: Record<string, string | undefined>): string {
  const fromEnv = env.JB_DATA_DIR?.trim();
  if (fromEnv) return fromEnv;
  return join(homedir(), "Documents", "JewelleryBilling");
}

export function databaseFile(dataDir: string): string {
  return join(dataDir, "billing.sqlite");
}

/**
 * Opens (creating the folder and the file if needed) the local database through the spec 080 adapter.
 * WAL journal mode and a 5 second busy timeout, so a second process (`local:migrate`, `local:owner`) waits
 * for the server's write instead of failing at once. Decided in spec 081 (see docs/specs/081-local-server.md).
 */
export function openLocalDatabase(dataDir: string): SqliteDatabase {
  mkdirSync(dataDir, { recursive: true });
  const db = new SqliteDatabase(databaseFile(dataDir));
  db.prepare("PRAGMA busy_timeout = 5000").first();
  db.prepare("PRAGMA journal_mode = WAL").first();
  return db;
}
