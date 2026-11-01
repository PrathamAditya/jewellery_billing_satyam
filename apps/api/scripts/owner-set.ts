/**
 * Sets (or resets) the owner's password. Spec 002 R3.
 *   npm run owner:set -- --local     (wrangler's local database)
 *   npm run owner:set -- --remote    (the live Cloudflare database)
 * The password is typed with hidden input. It is never an argument, never printed, never
 * written to disk: only its PBKDF2 hash goes into a short-lived 0600 SQL file.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../src/auth/password.ts";
import { ownerUpsertSql } from "../src/auth/owner.ts";
import { newId } from "../../../packages/shared/src/id.ts";

const MIN_LENGTH = 10; // keep equal to MIN_PASSWORD_LENGTH in packages/shared

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error("This needs a terminal: the password is typed with hidden input."));
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const done = (fn: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      fn();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(value));
        if (ch === "\u0003") return done(() => reject(new Error("Cancelled.")));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const target = args.includes("--remote") ? "--remote" : args.includes("--local") ? "--local" : null;
  if (!target || args.length !== 1) {
    console.error("Usage: npm run owner:set -- --local|--remote");
    process.exit(2);
  }

  // Only for the local test database: OWNER_PASSWORD skips the prompt so browser tests and agents can seed an owner.
  // The live database (--remote) always asks with hidden input.
  const fromEnv = target === "--local" ? process.env.OWNER_PASSWORD : undefined;
  const password = fromEnv ?? (await readHidden("New owner password (hidden): "));
  if (password.length < MIN_LENGTH) throw new Error(`Password must be at least ${MIN_LENGTH} characters.`);
  if (!fromEnv && (await readHidden("Type it again: ")) !== password) throw new Error("The two passwords do not match.");

  const sql = ownerUpsertSql({
    id: newId(),
    passwordHash: await hashPassword(password),
    now: new Date().toISOString(),
    auditId: newId(),
  });

  const dir = mkdtempSync(join(tmpdir(), "owner-set-"));
  const file = join(dir, "owner.sql");
  try {
    writeFileSync(file, sql, { mode: 0o600 });
    const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
    execFileSync("npx", ["wrangler", "d1", "execute", "DB", target, "--file", file], { cwd: apiDir, stdio: "inherit" });
    console.log(`Owner password set (${target.slice(2)}). Username: owner. All earlier sessions were ended.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
