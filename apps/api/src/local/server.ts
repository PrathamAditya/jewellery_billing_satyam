import type { Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { createApp } from "../index";
import type { SqliteDatabase } from "../db/sqlite";
import { openLocalDatabase } from "./database";
import { pendingMigrations } from "./migrate";
import { makeWebHandler, webAppReady } from "./static";

/**
 * Spec 081: the API and the built web app as one local Node process, on 127.0.0.1 only.
 * The API is the same `createApp()` the Cloudflare Worker runs; the database is the spec 080 adapter.
 */
export const DEFAULT_WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "web", "dist");
export const LOCAL_HOST = "127.0.0.1";

export type LocalServerOptions = {
  dataDir: string;
  /** The folder with the built web app (index.html). Default: apps/web/dist. */
  webDir?: string;
  /** 0 picks a free port (tests). The real entry uses JB_PORT, default 8765. */
  port: number;
};

export type LocalServer = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

export async function startLocalServer(options: LocalServerOptions): Promise<LocalServer> {
  const webDir = options.webDir ?? DEFAULT_WEB_DIR;
  if (!(await webAppReady(webDir))) {
    throw new Error(`The web app is not built (no index.html in ${webDir}). Run npm run build first.`);
  }

  const db: SqliteDatabase = openLocalDatabase(options.dataDir);
  const pending = await pendingMigrations(db);
  if (pending.length > 0) {
    db.close();
    throw new Error(`The database has ${pending.length} migration(s) not applied. Run npm run local:migrate first.`);
  }

  const api = createApp();
  // The API code reads c.env.DB, as on Cloudflare. The cast is the same one test/helpers.ts makes.
  const env = { DB: db as unknown as D1Database };
  const web = makeWebHandler(webDir);

  let boundPort = options.port;
  const allowedHosts = () => new Set([`${LOCAL_HOST}:${boundPort}`, `localhost:${boundPort}`]);

  const handle = async (request: Request): Promise<Response> => {
    // DNS-rebinding guard: only the loopback names this server answers to.
    const host = request.headers.get("host");
    if (!host || !allowedHosts().has(host)) {
      return new Response("Host not allowed", { status: 403 });
    }
    const path = new URL(request.url).pathname;
    if (path === "/api" || path.startsWith("/api/")) return api.fetch(request, env);
    return web(request);
  };

  // serve() returns a plain HTTP server here (no TLS, no HTTP/2), so the cast is safe.
  const server = serve({ fetch: handle, hostname: LOCAL_HOST, port: options.port }) as ServerType as Server;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== LOCAL_HOST) {
    server.close();
    db.close();
    throw new Error("The local server did not bind to 127.0.0.1");
  }
  boundPort = address.port;

  return {
    url: `http://${LOCAL_HOST}:${boundPort}`,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
