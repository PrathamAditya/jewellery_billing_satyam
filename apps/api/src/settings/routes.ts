import { Hono } from "hono";
import { SETTINGS_KEYS, settingsSchemas, type SettingsKey, type SettingsSnapshot } from "@jewellery/shared";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { revisionStatement } from "../db/revisions";
import { readJson, validationBody } from "../http";

export const settingsRoutes = new Hono<AppEnv>();
type Row = { key: SettingsKey; value_json: string; updated_at: string; updated_by: string };

export async function settingsSnapshot(db: D1Database): Promise<SettingsSnapshot> {
  const rows = (await db.prepare("SELECT * FROM settings").all<Row>()).results;
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return Object.fromEntries(SETTINGS_KEYS.map((key) => {
    const schema = settingsSchemas[key];
    const value = byKey.get(key) ? JSON.parse(byKey.get(key)!.value_json) : undefined;
    // Business details are intentionally blank until the owner types them; all
    // other settings have safe print defaults.
    if (key === "logo") return [key, value === undefined ? null : schema.parse(value)];
    if (key === "business" && value === undefined) return [key, { legalName: "", tagline: "FINE GOLD · CRAFTED JEWELLERY", addressLines: [], city: "", state: "Himachal Pradesh", stateCode: "02", pincode: "", gstin: "", pan: "", phones: [], email: "" }];
    return [key, schema.parse(value ?? {})];
  })) as SettingsSnapshot;
}

settingsRoutes.get("/", async (c) => c.json(await settingsSnapshot(c.env.DB)));
settingsRoutes.get("/snapshot", async (c) => c.json(await settingsSnapshot(c.env.DB)));
settingsRoutes.put("/:key", async (c) => {
  const key = c.req.param("key") as SettingsKey;
  if (!SETTINGS_KEYS.includes(key)) return c.json({ error: "not_found" }, 404);
  const parsed = settingsSchemas[key].safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const old = await c.env.DB.prepare("SELECT * FROM settings WHERE key = ?1").bind(key).first<Row>();
  const value = JSON.stringify(parsed.data);
  if (old?.value_json === value) return c.json(parsed.data);
  const now = new Date().toISOString();
  const user = c.get("user");
  await c.env.DB.batch([
    ...(old ? [revisionStatement(c.env.DB, { entity: "settings", entityId: key, snapshot: JSON.parse(old.value_json), actor: user.id })] : []),
    c.env.DB.prepare("INSERT INTO settings (key, value_json, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by").bind(key, value, now, user.id),
    auditStatement(c.env.DB, { actor: user.id, action: "settings_update", entity: "settings", entityId: key, detail: { key } }),
  ]);
  return c.json(parsed.data);
});

settingsRoutes.get("/numbering", async (c) => c.json({ items: (await c.env.DB.prepare("SELECT series, fy, last_no FROM number_series ORDER BY series, fy").all()).results }));
settingsRoutes.post("/next-number", async (c) => {
  const b = await readJson(c) as { series?: string; fy?: string; nextNumber?: number };
  if (!b.series || !b.fy || !Number.isInteger(b.nextNumber) || b.nextNumber! < 1) return c.json({ error: "validation", issues: [{ field: "nextNumber", message: "Choose a positive next number" }] }, 400);
  const existing = await c.env.DB.prepare("SELECT last_no FROM number_series WHERE series = ?1 AND fy = ?2").bind(b.series, b.fy).first<{ last_no: number }>();
  if (b.nextNumber! <= (existing?.last_no ?? 0)) return c.json({ error: "number_not_raised", message: "The next number must be higher than the current number" }, 409);
  const user = c.get("user");
  await c.env.DB.batch([c.env.DB.prepare("INSERT INTO number_series (series, fy, last_no) VALUES (?1, ?2, ?3) ON CONFLICT(series, fy) DO UPDATE SET last_no = excluded.last_no").bind(b.series, b.fy, b.nextNumber! - 1), auditStatement(c.env.DB, { actor: user.id, action: "number_set_next", entity: "number_series", entityId: `${b.series}:${b.fy}`, detail: { series: b.series, fy: b.fy, old: existing?.last_no ?? 0, next: b.nextNumber } })]);
  return c.json({ series: b.series, fy: b.fy, nextNumber: b.nextNumber });
});
