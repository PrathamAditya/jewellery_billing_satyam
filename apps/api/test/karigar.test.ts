import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, type KarigarDetailResponse, type KarigarJobResponse, type KarigarListResponse, type KarigarStatementResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

/** Spec 023: karigar job work. One test per rule (K1 to K20), on the real database schema and triggers. */

let t: Awaited<ReturnType<typeof createTestDb>>;
const app = createApp({ now: () => new Date("2026-11-02T10:00:00.000Z") });
const PASSWORD = "a long test password";
const cookies: Record<string, string> = {};

type Opts = { method?: string; body?: unknown; as?: string };
function call(path: string, o: Opts = {}) {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = {};
  if (cookies[o.as ?? "owner"]) headers.Cookie = cookies[o.as ?? "owner"]!;
  if (method !== "GET") headers.Origin = "http://localhost";
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: o.body === undefined || method === "GET" ? undefined : JSON.stringify(o.body) }, { DB: t.db });
}
const one = async <T>(sql: string, ...args: unknown[]) => t.db.prepare(sql).bind(...args).first<T>();
const count = async (sql: string, ...args: unknown[]) => (await one<{ n: number }>(sql, ...args))!.n;
const json = async <T>(res: Response) => (await res.json()) as T;
const errorBody = async (res: Response) => (await res.json()) as { error: string; message?: string; issues?: { field: string; message: string }[] };

async function person(username: string, role: string) {
  await t.db
    .prepare(`INSERT INTO users (id, created_at, created_by, updated_at, updated_by, username, password_hash, role, display_name)
              VALUES (?1, '2026-11-02T00:00:00.000Z', 'test', '2026-11-02T00:00:00.000Z', 'test', ?2, ?3, ?4, ?2)`)
    .bind(`u-${username}`, username, await hashPassword(PASSWORD, 1000), role)
    .run();
  const res = await call("/api/auth/login", { method: "POST", body: { username, password: PASSWORD } });
  cookies[username] = res.headers.get("set-cookie")!.split(";")[0]!;
}

beforeAll(async () => {
  t = await createTestDb();
  await person("owner", "owner");
  await person("manager1", "manager");
  await person("staff1", "staff");
  await person("viewer1", "viewer");
});
afterAll(() => t.dispose());

const SHOWROOM = "loc-showroom";
const KARIGAR_PLACE = "loc-karigar";
const G22 = "22K916";

// ---- builders ----
/** Buys raw gold into the Showroom (spec 022), so there is metal to issue. */
async function buyRawGold(weightMg: number) {
  const res = await call("/api/inventory/purchases", {
    method: "POST",
    body: {
      purchaseType: "raw_metal",
      purchaseDate: "2026-11-02",
      supplierName: "Bullion Dealer",
      lines: [{ kind: "raw_metal", metal: "gold", purity: G22, weightMg, amountPaise: null }],
    },
  });
  expect(res.status).toBe(201);
}
const rawAt = async (purity: string, placeId: string) =>
  (await one<{ w: number }>("SELECT COALESCE(SUM(weight_mg), 0) AS w FROM raw_metal_movements WHERE metal = 'gold' AND purity = ?1 AND location_id = ?2", purity, placeId))!.w;
let karigarSeq = 0;
async function newKarigar(name = `Test Karigar ${++karigarSeq}`, phone = "98765 43210") {
  const res = await call("/api/karigar/karigars", { method: "POST", body: { name, phone, remarks: null } });
  expect(res.status).toBe(201);
  return (await json<{ karigar: { id: string } }>(res)).karigar.id;
}
type JobOpts = { karigarId: string; jobDate?: string; basis?: "gram" | "piece"; rate?: number; bps?: number; source?: string; issues?: { metal: string; purity: string; weightMg: number }[] };
function openJob(o: JobOpts, as = "owner") {
  return call("/api/karigar/jobs", {
    method: "POST",
    as,
    body: {
      id: newId(),
      karigarId: o.karigarId,
      jobDate: o.jobDate ?? "2026-11-02",
      sourceLocationId: o.source ?? SHOWROOM,
      labourBasis: o.basis ?? "gram",
      labourRatePaise: o.rate ?? 15_000,
      wastageBps: o.bps ?? 200,
      issues: o.issues ?? [{ metal: "gold", purity: G22, weightMg: 100_000 }],
    },
  });
}
const jobOf = async (res: Response) => (await json<KarigarJobResponse>(res)).job;
const returnLines = (jobId: string, lines: unknown[], as = "owner") =>
  call(`/api/karigar/jobs/${jobId}/returns`, { method: "POST", as, body: { id: newId(), returnDate: "2026-11-03", lines } });
const finished = (weightMg: number, pieces: number, purity = G22) => ({ part: "finished", purity, weightMg, pieces, testedPurity: purity });
const remainder = (weightMg: number, purity = G22) => ({ part: "remainder", purity, weightMg });
const closeJob = (jobId: string, as = "owner") => call(`/api/karigar/jobs/${jobId}/close`, { method: "POST", as, body: { closeDate: "2026-11-04", remarks: null } });
const payOut = (karigarId: string, amountPaise: number, mode = "upi", as = "owner") =>
  call(`/api/karigar/karigars/${karigarId}/payouts`, { method: "POST", as, body: { id: newId(), payoutDate: "2026-11-05", amountPaise, paymentMode: mode, reference: "UPI-TEST-1", remarks: null } });
const statementOf = async (karigarId: string) => json<KarigarStatementResponse>(await call(`/api/karigar/karigars/${karigarId}/statement`));
const karigarOf = async (karigarId: string) => json<KarigarDetailResponse>(await call(`/api/karigar/karigars/${karigarId}`));

// ---- K1, K2: karigars and job numbers ----
describe("karigars and job numbers (K1, K2)", () => {
  it("K1: a karigar has a name and a phone; a blank name is refused with a field message", async () => {
    const ok = await call("/api/karigar/karigars", { method: "POST", body: { name: "Ram Kishan", phone: "9800000001" } });
    expect(ok.status).toBe(201);
    const bad = await call("/api/karigar/karigars", { method: "POST", body: { name: "   " } });
    expect(bad.status).toBe(400);
    expect((await errorBody(bad)).issues?.[0]?.field).toBe("name");
  });

  it("K1: the karigar list shows the karigar with no balance yet", async () => {
    const id = await newKarigar("List Karigar");
    const list = await json<KarigarListResponse>(await call("/api/karigar/karigars"));
    const row = list.items.find((k) => k.id === id);
    expect(row).toMatchObject({ name: "List Karigar", openJobs: 0, balances: [], labourPayablePaise: 0 });
  });

  it("K2: a job gets a JOB- number for its financial year, and the next job in the same year counts on", async () => {
    await buyRawGold(1_000_000);
    const k = await newKarigar();
    const first = await jobOf(await openJob({ karigarId: k }));
    const second = await jobOf(await openJob({ karigarId: k }));
    expect(first.jobNo).toMatch(/^JOB-\d{4}$/);
    expect(second.jobNo).toBe(`JOB-${String(Number(first.jobNo.slice(4)) + 1).padStart(4, "0")}`);
    expect(first.status).toBe("open");
  });

  it("K2: numbers restart on 1 April (the first job of 2027-28 is JOB-0001)", async () => {
    const k = await newKarigar();
    await buyRawGold(100_000);
    const job = await jobOf(await openJob({ karigarId: k, jobDate: "2027-04-01", issues: [{ metal: "gold", purity: G22, weightMg: 1_000 }] }));
    expect(job.jobNo).toBe("JOB-0001");
    const stored = await one<{ fy: string }>("SELECT fy FROM karigar_jobs WHERE job_no = 'JOB-0001' AND fy = '2027-28'");
    expect(stored?.fy).toBe("2027-28");
  });
});

// ---- K3, K4: issue ----
describe("issue of metal (K3, K4)", () => {
  it("K4: issue reduces the shop's raw stock at the source place and raises the Karigar place by the same weight", async () => {
    await buyRawGold(500_000);
    const k = await newKarigar();
    const shopBefore = await rawAt(G22, SHOWROOM);
    const karigarBefore = await rawAt(G22, KARIGAR_PLACE);
    const job = await jobOf(await openJob({ karigarId: k, issues: [{ metal: "gold", purity: G22, weightMg: 100_000 }] }));
    expect(await rawAt(G22, SHOWROOM)).toBe(shopBefore - 100_000);
    expect(await rawAt(G22, KARIGAR_PLACE)).toBe(karigarBefore + 100_000);
    expect(job.issued).toEqual([{ metal: "gold", purity: G22, weightMg: 100_000 }]);
    expect(await count("SELECT COUNT(*) AS n FROM raw_metal_movements WHERE karigar_entry_id IS NOT NULL AND reason = 'Issued on ' || ?1", job.jobNo)).toBe(2);
  });

  it("K4: an issue more than the source place holds is refused and nothing is written", async () => {
    const k = await newKarigar();
    const shopBefore = await rawAt(G22, SHOWROOM);
    const res = await openJob({ karigarId: k, issues: [{ metal: "gold", purity: G22, weightMg: shopBefore + 1 }] });
    expect(res.status).toBe(409);
    expect((await errorBody(res)).error).toBe("raw_stock_short");
    expect(await count("SELECT COUNT(*) AS n FROM karigar_jobs WHERE karigar_id = ?1", k)).toBe(0);
    expect(await rawAt(G22, SHOWROOM)).toBe(shopBefore);
  });

  it("K5: a later delivery adds to an open job, and the job shows both deliveries", async () => {
    const k = await newKarigar();
    const job = await jobOf(await openJob({ karigarId: k, issues: [{ metal: "gold", purity: G22, weightMg: 40_000 }] }));
    const res = await call(`/api/karigar/jobs/${job.id}/issues`, { method: "POST", body: { id: newId(), issueDate: "2026-11-02", issues: [{ metal: "gold", purity: G22, weightMg: 60_000 }] } });
    expect(res.status).toBe(201);
    expect((await jobOf(res)).issued).toEqual([{ metal: "gold", purity: G22, weightMg: 100_000 }]);
  });

  it("K3: a job needs at least one metal line, and a silver purity must fit silver", async () => {
    const k = await newKarigar();
    const none = await openJob({ karigarId: k, issues: [] });
    expect(none.status).toBe(400);
    const wrong = await openJob({ karigarId: k, issues: [{ metal: "silver", purity: G22, weightMg: 1_000 }] });
    expect(wrong.status).toBe(400);
  });
});

// ---- K6, K7, K9, K10: returns, labour, wastage, close ----
describe("returns, wastage and close (K6, K7, K9, K10)", () => {
  it("K6, K9, K10: a return within the allowance closes cleanly; the held grams are written as wastage and the Karigar place is back where it was", async () => {
    await buyRawGold(300_000);
    const k = await newKarigar();
    const karigarStart = await rawAt(G22, KARIGAR_PLACE);
    const job = await jobOf(await openJob({ karigarId: k, issues: [{ metal: "gold", purity: G22, weightMg: 100_000 }] }));
    const ret = await returnLines(job.id, [finished(97_000, 3), remainder(1_500)]);
    expect(ret.status).toBe(201);
    const afterReturn = (await jobOf(ret)).totals[0]!;
    expect(afterReturn).toMatchObject({ issuedMg: 100_000, finishedMg: 97_000, remainderMg: 1_500, wastageMg: 0, heldMg: 1_500, allowanceMg: 2_000 });

    const closed = await closeJob(job.id);
    expect(closed.status).toBe(200);
    const closedJob = await jobOf(closed);
    expect(closedJob.status).toBe("closed");
    expect(closedJob.totals[0]).toMatchObject({ wastageMg: 1_500, heldMg: 0 });
    expect(await rawAt(G22, KARIGAR_PLACE)).toBe(karigarStart);
    expect(await count("SELECT COUNT(*) AS n FROM karigar_job_entries WHERE job_id = ?1 AND kind = 'wastage' AND weight_mg = 1500", job.id)).toBe(1);
  });

  it("K10: wastage beyond the allowance is refused with 409; nothing is written and the job stays open; a further return makes it close", async () => {
    const k = await newKarigar();
    const job = await jobOf(await openJob({ karigarId: k, issues: [{ metal: "gold", purity: G22, weightMg: 100_000 }] }));
    expect((await returnLines(job.id, [finished(95_000, 2), remainder(1_000)])).status).toBe(201); // 4.000 g still held, allowance 2.000 g
    const refused = await closeJob(job.id);
    expect(refused.status).toBe(409);
    const body = await errorBody(refused);
    expect(body.error).toBe("wastage_over_allowance");
    expect(body.message).toContain("4.000 g");
    expect((await jobOf(await call(`/api/karigar/jobs/${job.id}`))).status).toBe("open");
    expect(await count("SELECT COUNT(*) AS n FROM karigar_job_entries WHERE job_id = ?1 AND kind = 'wastage'", job.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'karigar_close' AND entity_id = ?1", job.id)).toBe(0);

    expect((await returnLines(job.id, [remainder(2_500)])).status).toBe(201); // 1.500 g held, within the allowance
    expect((await closeJob(job.id)).status).toBe(200);
  });

  it("K6: a return of more than the karigar holds on the job is refused (409 return_exceeds_holding)", async () => {
    const k = await newKarigar();
    const job = await jobOf(await openJob({ karigarId: k, issues: [{ metal: "gold", purity: G22, weightMg: 10_000 }] }));
    const res = await returnLines(job.id, [finished(10_001, 1)]);
    expect(res.status).toBe(409);
    expect((await errorBody(res)).error).toBe("return_exceeds_holding");
    expect(await count("SELECT COUNT(*) AS n FROM karigar_job_entries WHERE job_id = ?1 AND kind = 'return'", job.id)).toBe(0);
  });

  it("K8: the tested purity must match the purity of the line (409 purity_mismatch)", async () => {
    const k = await newKarigar();
    const job = await jobOf(await openJob({ karigarId: k, issues: [{ metal: "gold", purity: G22, weightMg: 10_000 }] }));
    const res = await returnLines(job.id, [{ part: "finished", purity: G22, weightMg: 9_000, pieces: 1, testedPurity: "18K750" }]);
    expect(res.status).toBe(409);
    expect((await errorBody(res)).error).toBe("purity_mismatch");
  });

  it("K7: labour per gram: 97.000 g finished at ₹150 per gram is ₹14,550.00", async () => {
    const k = await newKarigar();
    const job = await jobOf(await openJob({ karigarId: k, basis: "gram", rate: 15_000, issues: [{ metal: "gold", purity: G22, weightMg: 100_000 }] }));
    const after = await jobOf(await returnLines(job.id, [finished(97_000, 3), remainder(3_000)]));
    expect(after.labourAccruedPaise).toBe(1_455_000);
    expect(after.finishedPieces).toBe(3);
    expect((await karigarOf(k)).karigar.labourPayablePaise).toBe(1_455_000);
  });

  it("K7: labour per piece: 3 pieces at ₹200 each is ₹600.00, and the wastage is not charged labour", async () => {
    const k = await newKarigar();
    const job = await jobOf(await openJob({ karigarId: k, basis: "piece", rate: 20_000, issues: [{ metal: "gold", purity: G22, weightMg: 10_000 }] }));
    const after = await jobOf(await returnLines(job.id, [finished(9_000, 3), remainder(900)]));
    expect(after.labourAccruedPaise).toBe(60_000);
    expect(await count("SELECT COUNT(*) AS n FROM karigar_job_entries WHERE job_id = ?1 AND kind = 'labour'", job.id)).toBe(1);
  });
});

// ---- K12, K13, K16: payouts ----
describe("payouts to the karigar (K12, K13, K16)", () => {
  it("a payout reduces the labour balance; a payout above the balance is refused with the amount owed", async () => {
    const k = await newKarigar();
    const job = await jobOf(await openJob({ karigarId: k, basis: "gram", rate: 15_000, issues: [{ metal: "gold", purity: G22, weightMg: 100_000 }] }));
    await returnLines(job.id, [finished(97_000, 3), remainder(3_000)]);
    expect((await payOut(k, 1_000_000)).status).toBe(201);
    expect((await karigarOf(k)).karigar.labourPayablePaise).toBe(455_000);
    const over = await payOut(k, 455_001);
    expect(over.status).toBe(409);
    expect((await errorBody(over)).error).toBe("payout_over_balance");
    expect((await payOut(k, 455_000)).status).toBe(201);
    expect((await karigarOf(k)).karigar.labourPayablePaise).toBe(0);
  });

  it("K12: a payout takes cash, UPI, bank transfer or cheque, and an unknown mode is refused", async () => {
    const k = await newKarigar();
    const job = await jobOf(await openJob({ karigarId: k, basis: "piece", rate: 10_000, issues: [{ metal: "gold", purity: G22, weightMg: 5_000 }] }));
    await returnLines(job.id, [finished(4_800, 4), remainder(200)]);
    expect((await payOut(k, 10_000, "barter")).status).toBe(400);
    for (const mode of ["cash", "bank_transfer", "cheque"]) expect((await payOut(k, 10_000, mode)).status).toBe(201);
    expect((await karigarOf(k)).karigar.labourPayablePaise).toBe(10_000);
  });
});

// ---- K11: closed jobs ----
describe("a closed job is never edited (K11)", () => {
  it("returns, issues and labour are refused on a closed job, and the database refuses direct writes to it", async () => {
    const k = await newKarigar();
    const job = await jobOf(await openJob({ karigarId: k, issues: [{ metal: "gold", purity: G22, weightMg: 10_000 }] }));
    await returnLines(job.id, [finished(9_800, 2), remainder(200)]);
    expect((await closeJob(job.id)).status).toBe(200);

    const r = await returnLines(job.id, [remainder(1)]);
    expect(r.status).toBe(409);
    expect((await errorBody(r)).error).toBe("job_closed");
    const issue = await call(`/api/karigar/jobs/${job.id}/issues`, { method: "POST", body: { id: newId(), issueDate: "2026-11-02", issues: [{ metal: "gold", purity: G22, weightMg: 1 }] } });
    expect(issue.status).toBe(409);
    expect((await closeJob(job.id)).status).toBe(409);

    await expect(t.db.prepare("UPDATE karigar_jobs SET remarks = 'changed' WHERE id = ?1").bind(job.id).run()).rejects.toThrow(/job_locked/);
    await expect(
      t.db
        .prepare(`INSERT INTO karigar_job_entries (id, created_at, created_by, updated_at, updated_by, karigar_id, job_id, kind, entry_date, at, actor, metal, purity, weight_mg, location_id)
                  VALUES (?1, 'x', 'x', 'x', 'x', ?2, ?3, 'issue', '2026-11-02', 'x', 'x', 'gold', ?4, 1, 'loc-karigar')`)
        .bind(newId(), k, job.id, G22)
        .run(),
    ).rejects.toThrow(/job_closed/);
  });

  it("the entries and karigars are append-only: update and delete are refused", async () => {
    const k = await newKarigar();
    await openJob({ karigarId: k, issues: [{ metal: "gold", purity: G22, weightMg: 1_000 }] });
    const row = await one<{ id: string }>("SELECT id FROM karigar_job_entries WHERE karigar_id = ?1 LIMIT 1", k);
    await expect(t.db.prepare("UPDATE karigar_job_entries SET weight_mg = 2 WHERE id = ?1").bind(row!.id).run()).rejects.toThrow(/append-only/);
    await expect(t.db.prepare("DELETE FROM karigar_job_entries WHERE id = ?1").bind(row!.id).run()).rejects.toThrow(/append-only/);
    await expect(t.db.prepare("DELETE FROM karigars WHERE id = ?1").bind(k).run()).rejects.toThrow(/never deleted/);
  });
});

// ---- K15, K16, K17: the statement balances ----
describe("balances and statement (K15, K16, K17)", () => {
  it("the statement balances to zero metal and zero labour once the job is closed and the labour is paid", async () => {
    const k = await newKarigar();
    const job = await jobOf(await openJob({ karigarId: k, basis: "gram", rate: 15_000, issues: [{ metal: "gold", purity: G22, weightMg: 50_000 }] }));
    await returnLines(job.id, [finished(49_000, 2), remainder(1_000)]);
    const midway = await karigarOf(k);
    expect(midway.karigar.balances).toEqual([]);
    expect(midway.karigar.labourPayablePaise).toBe(735_000);
    expect((await closeJob(job.id)).status).toBe(200);
    expect((await payOut(k, 735_000, "bank_transfer")).status).toBe(201);

    const detail = await karigarOf(k);
    expect(detail.karigar.balances).toEqual([]);
    expect(detail.karigar.labourPayablePaise).toBe(0);
    expect(detail.karigar.labourAccruedPaise).toBe(735_000);
    expect(detail.karigar.labourPaidPaise).toBe(735_000);
    const statement = (await statementOf(k)).statement;
    expect(statement.length).toBeGreaterThanOrEqual(5);
    expect(statement.at(-1)).toMatchObject({ labourPayableAfterPaise: 0, kind: "payout" });
    expect(statement.filter((r) => r.heldAfterMg !== null).at(-1)?.heldAfterMg).toBe(0);
    const jobDetail = await jobOf(await call(`/api/karigar/jobs/${job.id}`));
    expect(jobDetail.totals[0]).toMatchObject({ issuedMg: 50_000, finishedMg: 49_000, remainderMg: 1_000, wastageMg: 0, heldMg: 0 });
  });

  it("K15: while metal is out, the karigar's balance shows it per purity and the job totals show what is still held", async () => {
    const k = await newKarigar();
    await openJob({ karigarId: k, issues: [{ metal: "gold", purity: G22, weightMg: 7_000 }] });
    const detail = await karigarOf(k);
    expect(detail.karigar.balances).toEqual([{ metal: "gold", purity: G22, heldMg: 7_000 }]);
    const list = await json<KarigarListResponse>(await call("/api/karigar/karigars"));
    expect(list.items.find((x) => x.id === k)).toMatchObject({ openJobs: 1, balances: [{ metal: "gold", purity: G22, heldMg: 7_000 }] });
  });

  it("K15: the Karigar place holds the total of all karigars' metal (the invariant of K4 to K10)", async () => {
    const a = await newKarigar();
    const b = await newKarigar();
    const before = await rawAt(G22, KARIGAR_PLACE);
    const ja = await jobOf(await openJob({ karigarId: a, issues: [{ metal: "gold", purity: G22, weightMg: 3_000 }] }));
    await openJob({ karigarId: b, issues: [{ metal: "gold", purity: G22, weightMg: 4_000 }] });
    expect(await rawAt(G22, KARIGAR_PLACE)).toBe(before + 7_000);
    await returnLines(ja.id, [remainder(3_000)]);
    expect(await rawAt(G22, KARIGAR_PLACE)).toBe(before + 4_000);
  });
});

// ---- K18: permissions ----
describe("permissions (K18)", () => {
  it("staff and viewer can read karigars, jobs and statements, and get 403 on every change; the manager can change", async () => {
    const k = await newKarigar();
    const job = await jobOf(await openJob({ karigarId: k, issues: [{ metal: "gold", purity: G22, weightMg: 1_000 }] }));
    for (const as of ["staff1", "viewer1"]) {
      expect((await call("/api/karigar/karigars", { as })).status).toBe(200);
      expect((await call(`/api/karigar/karigars/${k}`, { as })).status).toBe(200);
      expect((await call(`/api/karigar/karigars/${k}/statement`, { as })).status).toBe(200);
      expect((await call("/api/karigar/jobs", { as })).status).toBe(200);
      expect((await call(`/api/karigar/jobs/${job.id}`, { as })).status).toBe(200);
      expect((await openJob({ karigarId: k }, as)).status).toBe(403);
      expect((await returnLines(job.id, [remainder(1)], as)).status).toBe(403);
      expect((await closeJob(job.id, as)).status).toBe(403);
      expect((await payOut(k, 1, "cash", as)).status).toBe(403);
      expect((await call("/api/karigar/karigars", { method: "POST", body: { name: "No" }, as })).status).toBe(403);
    }
    const res = await call("/api/karigar/karigars", { method: "POST", body: { name: `Manager Karigar ${karigarSeq}` }, as: "manager1" });
    expect(res.status).toBe(201);
  });

  it("the role rows carry the karigar permissions (owner and manager edit; staff and viewer view)", async () => {
    const rows = await t.db.prepare("SELECT name, permissions_json FROM roles").all<{ name: string; permissions_json: string }>();
    const perms = Object.fromEntries(rows.results.map((r) => [r.name, JSON.parse(r.permissions_json) as string[]]));
    expect(perms.owner).toEqual(expect.arrayContaining(["karigar.view", "karigar.edit"]));
    expect(perms.manager).toEqual(expect.arrayContaining(["karigar.view", "karigar.edit"]));
    expect(perms.staff).toContain("karigar.view");
    expect(perms.staff).not.toContain("karigar.edit");
    expect(perms.viewer).toContain("karigar.view");
    expect(perms.viewer).not.toContain("karigar.edit");
  });

  it("an unknown karigar or job is 404", async () => {
    expect((await call(`/api/karigar/karigars/${newId()}`)).status).toBe(404);
    expect((await call(`/api/karigar/jobs/${newId()}`)).status).toBe(404);
  });
});

// ---- K2: the number series and the replay of a retried save ----
describe("numbers and retried saves (K2, K19)", () => {
  it("a retried job open with the same id returns the first job and writes nothing again", async () => {
    const k = await newKarigar();
    const id = newId();
    const body = { id, karigarId: k, jobDate: "2026-11-02", sourceLocationId: SHOWROOM, labourBasis: "gram", labourRatePaise: 1000, wastageBps: 200, issues: [{ metal: "gold", purity: G22, weightMg: 2_000 }] };
    const first = await call("/api/karigar/jobs", { method: "POST", body });
    expect(first.status).toBe(201);
    const again = await call("/api/karigar/jobs", { method: "POST", body });
    expect(again.status).toBe(200);
    expect((await jobOf(again)).jobNo).toBe((await jobOf(first)).jobNo);
    expect(await count("SELECT COUNT(*) AS n FROM karigar_job_entries WHERE job_id = ?1 AND kind = 'issue'", id)).toBe(1);
    const other = await call("/api/karigar/jobs", { method: "POST", body: { ...body, issues: [{ metal: "gold", purity: G22, weightMg: 3_000 }] } });
    expect(other.status).toBe(409);
  });

  it("every karigar job save writes an audit row in the same batch (K19)", async () => {
    const k = await newKarigar();
    const job = await jobOf(await openJob({ karigarId: k, issues: [{ metal: "gold", purity: G22, weightMg: 1_000 }] }));
    await returnLines(job.id, [finished(500, 1), remainder(500)]);
    await closeJob(job.id);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ?1 AND action IN ('karigar_job_open', 'karigar_return', 'karigar_close')", job.id)).toBe(3);
    await payOut(k, 1, "cash");
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'karigar_payout' AND entity_id = ?1", k)).toBe(1);
  });
});
