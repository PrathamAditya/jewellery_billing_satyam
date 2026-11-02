import { crc32 } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { buildReport } from "../src/reports/data";
import { paiseToIndian, type Cell, type ReportTable } from "../src/reports/table";
import { buildPdf } from "../src/reports/pdf";
import { createTestDb } from "./helpers";

// Spec 031: reports in Excel and PDF. The clock is 11:30 on 2 Nov 2026 in India.
let t: Awaited<ReturnType<typeof createTestDb>>;
let nowMs = Date.parse("2026-11-02T06:00:00.000Z");
const app = createApp({ now: () => new Date(nowMs) });
const PASSWORD = "a long test password";
const cookies: Record<string, string> = {};

type Opts = { method?: string; body?: unknown; as?: string };
function call(path: string, o: Opts = {}) {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = {};
  const who = o.as ?? "owner";
  if (cookies[who]) headers.Cookie = cookies[who]!;
  if (method !== "GET") headers.Origin = "http://localhost";
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: o.body === undefined || method === "GET" ? undefined : JSON.stringify(o.body) }, { DB: t.db });
}
async function person(username: string, role: string) {
  await t.db
    .prepare(`INSERT INTO users (id, created_at, created_by, updated_at, updated_by, username, password_hash, role, display_name)
              VALUES (?1, '2026-11-01T00:00:00.000Z', 'test', '2026-11-01T00:00:00.000Z', 'test', ?2, ?3, ?4, ?2)`)
    .bind(`u-${username}`, username, await hashPassword(PASSWORD, 1000), role)
    .run();
  const res = await call("/api/auth/login", { method: "POST", body: { username, password: PASSWORD } });
  cookies[username] = res.headers.get("set-cookie")!.split(";")[0]!;
}

/** Reads a stored (uncompressed) zip: every entry name and text, and checks each CRC with Node's zlib. */
function readZip(bytes: Uint8Array): Record<string, string> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThan(0);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: Record<string, string> = {};
  for (let k = 0; k < count; k++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const loc = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
    expect(dv.getUint32(loc, true)).toBe(0x04034b50);
    const start = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true);
    const data = bytes.subarray(start, start + size);
    expect(method).toBe(0);
    expect(crc32(data)).toBe(crc);
    out[name] = new TextDecoder().decode(data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

const silverLine = (netMg: number) => ({ description: "Silver", purity: "silver", hsn: "7113", grossWeightMg: netMg, netWeightMg: netMg, polishMg: 0, goldRatePaisePerKg: 28_572_000, labourRatePaisePerKg: 0, gstRateBps: 300 });
async function customer(name: string) {
  const res = await call("/api/customers", { method: "POST", body: { name } });
  return ((await res.json()) as { customer: { id: string } }).customer.id;
}
async function invoice(customerId: string, invoiceDate: string, netMg: number, customerName: string) {
  const res = await call("/api/invoices", { method: "POST", body: { invoiceDate, customerId, customerName, taxMode: "intra", lines: [silverLine(netMg)] } });
  return (await res.json()) as { id: string; invoiceNo: string; payablePaise: number };
}
const pay = (body: Record<string, unknown>) => call("/api/payments", { method: "POST", body: { date: "2026-11-02", reference: "REF", ...body } });

const S: Record<string, string | number> = {};
beforeAll(async () => {
  t = await createTestDb();
  await person("owner", "owner");
  await person("manager1", "manager");
  await person("staff1", "staff");
  await person("viewer1", "viewer");
  // Spec 031 R-permissions: a role with no reports permission.
  await t.db
    .prepare(`INSERT INTO roles (name, label, permissions_json, system, created_at, created_by, updated_at, updated_by)
              VALUES ('nosale', 'No reports', '["invoices.view"]', 0, '2026-11-01T00:00:00.000Z', 'test', '2026-11-01T00:00:00.000Z', 'test')`)
    .run();
  await person("nosale1", "nosale");

  const asha = await customer("Asha Verma");
  const ravi = await customer("Ravi Kumar");
  // The spec 013 bill: 9.800 g silver at 285.72 per gram. Taxable 280,006, CGST and SGST 4,200 each, round-off -6, payable 288,400.
  const bill = await invoice(asha, "2026-11-02", 9_800, "Asha Verma");
  expect(bill.payablePaise).toBe(288_400);
  S.billNo = bill.invoiceNo;
  const second = await invoice(ravi, "2026-10-05", 20_000, "Ravi Kumar");
  S.secondNo = second.invoiceNo;
  const voided = await invoice(ravi, "2026-10-06", 5_000, "Ravi Kumar");
  await call(`/api/invoices/${voided.id}/void`, { method: "POST", body: { reason: "Entered in error" } });
  S.voidedNo = voided.invoiceNo;
  // Pending-rate sale: left out of the registers.
  const pending = await call("/api/invoices/pending", { method: "POST", body: { invoiceDate: "2026-11-02", customerId: asha, customerName: "Asha Verma", taxMode: "intra", lines: [{ description: "Pending", purity: "silver", hsn: "7113", grossWeightMg: 3_000, netWeightMg: 3_000, polishMg: 0, labourRatePaisePerKg: 0, gstRateBps: 300 }] } });
  expect(pending.status).toBe(201);
  S.pendingNo = ((await pending.json()) as { invoiceNo: string }).invoiceNo;

  // Payments: one at sale in cash on the bill, a UPI advance, and a voided payment.
  await pay({ customerId: asha, invoiceId: bill.id, purpose: "at_sale", mode: "cash", amountPaise: 100_000 });
  const adv = (await (await pay({ customerId: asha, purpose: "advance", mode: "upi", reference: "UPI-77", amountPaise: 50_000 })).json()) as { payment: { id: string; receiptNo: string } };
  S.advNo = adv.payment.receiptNo;
  const bad = (await (await pay({ customerId: ravi, purpose: "advance", mode: "cash", amountPaise: 9_900 })).json()) as { payment: { id: string; receiptNo: string } };
  await call(`/api/payments/${bad.payment.id}/void`, { method: "POST", body: { reason: "Duplicate" } });
  S.voidedRcpt = bad.payment.receiptNo;
});
afterAll(() => t.dispose());

const xlsxOf = async (query: string, as = "owner") => {
  const res = await call(`/api/reports/${query}`, { as });
  return { res, bytes: res.status === 200 ? new Uint8Array(await res.arrayBuffer()) : null };
};

describe("the Excel file (spec 031 R-Excel)", () => {
  it("opens as a zip with the parts of a workbook, one sheet named after the report", async () => {
    const { res, bytes } = await xlsxOf("sales-register?from=2026-04-01&to=2027-03-31&format=xlsx");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toContain('filename="sales-register_2026-04-01_to_2027-03-31.xlsx"');
    const parts = readZip(bytes!);
    expect(Object.keys(parts).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    expect(parts["xl/workbook.xml"]).toContain('<sheet name="Sales register" sheetId="1"');
    expect(parts["[Content_Types].xml"]).toContain("spreadsheetml.worksheet+xml");
  });

  it("the sheet holds the known values of the bill: taxable, CGST, SGST, total and paid", async () => {
    const { bytes } = await xlsxOf("sales-register?from=2026-04-01&to=2027-03-31");
    const sheet = readZip(bytes!)["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain(`<t xml:space="preserve">${S.billNo}</t>`);
    for (const v of ["2800.06", "42.00", "2884.00", "1000.00"]) expect(sheet).toContain(`<v>${v}</v>`);
    expect(sheet).toContain("<t xml:space=\"preserve\">2 Nov 2026</t>");
  });

  it("money uses Indian grouping in the number format", async () => {
    const { bytes } = await xlsxOf("sales-register?from=2026-04-01&to=2027-03-31");
    const styles = readZip(bytes!)["xl/styles.xml"]!;
    expect(styles).toContain('formatCode="[&gt;=10000000]##\\,##\\,##\\,##0.00;[&gt;=100000]##\\,##\\,##0.00;##,##0.00"');
  });

  it("a voided invoice and a pending-rate sale are not in the file", async () => {
    const { bytes } = await xlsxOf("sales-register?from=2026-04-01&to=2027-03-31");
    const sheet = readZip(bytes!)["xl/worksheets/sheet1.xml"]!;
    expect(sheet).not.toContain(S.voidedNo as string);
    expect(sheet).not.toContain(S.pendingNo as string);
    expect(sheet).toContain(S.secondNo as string);
  });

  it("the payments register lists the voided payment as Voided and leaves it out of the totals", async () => {
    const { bytes } = await xlsxOf("payments-register?from=2026-11-01&to=2026-11-30");
    const sheet = readZip(bytes!)["xl/worksheets/sheet1.xml"]!;
    expect(readZip(bytes!)["xl/workbook.xml"]).toContain('name="Payments register"');
    expect(sheet).toContain("<t xml:space=\"preserve\">Voided</t>");
    // Live money: 1,000.00 at sale plus 500.00 advance. The voided 99.00 is not in the total.
    expect(sheet).toContain("<v>1500.00</v>");
    // The voided row still shows its amount (99.00), but the totals row does not add it (1,599.00 would).
    expect(sheet).not.toContain("<v>1599.00</v>");
  });
});

describe("the reports agree with each other (spec 031 R-GST)", () => {
  it("the GST summary totals equal the sums of the sales register columns", async () => {
    const q = { from: "2026-04-01", to: "2027-03-31", format: "xlsx" as const };
    const register = await buildReport(t.db, "sales-register", q, "2026-11-02");
    const gst = await buildReport(t.db, "gst-summary", q, "2026-11-02");
    const reg = register.totals!;
    const g = gst.totals!;
    const val = (c: Cell) => (typeof c === "object" && c !== null ? c.paise : Number.NaN);
    // Register: taxable (3), CGST (4), SGST (5), IGST (6). GST summary: taxable (1), CGST (2), SGST (3), IGST (4).
    expect(val(g[1]!)).toBe(val(reg[3]!));
    expect(val(g[2]!)).toBe(val(reg[4]!));
    expect(val(g[3]!)).toBe(val(reg[5]!));
    expect(val(g[4]!)).toBe(val(reg[6]!));
    expect(gst.rows.length).toBe(1);
    expect(gst.rows[0]![0]).toBe("3%");
  });

  it("the register's bill row carries the stored figures", async () => {
    const reg = await buildReport(t.db, "sales-register", { from: "2026-11-02", to: "2026-11-02", format: "xlsx" }, "2026-11-02");
    expect(reg.rows).toHaveLength(1);
    const row = reg.rows[0]!;
    expect(row[0]).toBe(S.billNo);
    expect(row[3]).toEqual({ paise: 280_006 });
    expect(row[7]).toEqual({ paise: 288_400 });
    expect(row[8]).toEqual({ paise: 100_000 });
    expect(row[9]).toEqual({ paise: 188_400 });
  });

  it("outstanding by customer is as on the day made and ignores the period", async () => {
    const out = await buildReport(t.db, "outstanding", { from: "2020-01-01", to: "2020-01-02", format: "xlsx" }, "2026-11-02");
    expect(out.subtitle).toBe("As on 2 Nov 2026");
    // Largest first.
    expect(out.rows.map((r) => r[0])).toEqual(["Ravi Kumar", "Asha Verma"]);
    const asha = out.rows.find((r) => r[0] === "Asha Verma")!;
    expect(asha[2]).toEqual({ paise: 188_400 });
  });
});

describe("the PDF file (spec 031 R-PDF)", () => {
  it("is a PDF whose cross-reference table points at each object", async () => {
    const res = await call("/api/reports/payments-register?from=2026-11-01&to=2026-11-30&format=pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const text = await res.text();
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const entries = text.slice(startxref).split("\n").filter((l) => / n $/.test(l));
    expect(entries.length).toBeGreaterThan(4);
    entries.forEach((line, i) => {
      const offset = Number(line.slice(0, 10));
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    expect(text).toContain("/Helvetica-Bold");
    expect(text).toContain("Payments register");
  });

  it("money in the PDF uses Indian grouping and no rupee sign (Helvetica has none)", async () => {
    const text = await (await call("/api/reports/sales-register?fy=2026-27&format=pdf")).text();
    expect(text).toContain("(2,884.00)");
    expect(text).not.toContain("₹");
  });
});

describe("long reports (spec 031 R-PDF)", () => {
  it("a table longer than one page runs on several pages, each with its number, and the header is repeated", () => {
    const rows: Cell[][] = Array.from({ length: 150 }, (_, i) => [`INV-${String(i + 1).padStart(4, "0")}`, { paise: 100_000 + i }]);
    const table: ReportTable = {
      sheetName: "Long",
      title: "Long report",
      subtitle: "Test",
      columns: [
        { label: "Invoice no", align: "left", width: 20 },
        { label: "Amount (Rs)", align: "right", width: 20 },
      ],
      rows,
      totals: ["Total", { paise: 1 }],
      notes: [],
      fileName: "long",
    };
    const text = new TextDecoder("latin1").decode(buildPdf(table, "2 Nov 2026"));
    const pages = (text.match(/\/Type \/Page \//g) ?? []).length;
    expect(pages).toBeGreaterThan(2);
    expect(text).toContain(`/Count ${pages}`);
    expect(text).toContain(`Page 1 of ${pages}`);
    expect(text).toContain(`Page ${pages} of ${pages}`);
    expect(text.split("(Invoice no)").length - 1).toBe(pages);
  });
});

describe("the request (spec 031 R-routes)", () => {
  it("unknown report 404, bad format or period 400", async () => {
    expect((await call("/api/reports/cash-book?from=2026-04-01&to=2026-04-30")).status).toBe(404);
    expect((await call("/api/reports/sales-register?from=2026-04-01&to=2026-04-30&format=csv")).status).toBe(400);
    expect((await call("/api/reports/sales-register?from=2026-05-01&to=2026-04-30")).status).toBe(400);
    expect((await call("/api/reports/sales-register?fy=2026-28")).status).toBe(400);
    expect((await call("/api/reports/sales-register")).status).toBe(400);
  });

  it("the financial year gives 1 April to 31 March", async () => {
    const r = await buildReport(t.db, "sales-register", { fy: "2026-27", format: "xlsx" }, "2026-11-02");
    expect(r.subtitle).toBe("1 Apr 2026 to 31 Mar 2027 (FY 2026-27)");
    expect(r.fileName).toBe("sales-register_FY2026-27");
  });

  it("owner and manager may download; staff and a role without reports.view may not", async () => {
    expect((await call("/api/reports/gst-summary?fy=2026-27", { as: "owner" })).status).toBe(200);
    expect((await call("/api/reports/gst-summary?fy=2026-27", { as: "manager1" })).status).toBe(200);
    expect((await call("/api/reports/gst-summary?fy=2026-27", { as: "staff1" })).status).toBe(403);
    expect((await call("/api/reports/gst-summary?fy=2026-27", { as: "nosale1" })).status).toBe(403);
  });

  it("with no login the request is refused", async () => {
    const res = await app.request("/api/reports/gst-summary?fy=2026-27", {}, { DB: t.db });
    expect(res.status).toBe(401);
  });
});

describe("number formatting (Indian grouping)", () => {
  it("paise to text in lakhs and crores", () => {
    expect(paiseToIndian(0)).toBe("0.00");
    expect(paiseToIndian(288_400)).toBe("2,884.00");
    expect(paiseToIndian(12_345_678)).toBe("1,23,456.78");
    expect(paiseToIndian(1_000_000_000)).toBe("1,00,00,000.00");
    expect(paiseToIndian(-6)).toBe("-0.06");
  });
});
