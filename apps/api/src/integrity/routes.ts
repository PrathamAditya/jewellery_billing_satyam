import { Hono } from "hono";
import type { AppEnv } from "../env";
import { runIntegrityChecks } from "./checks";

/** Spec 052: read-only data checks (permission integrity.view). Writes nothing. */
export const integrityRoutes = new Hono<AppEnv>();

integrityRoutes.get("/", async (c) => c.json(await runIntegrityChecks(c.env.DB, c.get("now"))));
