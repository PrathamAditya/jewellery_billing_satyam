import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApplicableRatesResponse, RateHistoryEntry, RatesListResponse, SaveRateResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let nowMs = Date.parse("2026-11-01T10:00:00.000Z");
const app = createApp({ now: () => new Date(nowMs) });
let cookie = "";
const userId = "owner-user-1";

beforeAll(async () => {
  t = await createTestDb();
  await t.db
    .prepare(
      `INSERT INTO users (id, created_at, created_by, updated_at, updated_by, username, password_hash, role)
       VALUES (?1, '2026-11-01T00:00:00.000Z', 'test', '2026-11-01T00:00:00.000Z', 'test', 'owner', ?2, 'owner')`,
    )
    .bind(userId, await hashPassword("a long test password", 1000))
    .run();
  const res = await call("/api/auth/login", { method: "POST", body: { username: "owner", password: "a long test password" }, auth: false });
  cookie = res.headers.get("set-cookie")!.split(";")[0]!;
});
afterAll(() => t.dispose());

type Opts = { method?: string; body?: unknown; auth?: boolean };
function call(path: string, o: Opts = {}) {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = {};
  if (o.auth !== false && cookie) headers.Cookie = cookie;
  if (method !== "GET") headers.Origin = "http://localhost";
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  const hasBody = o.body !== undefined && method !== "GET";
  return app.request(path, { method, headers, body: hasBody ? JSON.stringify(o.body) : undefined }, { DB: t.db });
}

type Extra = { unit?: "gram" | "kg"; reason?: string; confirmLargeChange?: boolean };
const put = (date: string, kind: string, price: string, extra: Extra = {}) =>
  call(`/api/rates/${date}/${kind}`, { method: "PUT", body: { price, unit: extra.unit ?? "gram", reason: extra.reason, confirmLargeChange: extra.confirmLargeChange } });
const saved = async (res: Response) => (await res.json()) as SaveRateResponse;
const one = async <T>(sql: string, ...args: unknown[]) => t.db.prepare(sql).bind(...args).first<T>();
const count = async (sql: string, ...args: unknown[]) => (await one<{ n: number }>(sql, ...args))!.n;
const applicable = async (date?: string) => {
  const res = await call(`/api/rates/applicable${date ? `?date=${date}` : ""}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ApplicableRatesResponse;
};
const audits = async (entityId: string) =>
  (await t.db.prepare("SELECT action, detail_json, actor FROM audit_log WHERE entity_id = ?1 ORDER BY at, id").bind(entityId).all<{ action: string; detail_json: string | null; actor: string }>()).results;

describe("access (R13)", () => {
  it("every rates route needs a login", async () => {
    for (const [method, path] of [
      ["GET", "/api/rates/applicable"],
      ["GET", "/api/rates"],
      ["PUT", "/api/rates/2026-11-01/silver"],
      ["GET", "/api/rates/2026-11-01/silver/history"],
    ] as const) {
      expect((await call(path, { method, body: {}, auth: false })).status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("entry and conversion (R1 to R4)", () => {
  const cases: [string, string, "gram" | "kg", number][] = [
    ["gold_24k995", "12,000", "gram", 1_200_000_000],
    ["gold_24k995", "1,20,00,000", "kg", 1_200_000_000],
    ["gold_22k916", "₹ 11,000.5", "gram", 1_100_050_000],
    ["silver", "150", "gram", 15_000_000],
    ["silver", "150.123", "gram", 15_012_300],
    ["silver", "1,50,123", "kg", 15_012_300],
    ["silver", "1,50,123.45", "kg", 15_012_345],
  ];
  it.each(cases)("%s %j per %s is stored as %d paise per kg", async (kind, typed, unit, expected) => {
    // one date per case keeps the cases independent
    const date = `2026-0${cases.findIndex((c) => c[0] === kind && c[1] === typed) + 1}-15`;
    const res = await put(date, kind, typed, { unit });
    expect(res.status).toBe(201);
    expect((await saved(res)).rate).toMatchObject({ date, kind, pricePaisePerKg: expected });
    expect((await one<{ price_paise_per_kg: number }>("SELECT price_paise_per_kg FROM rates WHERE rate_date = ?1 AND kind = ?2", date, kind))!.price_paise_per_kg).toBe(expected);
  });

  const bad: [string, "gram" | "kg"][] = [
    ["150.1234", "gram"],
    ["1,50,000.555", "kg"],
    ["0", "kg"],
    ["-5", "kg"],
    ["abc", "gram"],
    ["", "gram"],
    ["10,00,00,001", "kg"],
    ["1,00,001", "gram"],
  ];
  it.each(bad)("rejects %j per %s with a message under the price field", async (typed, unit) => {
    const before = await count("SELECT COUNT(*) AS n FROM rates");
    const res = await put("2026-09-01", "silver", typed, { unit });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: { field: string; message: string }[] };
    expect(body.error).toBe("validation");
    expect(body.issues[0]!.field).toBe("price");
    expect(await count("SELECT COUNT(*) AS n FROM rates")).toBe(before);
  });

  it("an unknown kind is 400, and a missing body is 400", async () => {
    expect((await put("2026-09-02", "platinum", "100")).status).toBe(400);
    expect((await call("/api/rates/2026-09-02/silver", { method: "PUT", body: {} })).status).toBe(400);
  });

  it("the database refuses a zero price and an unknown kind even if the API were bypassed", async () => {
    const insert = (kind: string, price: number) =>
      t.db.prepare("INSERT INTO rates (id, created_at, created_by, updated_at, updated_by, rate_date, kind, price_paise_per_kg) VALUES (?1,'x','x','x','x','2026-01-01',?2,?3)").bind(`raw-${kind}-${price}`, kind, price).run();
    await expect(insert("silver", 0)).rejects.toThrow(/CHECK|constraint/i);
    await expect(insert("copper", 5)).rejects.toThrow(/CHECK|constraint/i);
  });

  it("created_by and updated_by are the logged-in user", async () => {
    const res = await put("2026-09-03", "silver", "150");
    const { rate } = await saved(res);
    expect(rate.updatedBy).toBe(userId);
    expect((await one<{ created_by: string }>("SELECT created_by FROM rates WHERE id = ?1", rate.id))!.created_by).toBe(userId);
  });
});

describe("applicable rate (R8, R9)", () => {
  beforeAll(async () => {
    await put("2018-10-01", "gold_24k995", "12,000");
    await put("2018-10-04", "gold_24k995", "12,200");
  });

  it("follows the spec table, and other kinds with no rate are null", async () => {
    const pick = async (d: string) => (await applicable(d)).rates.gold_24k995;
    expect(await pick("2018-09-30")).toBeNull();
    expect(await pick("2018-10-01")).toEqual({ pricePaisePerKg: 1_200_000_000, rateDate: "2018-10-01", carriedForward: false });
    expect(await pick("2018-10-03")).toEqual({ pricePaisePerKg: 1_200_000_000, rateDate: "2018-10-01", carriedForward: true });
    expect(await pick("2018-10-04")).toEqual({ pricePaisePerKg: 1_220_000_000, rateDate: "2018-10-04", carriedForward: false });
    expect(await pick("2018-10-09")).toEqual({ pricePaisePerKg: 1_220_000_000, rateDate: "2018-10-04", carriedForward: true });
    expect((await applicable("2018-10-09")).rates.gold_22k916).toBeNull();
  });

  it("defaults to today (India date) and returns all three kinds", async () => {
    const body = await applicable();
    expect(body.date).toBe("2026-11-01");
    expect(Object.keys(body.rates).sort()).toEqual(["gold_22k916", "gold_24k995", "silver"]);
  });

  it("a rate saved later for a past date changes the answer for that date from then on", async () => {
    expect((await applicable("2018-10-02")).rates.gold_24k995!.rateDate).toBe("2018-10-01");
    await put("2018-10-02", "gold_24k995", "12,050");
    expect((await applicable("2018-10-02")).rates.gold_24k995).toMatchObject({ pricePaisePerKg: 1_205_000_000, carriedForward: false });
    expect((await applicable("2018-10-01")).rates.gold_24k995).toMatchObject({ pricePaisePerKg: 1_200_000_000 });
  });

  it("rejects a bad date", async () => {
    expect((await call("/api/rates/applicable?date=2026-02-30")).status).toBe(400);
  });
});

describe("dates (R6, R7)", () => {
  it("a future date and an impossible date are 400", async () => {
    const future = await put("2026-11-02", "silver", "150");
    expect(future.status).toBe(400);
    expect(await future.json()).toMatchObject({ error: "future_date" });
    expect((await put("2026-02-30", "silver", "150")).status).toBe(400);
    expect((await put("11-01-2026", "silver", "150")).status).toBe(400);
  });

  it("today and any past date are accepted", async () => {
    expect((await put("2026-11-01", "silver", "150")).status).toBe(201);
    expect((await put("2020-01-01", "silver", "50")).status).toBe(201);
  });

  it("'today' is the India date: at 19:00 UTC it is already the next day in India", async () => {
    const saveNow = nowMs;
    nowMs = Date.parse("2026-11-01T19:00:00.000Z"); // 00:30 on 2 Nov in India
    try {
      expect((await put("2026-11-02", "gold_22k916", "11,000")).status).toBe(201);
      expect((await put("2026-11-03", "gold_22k916", "11,000")).status).toBe(400);
      expect((await applicable()).date).toBe("2026-11-02");
    } finally {
      nowMs = saveNow;
    }
  });
});

describe("corrections (R10, R11)", () => {
  const date = "2016-08-01";
  it("an edit keeps the old value as a revision, audits old and new price and the reason, and keeps the id", async () => {
    const first = await saved(await put(date, "gold_24k995", "12,000"));
    const res = await put(date, "gold_24k995", "12,100", { reason: "morning mistake" });
    expect(res.status).toBe(200);
    const edited = await saved(res);
    expect(edited).toMatchObject({ created: false, changed: true });
    expect(edited.rate).toMatchObject({ id: first.rate.id, date, pricePaisePerKg: 1_210_000_000 });
    expect(await count("SELECT COUNT(*) AS n FROM rates WHERE rate_date = ?1 AND kind = 'gold_24k995'", date)).toBe(1);

    const revs = (await t.db.prepare("SELECT snapshot_json, reason, created_by FROM record_revisions WHERE entity = 'rate' AND entity_id = ?1").bind(first.rate.id).all<{ snapshot_json: string; reason: string; created_by: string }>()).results;
    expect(revs).toHaveLength(1);
    expect(JSON.parse(revs[0]!.snapshot_json)).toMatchObject({ price_paise_per_kg: 1_200_000_000 });
    expect(revs[0]).toMatchObject({ reason: "morning mistake", created_by: userId });

    const log = await audits(first.rate.id);
    expect(log.map((a) => a.action)).toEqual(["rate_create", "rate_update"]);
    expect(JSON.parse(log[1]!.detail_json!)).toEqual({ kind: "gold_24k995", date, fromPaisePerKg: 1_200_000_000, toPaisePerKg: 1_210_000_000, reason: "morning mistake" });
    expect(log[1]!.actor).toBe(userId);
  });

  it("saving the same price again changes nothing: no revision, no audit row", async () => {
    const d = "2016-08-02";
    const first = await saved(await put(d, "silver", "150"));
    const again = await put(d, "silver", "1,50,000", { unit: "kg" }); // same price typed another way
    expect(again.status).toBe(200);
    expect(await saved(again)).toMatchObject({ created: false, changed: false });
    expect(await count("SELECT COUNT(*) AS n FROM record_revisions WHERE entity_id = ?1", first.rate.id)).toBe(0);
    expect((await audits(first.rate.id)).map((a) => a.action)).toEqual(["rate_create"]);
  });

  it("history lists every earlier value, newest first, with who and when", async () => {
    const d = "2016-08-03";
    await put(d, "silver", "150");
    await put(d, "silver", "152", { reason: "first fix" });
    await put(d, "silver", "154", { reason: "second fix" });
    const res = await call(`/api/rates/${d}/silver/history`);
    const { items } = (await res.json()) as { items: RateHistoryEntry[] };
    expect(items.map((i) => [i.revisionNo, i.fromPaisePerKg, i.toPaisePerKg, i.reason])).toEqual([
      [2, 15_200_000, 15_400_000, "second fix"],
      [1, 15_000_000, 15_200_000, "first fix"],
    ]);
    expect(items[0]).toMatchObject({ by: userId });
    expect(new Date(items[0]!.at).toString()).not.toBe("Invalid Date");
    expect((await call("/api/rates/2016-08-04/silver/history")).status).toBe(404);
  });

  it("DELETE on rates fails (rates are corrected, never deleted)", async () => {
    await expect(t.db.prepare("DELETE FROM rates").run()).rejects.toThrow(/never deleted/);
  });

  it("two saves for the same date and kind at once leave one row", async () => {
    const d = "2016-08-05";
    const results = await Promise.all([put(d, "gold_22k916", "11,000"), put(d, "gold_22k916", "11,100")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await count("SELECT COUNT(*) AS n FROM rates WHERE rate_date = ?1 AND kind = 'gold_22k916'", d)).toBe(1);
  });
});

describe("typo guard (R12)", () => {
  it("more than 10% from the previous price is 409 and saves nothing; confirming saves it", async () => {
    const d = "2017-07-01";
    await put(d, "gold_24k995", "12,000");
    const res = await put(d, "gold_24k995", "13,500");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "needs_confirmation", previousPaisePerKg: 1_200_000_000, newPaisePerKg: 1_350_000_000, percent: 12.5 });
    expect((await one<{ price_paise_per_kg: number }>("SELECT price_paise_per_kg FROM rates WHERE rate_date = ?1 AND kind = 'gold_24k995'", d))!.price_paise_per_kg).toBe(1_200_000_000);
    const confirmed = await put(d, "gold_24k995", "13,500", { confirmLargeChange: true });
    expect(confirmed.status).toBe(200);
    expect((await saved(confirmed)).rate.pricePaisePerKg).toBe(1_350_000_000);
  });

  it("exactly +10% and exactly -10% need no confirmation", async () => {
    expect((await put("2012-07-02", "silver", "120")).status).toBe(201);
    expect((await put("2012-07-02", "silver", "132")).status).toBe(200); // exactly +10%
    expect((await put("2012-07-02", "silver", "118.8")).status).toBe(200); // 132 -> 118.8 is exactly -10%
  });

  it("a new date is compared with the carried-forward rate, and the very first rate never prompts", async () => {
    await put("2017-06-01", "gold_22k916", "11,000");
    const jump = await put("2017-06-03", "gold_22k916", "13,000"); // +18.2% against the 1 June rate that applies
    expect(jump.status).toBe(409);
    expect((await jump.json() as { previousPaisePerKg: number }).previousPaisePerKg).toBe(1_100_000_000);
    expect((await put("2017-06-03", "gold_22k916", "13,000", { confirmLargeChange: true })).status).toBe(201);
    // first rate ever for a kind on a date with nothing before it
    expect((await put("2010-01-01", "gold_22k916", "99,999")).status).toBe(201);
  });
});

describe("history table (list)", () => {
  it("groups by date, newest first, and pages with a cursor", async () => {
    for (let i = 1; i <= 7; i++) await put(`2025-03-0${i}`, "silver", "100", { confirmLargeChange: true });
    await put("2025-03-03", "gold_24k995", "9,000", { confirmLargeChange: true });
    const first = (await (await call("/api/rates?before=2025-03-08&limit=3")).json()) as RatesListResponse;
    expect(first.items.map((i) => i.date)).toEqual(["2025-03-07", "2025-03-06", "2025-03-05"]);
    expect(first.nextCursor).toBe("2025-03-05");
    const second = (await (await call(`/api/rates?before=${first.nextCursor}&limit=3`)).json()) as RatesListResponse;
    expect(second.items.map((i) => i.date)).toEqual(["2025-03-04", "2025-03-03", "2025-03-02"]);
    expect(Object.keys(second.items[1]!.rates).sort()).toEqual(["gold_24k995", "silver"]);
    // keep paging to the end: every saved date appears exactly once, newest first
    const seen = [...first.items, ...second.items].map((i) => i.date);
    let cursor = second.nextCursor;
    while (cursor) {
      const page = (await (await call(`/api/rates?before=${cursor}&limit=3`)).json()) as RatesListResponse;
      seen.push(...page.items.map((i) => i.date));
      cursor = page.nextCursor;
    }
    const all = (await t.db.prepare("SELECT DISTINCT rate_date FROM rates ORDER BY rate_date DESC").all<{ rate_date: string }>()).results.map((r) => r.rate_date);
    const fromFirstPage = all.filter((d) => d < "2025-03-08");
    expect(seen).toEqual(fromFirstPage);
  });

  it("with no cursor it starts from the newest date", async () => {
    const body = (await (await call("/api/rates?limit=2")).json()) as RatesListResponse;
    expect(body.items[0]!.date).toBe("2026-11-02"); // saved in the India-date test above
  });
});

describe("the client's real invoice (docs/client-invoice-reference.md)", () => {
  it("silver 285.72 per gram is stored as 28,572,000 paise per kg and reads back as 285.72 per gram", async () => {
    // last in the file: it carries forward to later dates, so nothing after it compares against it
    const res = await put("2026-10-31", "silver", "285.72", { confirmLargeChange: true });
    expect(res.status).toBe(201);
    expect((await saved(res)).rate.pricePaisePerKg).toBe(28_572_000);
    expect((await applicable("2026-10-31")).rates.silver).toMatchObject({ pricePaisePerKg: 28_572_000, carriedForward: false });
  });
});
