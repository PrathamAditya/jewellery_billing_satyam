import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

/**
 * Spec 081: serves the built web app (apps/web/dist) at `/`. Unknown non-API paths get `index.html`
 * (the web app uses hash routing, so this is a safety net). Paths outside the folder are refused.
 */
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function webAppReady(webDir: string): Promise<boolean> {
  return isFile(resolve(webDir, "index.html"));
}

/** A handler for GET and HEAD requests that are not API requests. */
export function makeWebHandler(webDir: string) {
  const root = resolve(webDir);
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (pathname.includes("\0")) return new Response("Bad request", { status: 400 });

    const file = resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + sep)) return new Response("Bad request", { status: 400 });

    let target = file;
    if (!(await isFile(target))) target = resolve(root, "index.html");
    if (!(await isFile(target))) return new Response("The web app is not built. Run npm run build.", { status: 500 });

    const body = request.method === "HEAD" ? null : await readFile(target);
    // Vite names the files under assets/ with a content hash, so they can be cached for a year.
    const hashed = target.startsWith(resolve(root, "assets") + sep);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": String(body ? body.byteLength : (await stat(target)).size),
        "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}
