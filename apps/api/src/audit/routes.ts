import { Hono } from "hono";
import { auditFilterSchema, type AuditListResponse, type AuditOptionsResponse, type AuditRowResponse } from "@jewellery/shared";
import type { AppEnv } from "../env";

/**
 * Spec 051: the audit history viewer. Read-only: there is no route here that writes to audit_log,
 * and the table itself refuses UPDATE and DELETE (migration 0001).
 */
export const auditRoutes = new Hono<AppEnv>();

const PAGE_SIZE = 20;
const ANONYMOUS = "anonymous";

type DbAudit = {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entity_id: string;
  detail_json: string | null;
  display_name: string | null;
  username: string | null;
};

/** The start of an India business day, as the ISO UTC text that audit_log.at stores. */
const indiaDayStart = (date: string) => new Date(`${date}T00:00:00+05:30`).toISOString();
const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

function actorLabel(actor: string, name: string | null): string {
  if (actor === ANONYMOUS) return "Not logged in (failed login)";
  return name || actor;
}

function toRow(r: DbAudit): AuditRowResponse {
  return {
    id: r.id,
    at: r.at,
    actor: r.actor,
    actorName: actorLabel(r.actor, r.display_name || r.username),
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    detail: r.detail_json === null ? null : (JSON.parse(r.detail_json) as unknown),
  };
}

auditRoutes.get("/", async (c) => {
  const parsed = auditFilterSchema.safeParse({
    from: c.req.query("from") || undefined,
    to: c.req.query("to") || undefined,
    actor: c.req.query("actor") || undefined,
    entity: c.req.query("entity") || undefined,
    action: c.req.query("action") || undefined,
  });
  if (!parsed.success) return c.json({ error: "invalid_date", message: "Dates must look like 2026-11-01" }, 400);
  const f = parsed.data;
  if (f.from && f.to && f.from > f.to) return c.json({ error: "invalid_range", message: "The 'from' date is after the 'to' date" }, 400);
  const offset = Math.max(0, Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0);

  const where: string[] = [];
  const args: unknown[] = [];
  const add = (v: unknown) => (args.push(v), `?${args.length}`);
  if (f.from) where.push(`a.at >= ${add(indiaDayStart(f.from))}`);
  if (f.to) where.push(`a.at < ${add(indiaDayStart(nextDay(f.to)))}`);
  if (f.actor) where.push(`a.actor = ${add(f.actor)}`);
  if (f.entity) where.push(`a.entity = ${add(f.entity)}`);
  if (f.action) where.push(`a.action = ${add(f.action)}`);

  const rows = (
    await c.env.DB.prepare(
      `SELECT a.id, a.at, a.actor, a.action, a.entity, a.entity_id, a.detail_json, u.display_name, u.username
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY a.at DESC, a.id DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
    )
      .bind(...args)
      .all<DbAudit>()
  ).results;

  const body: AuditListResponse = {
    items: rows.slice(0, PAGE_SIZE).map(toRow),
    nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
  };
  return c.json(body);
});

auditRoutes.get("/options", async (c) => {
  const db = c.env.DB;
  const entities = (await db.prepare("SELECT DISTINCT entity AS v FROM audit_log ORDER BY entity LIMIT 200").all<{ v: string }>()).results.map((r) => r.v);
  const actions = (await db.prepare("SELECT DISTINCT action AS v FROM audit_log ORDER BY action LIMIT 300").all<{ v: string }>()).results.map((r) => r.v);
  const actorRows = (
    await db
      .prepare(
        `SELECT DISTINCT a.actor AS id, u.display_name, u.username FROM audit_log a LEFT JOIN users u ON u.id = a.actor ORDER BY a.actor LIMIT 300`,
      )
      .all<{ id: string; display_name: string | null; username: string | null }>()
  ).results;
  const body: AuditOptionsResponse = {
    entities,
    actions,
    actors: actorRows.map((r) => ({ id: r.id, label: actorLabel(r.id, r.display_name || r.username) })),
  };
  return c.json(body);
});
