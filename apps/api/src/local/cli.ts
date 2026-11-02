import { resolveDataDir, openLocalDatabase, databaseFile } from "./database";
import { describeMigrations, runMigrations } from "./migrations";
import { setLocalOwnerPassword } from "./owner";

/**
 * Spec 081 scripts, updated by spec 082: `npm run local:migrate` and `npm run local:owner`.
 * Both run the same migration runner as the server (with a backup before any upgrade). The owner password comes only
 * from the OWNER_PASSWORD environment variable, never from a file or an argument.
 */
async function main() {
  const command = process.argv[2];
  const dataDir = resolveDataDir(process.env);

  if (command === "migrate") {
    const db = openLocalDatabase(dataDir);
    try {
      const report = await runMigrations(db, { databasePath: databaseFile(dataDir) });
      for (const line of describeMigrations(report, dataDir)) console.log(line);
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
      await runMigrations(db, { databasePath: databaseFile(dataDir) });
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
