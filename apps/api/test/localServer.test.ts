import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { request as httpRequest } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLocalServer, type LocalServer } from "../src/local/server";
import { openLocalDatabase } from "../src/local/database";
import { migrateLocalDatabase } from "../src/local/migrate";
import { setLocalOwnerPassword } from "../src/local/owner";

/**
 * Spec 081: the local server entry. Runs on a temporary port, a temporary data folder and a stand-in web folder,
 * so it does not need the real build. Uses the default SQLite backend (the adapter from spec 080).
 */
const PASSWORD = "test-owner-pass-1";
let dataDir: string;
let webDir: string;
let server: LocalServer;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "jb-local-test-"));
  dataDir = join(root, "data");
  webDir = join(root, "web");
  mkdirSync(join(webDir, "assets"), { recursive: true });
  writeFileSync(join(webDir, "index.html"), "<!doctype html><title>Test web</title><p>web index</p>");
  writeFileSync(join(webDir, "assets", "app.js"), "console.log('app');");

  const db = openLocalDatabase(dataDir);
  await migrateLocalDatabase(db);
  await setLocalOwnerPassword(db, PASSWORD);
  db.close();

  server = await startLocalServer({ dataDir, webDir, port: 0 });
});

afterAll(async () => {
  await server?.close();
  if (dataDir) rmSync(join(dataDir, ".."), { recursive: true, force: true });
});

async function login(password = PASSWORD): Promise<{ status: number; cookie: string | null; setCookie: string | null }> {
  const res = await fetch(`${server.url}/api/auth/login`, {
    method: "POST",
    // Origin: the API refuses changes from another origin (spec 002 R10); the browser sends this itself.
    headers: { "Content-Type": "application/json", Origin: server.url },
    body: JSON.stringify({ username: "owner", password }),
  });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-session=")) ?? null;
  return { status: res.status, cookie: setCookie ? setCookie.split(";")[0]! : null, setCookie };
}

describe("local server (spec 081)", () => {
  it("binds to 127.0.0.1 on the port it reports", () => {
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    expect(server.port).toBeGreaterThan(0);
  });

  it("answers /api/health with the database status", async () => {
    const res = await fetch(`${server.url}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; db: string; service: string };
    expect(body).toMatchObject({ status: "ok", db: "ok", service: "jewellery-billing" });
  });

  it("serves the web index at / with an HTML content type and no-cache", async () => {
    const res = await fetch(`${server.url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("web index");
  });

  it("serves built assets with the JavaScript content type and a long cache", async () => {
    const res = await fetch(`${server.url}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("returns index.html for an unknown non-API path (hash routing safety net)", async () => {
    const res = await fetch(`${server.url}/customers/unknown/page`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain("web index");
  });

  it("refuses a POST to a non-API path with 405", async () => {
    const res = await fetch(`${server.url}/`, { method: "POST", headers: { Origin: server.url }, body: "x" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  it("refuses a path that leaves the web folder", async () => {
    const res = await fetch(`${server.url}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
    expect(res.status).toBe(400);
  });

  it("refuses a request whose Host is not the loopback address", async () => {
    // fetch() does not let a script set Host, so this uses node:http.
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port: server.port, path: "/", headers: { Host: "evil.example" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("answers an unknown /api path with the JSON 404 once logged in, never index.html", async () => {
    const session = await login();
    expect(session.status).toBe(200);
    const res = await fetch(`${server.url}/api/no-such-thing`, { headers: { Cookie: session.cookie! } });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("refuses an unknown /api path without a login (JSON 401, not HTML)", async () => {
    const res = await fetch(`${server.url}/api/no-such-thing`);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("logs in with the owner password and sets the __Host-session cookie (Secure, HttpOnly)", async () => {
    const session = await login();
    expect(session.status).toBe(200);
    expect(session.setCookie).toContain("HttpOnly");
    expect(session.setCookie).toContain("Secure");
    expect(session.setCookie).toContain("Path=/");
    const me = await fetch(`${server.url}/api/auth/me`, { headers: { Cookie: session.cookie! } });
    expect(me.status).toBe(200);
  });

  it("refuses a wrong password and sets no session cookie", async () => {
    const session = await login("not-the-owner-password");
    expect(session.status).not.toBe(200);
    expect(session.cookie).toBeNull();
  });

  it("is not reachable on the machine's other network addresses", async () => {
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal);
    if (!lan) return; // no network interface on this machine: nothing to check against
    const result = await new Promise<string>((resolve) => {
      const socket = connect({ host: lan.address, port: server.port });
      socket.once("connect", () => {
        socket.destroy();
        resolve("connected");
      });
      socket.once("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? "error"));
    });
    expect(result).toBe("ECONNREFUSED");
  });
});

describe("local server refuses an unmigrated database", () => {
  it("does not start on an empty data folder", async () => {
    const empty = mkdtempSync(join(tmpdir(), "jb-local-empty-"));
    try {
      await expect(startLocalServer({ dataDir: join(empty, "data"), webDir, port: 0 })).rejects.toThrow(/local:migrate/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
