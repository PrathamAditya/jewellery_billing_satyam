import { existsSync } from "node:fs";
import type { IntegrityResponse } from "@jewellery/shared";
import { databaseFile, openLocalDatabase, resolveDataDir } from "../local/database";
import { runIntegrityChecks } from "./checks";

/**
 * Spec 052 I17: `npm run integrity -w @jewellery/api` runs the same checks as `GET /api/integrity` on the local
 * database file in JB_DATA_DIR. It only reads: it never creates or migrates the file (Q186).
 * Exit codes: 0 all checks pass, 1 a check fails, 2 no database file (or it could not be read).
 */

export function formatIntegrityReport(result: IntegrityResponse): string[] {
  const lines: string[] = [];
  for (const c of result.checks) {
    if (c.status === "ok") {
      lines.push(`ok    ${c.title}`);
      continue;
    }
    lines.push(`FAIL  ${c.title}: ${c.count} problem${c.count === 1 ? "" : "s"}`);
    for (const p of c.problems) lines.push(`        - ${p.label} (${p.kind} ${p.recordId}): ${p.detail}`);
    if (c.truncated) lines.push(`        ... and ${c.count - c.problems.length} more`);
  }
  lines.push(result.ok ? `All ${result.checks.length} checks passed.` : `${result.failed} of ${result.checks.length} checks failed.`);
  return lines;
}

export async function runIntegrityCli(env: Record<string, string | undefined>, out: (line: string) => void): Promise<number> {
  const dataDir = resolveDataDir(env);
  const file = databaseFile(dataDir);
  if (!existsSync(file)) {
    out(`No database file at ${file}. Nothing was checked. Set JB_DATA_DIR to the folder that holds billing.sqlite.`);
    return 2;
  }
  const db = openLocalDatabase(dataDir);
  try {
    const result = await runIntegrityChecks(db as unknown as D1Database, new Date());
    for (const line of formatIntegrityReport(result)) out(line);
    return result.ok ? 0 : 1;
  } finally {
    db.close();
  }
}

if (process.argv[1] && /integrity[\\/]cli\.ts$/.test(process.argv[1])) {
  runIntegrityCli(process.env, console.log)
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(2);
    });
}
