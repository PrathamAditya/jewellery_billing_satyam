import { resolveDataDir } from "./database";
import { startLocalServer } from "./server";

/**
 * Spec 081 entry point: `npm run local`. Reads JB_DATA_DIR and JB_PORT, starts the local server on 127.0.0.1,
 * prints the address to open, and stops cleanly on Ctrl+C (SIGINT) or SIGTERM.
 */
function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 8765;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`JB_PORT must be a whole number from 1 to 65535, got "${value}".`);
  }
  return port;
}

async function main() {
  const dataDir = resolveDataDir(process.env);
  const port = parsePort(process.env.JB_PORT);
  const server = await startLocalServer({ dataDir, port });
  console.log(`Jewellery billing is running at ${server.url}`);
  console.log(`Open that address in Chrome. Data folder: ${dataDir}`);
  console.log("Press Ctrl+C to stop.");

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal} received, stopping.`);
    server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
