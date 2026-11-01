import { Hono } from "hono";
import {
  CUSTOMER_FIELDS,
  cleanMobile,
  createCustomerSchema,
  newId,
  updateCustomerSchema,
  voidCustomerSchema,
  type CustomerField,
  type CustomerListResponse,
  type CustomerSaveResponse,
  type CustomerWarning,
} from "@jewellery/shared";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { classifyReplay } from "../db/idempotency";
import { CURRENT_CUSTOMER_NO_SQL, allocateCustomerNumberStatement } from "../db/numbering";
import { revisionStatement } from "../db/revisions";
import { readJson, validationBody } from "../http";
import {
  COLUMN_OF,
  diffFields,
  findByMobile,
  findByPan,
  getCustomer,
  loadHistory,
  nameSearchKey,
  toResponse,
  type CustomerRow,
} from "./repo";

export const customerRoutes = new Hono<AppEnv>();

const PAGE_SIZE = 20;

type Fields = Record<CustomerField, string | null>;

const isUniqueError = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(`${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);

function sameContent(row: CustomerRow, f: Fields): boolean {
  return CUSTOMER_FIELDS.every((k) => (row[COLUMN_OF[k]] ?? null) === (f[k] ?? null));
}

function duplicatePan(c: { json: (b: unknown, s: 409) => Response }, other: { id: string; customer_no: string; name: string }) {
  return c.json(
    {
      error: "duplicate_pan",
      message: `This PAN already belongs to ${other.customer_no} ${other.name}`,
      customerId: other.id,
      customerNo: other.customer_no,
      name: other.name,
    },
    409,
  );
}

async function mobileWarnings(db: D1Database, f: Pick<Fields, "mobile" | "altMobile">, exceptId?: string): Promise<CustomerWarning[]> {
  const ids = new Set<string>();
  for (const m of [f.mobile, f.altMobile]) {
    if (m) for (const id of await findByMobile(db, m, exceptId)) ids.add(id);
  }
  return ids.size ? [{ code: "duplicate_mobile", customerIds: [...ids] }] : [];
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

// R8: search by number, name, mobile (3+ digits) or PAN. Exact matches first, then by name.
customerRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const q = (c.req.query("q") ?? "").trim();
  const includeVoided = c.req.query("includeVoided") === "1";
  const offset = Math.max(0, Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0);

  const where: string[] = [];
  const args: unknown[] = [];
  const add = (v: unknown) => {
    args.push(v);
    return `?${args.length}`;
  };
  let rank = "1";

  if (q) {
    const lower = escapeLike(nameSearchKey(q));
    const upper = escapeLike(q.replace(/\s+/g, "").toUpperCase());
    const digitsOnly = /^[\d\s+\-().]+$/.test(q);
    // A full number typed with +91 or 0 is cleaned the same way as when saving (R3), so it still matches.
    const digits = digitsOnly ? (cleanMobile(q) ?? q.replace(/\D/g, "")) : "";
    const numberMatch = /^c-?(\d+)$/i.exec(q);
    const wanted = numberMatch ? `C${numberMatch[1]!.padStart(4, "0")}` : null;

    const ors = [`name_search LIKE ${add(`%${lower}%`)} ESCAPE '\\'`];
    const exact = [`name_search = ${add(nameSearchKey(q))}`];
    if (wanted) {
      const p = add(wanted);
      ors.push(`customer_no = ${p}`);
      exact.push(`customer_no = ${p}`);
    }
    if (digits.length >= 3) {
      ors.push(`mobile LIKE ${add(`%${escapeLike(digits)}%`)} ESCAPE '\\'`, `alt_mobile LIKE ${add(`%${escapeLike(digits)}%`)} ESCAPE '\\'`);
      const p = add(digits);
      exact.push(`mobile = ${p}`, `alt_mobile = ${p}`);
    }
    if (/^[A-Z0-9]{4,10}$/.test(upper)) {
      ors.push(`pan LIKE ${add(`${upper}%`)} ESCAPE '\\'`);
      exact.push(`pan = ${add(upper)}`);
    }
    where.push(`(${ors.join(" OR ")})`);
    rank = `CASE WHEN ${exact.join(" OR ")} THEN 0 ELSE 1 END`;
  }
  if (!includeVoided) where.push("voided_at IS NULL");

  const sql = `SELECT * FROM customers ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${rank}, name_search, id LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`;
  const rows = (await db.prepare(sql).bind(...args).all<CustomerRow>()).results;
  const body: CustomerListResponse = {
    items: rows.slice(0, PAGE_SIZE).map(toResponse),
    nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
  };
  return c.json(body);
});

customerRoutes.post("/", async (c) => {
  const parsed = createCustomerSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const { id: clientId, ...fields } = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");
  const id = clientId ?? newId();

  // R7: a retried create returns the first result.
  const replay = classifyReplay(await getCustomer(db, id), (row) => sameContent(row, fields));
  if (replay.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different customer" }, 409);
  if (replay.kind === "replay") return c.json<CustomerSaveResponse>({ customer: toResponse(replay.row), warnings: [] });

  if (fields.pan) {
    const clash = await findByPan(db, fields.pan);
    if (clash) return duplicatePan(c, clash);
  }
  const warnings = await mobileWarnings(db, fields);

  const now = new Date().toISOString();
  try {
    await db.batch([
      allocateCustomerNumberStatement(db),
      db
        .prepare(
          `INSERT INTO customers
             (id, created_at, created_by, updated_at, updated_by, customer_no, name, name_search,
              mobile, alt_mobile, address, city, pincode, pan, aadhaar, notes)
           VALUES (?1, ?2, ?3, ?2, ?3, ${CURRENT_CUSTOMER_NO_SQL}, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
        )
        .bind(id, now, user.id, fields.name, nameSearchKey(fields.name), fields.mobile, fields.altMobile, fields.address, fields.city, fields.pincode, fields.pan, fields.aadhaar, fields.notes),
      auditStatement(db, { actor: user.id, action: "customer_create", entity: "customer", entityId: id, detail: { name: fields.name } }),
    ]);
  } catch (e) {
    if (!isUniqueError(e)) throw e;
    // Lost a race: same id sent twice at once, or the same PAN saved by someone else a moment ago.
    const again = classifyReplay(await getCustomer(db, id), (row) => sameContent(row, fields));
    if (again.kind === "replay") return c.json<CustomerSaveResponse>({ customer: toResponse(again.row), warnings: [] });
    if (again.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different customer" }, 409);
    const clash = fields.pan ? await findByPan(db, fields.pan) : null;
    if (clash) return duplicatePan(c, clash);
    throw e;
  }
  const created = (await getCustomer(db, id))!;
  return c.json<CustomerSaveResponse>({ customer: toResponse(created), warnings }, 201);
});

customerRoutes.get("/:id", async (c) => {
  const row = await getCustomer(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(toResponse(row));
});

customerRoutes.patch("/:id", async (c) => {
  const parsed = updateCustomerSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const { reason, ...fields } = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");

  const row = await getCustomer(db, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.voided_at) return c.json({ error: "customer_voided", message: "Restore this customer before editing" }, 409);

  const after: Record<string, unknown> = {};
  for (const k of CUSTOMER_FIELDS) if (k in fields) after[COLUMN_OF[k]] = (fields as Partial<Fields>)[k] ?? null;
  const changed = diffFields(row, after);
  if (changed.length === 0) return c.json<CustomerSaveResponse>({ customer: toResponse(row), warnings: [] }); // nothing changed: no revision, no audit

  if (changed.includes("pan") && after.pan) {
    const clash = await findByPan(db, after.pan as string, row.id);
    if (clash) return duplicatePan(c, clash);
  }
  const warnings =
    changed.includes("mobile") || changed.includes("altMobile")
      ? await mobileWarnings(
          db,
          { mobile: (after.mobile ?? row.mobile) as string | null, altMobile: (after.alt_mobile ?? row.alt_mobile) as string | null },
          row.id,
        )
      : [];

  const sets = changed.map((f, i) => `${COLUMN_OF[f]} = ?${i + 4}`);
  const values = changed.map((f) => after[COLUMN_OF[f]]);
  if (changed.includes("name")) {
    sets.push(`name_search = ?${values.length + 4}`);
    values.push(nameSearchKey(after.name as string));
  }
  const now = new Date().toISOString();
  try {
    await db.batch([
      revisionStatement(db, { entity: "customer", entityId: row.id, snapshot: row, reason: reason || undefined, actor: user.id }),
      db
        .prepare(`UPDATE customers SET updated_at = ?2, updated_by = ?3, ${sets.join(", ")} WHERE id = ?1`)
        .bind(row.id, now, user.id, ...values),
      // The audit row names the fields only. Values (Aadhaar above all) stay out of it (R14).
      auditStatement(db, { actor: user.id, action: "customer_update", entity: "customer", entityId: row.id, detail: { changed, reason: reason || undefined } }),
    ]);
  } catch (e) {
    if (!isUniqueError(e)) throw e;
    const clash = after.pan ? await findByPan(db, after.pan as string, row.id) : null;
    if (clash) return duplicatePan(c, clash);
    throw e;
  }
  return c.json<CustomerSaveResponse>({ customer: toResponse((await getCustomer(db, row.id))!), warnings });
});

customerRoutes.get("/:id/history", async (c) => {
  const row = await getCustomer(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ items: await loadHistory(c.env.DB, row) });
});

customerRoutes.post("/:id/void", async (c) => {
  const parsed = voidCustomerSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const db = c.env.DB;
  const user = c.get("user");
  const row = await getCustomer(db, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.voided_at) return c.json({ error: "already_voided" }, 409);
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare("UPDATE customers SET voided_at = ?2, voided_by = ?3, void_reason = ?4, updated_at = ?2, updated_by = ?3 WHERE id = ?1")
      .bind(row.id, now, user.id, parsed.data.reason),
    auditStatement(db, { actor: user.id, action: "customer_void", entity: "customer", entityId: row.id, detail: { reason: parsed.data.reason } }),
  ]);
  return c.json(toResponse((await getCustomer(db, row.id))!));
});

customerRoutes.post("/:id/restore", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const row = await getCustomer(db, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!row.voided_at) return c.json({ error: "not_voided" }, 409);
  if (row.pan) {
    const clash = await findByPan(db, row.pan, row.id);
    if (clash) return duplicatePan(c, clash);
  }
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare("UPDATE customers SET voided_at = NULL, voided_by = NULL, void_reason = NULL, updated_at = ?2, updated_by = ?3 WHERE id = ?1")
        .bind(row.id, now, user.id),
      auditStatement(db, { actor: user.id, action: "customer_restore", entity: "customer", entityId: row.id }),
    ]);
  } catch (e) {
    if (!isUniqueError(e)) throw e;
    const clash = row.pan ? await findByPan(db, row.pan, row.id) : null;
    if (clash) return duplicatePan(c, clash);
    throw e;
  }
  return c.json(toResponse((await getCustomer(db, row.id))!));
});

// R14: the full Aadhaar leaves the server only here, and every reveal is audited first.
customerRoutes.post("/:id/aadhaar/reveal", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const row = await getCustomer(db, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!row.aadhaar) return c.json({ error: "no_aadhaar" }, 404);
  await auditStatement(db, { actor: user.id, action: "aadhaar_reveal", entity: "customer", entityId: row.id }).run();
  return c.json({ aadhaar: row.aadhaar });
});
