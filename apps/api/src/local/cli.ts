import { resolveDataDir, openLocalDatabase } from "./database";
import { migrateLocalDatabase, pendingMigrations } from "./migrate";
import { setLocalOwnerPassword } from "./owner";

/**
 * Spec 081 scripts: `npm run local:migrate` and `npm run local:owner`.
 * Migrations are a temporary step (spec 082 replaces it with the real runner). The owner password comes only from
 * the OWNER_PASSWORD environment variable, never from a file or an argument.
 */
async function main() {
  const command = process.argv[2];
  const dataDir = resolveDataDir(process.env);

  if (command === "migrate") {
    const db = openLocalDatabase(dataDir);
    try {
      const applied = await migrateLocalDatabase(db);
      console.log(applied.length ? `Applied ${applied.length} migration(s) to ${dataDir}: ${applied.join(", ")}` : `No new migrations. Database: ${dataDir}`);
    } finally {
      db.close();
    }
    return;
  }

  if (command === "owner") {
    const password = process.env.OWNER_PASSWORD;
    if (!password) throw new Error("Set OWNER_PASSWORD in the environment (at least 10 characters).");
    const db = openLocalDatabase(dataDir);
    try {
      if ((await pendingMigrations(db)).length > 0) throw new Error("Run npm run local:migrate first.");
      await setLocalOwnerPassword(db, password);
      console.log(`Owner password set on the local database in ${dataDir}. Username: owner. All earlier sessions were ended.`);
    } finally {
      db.close();
    }
    return;
  }

  throw new Error("Usage: cli.ts migrate | owner");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
