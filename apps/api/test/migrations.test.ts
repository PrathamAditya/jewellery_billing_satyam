import { afterAll, describe, expect, it } from "vitest";
import { applyMigration, migrationFiles, openEmptyDb } from "./helpers";

/**
 * Spec 003 R7, R8: the migrations that change existing rows. Rows are seeded in the shape they had before
 * migration 0011, the rest of the migrations run, and the result is checked. Later migrations (0018) are checked
 * on the same rows.
 */

const FIRST_CHANGED = "0011_settings.sql";

const { db, dispose } = await openEmptyDb();
afterAll(() => dispose());

const seeded = { customer: "c-old-1", invoiceA: "inv-old-a", invoiceB: "inv-old-b", line: "line-old-a" };

async function seedBeforeChange() {
  const files = migrationFiles();
  const cut = files.indexOf(FIRST_CHANGED);
  expect(cut).toBeGreaterThan(0);
  for (const f of files.slice(0, cut)) await applyMigration(db, f);

  const ts = "2025-11-02T10:00:00.000Z";
  // A customer numbered the old way, C-0001.
  await db
    .prepare(
      `INSERT INTO customers (id, created_at, created_by, updated_at, updated_by, customer_no, name, name_search)
       VALUES (?1, ?2, 'test', ?2, 'test', 'C-0001', 'Old Customer', 'old customer')`,
    )
    .bind(seeded.customer, ts)
    .run();

  // Two invoices in different financial years, numbered the old way (the last four digits are the serial).
  const invoice = (id: string, no: string, date: string, payable: number) =>
    db
      .prepare(
        `INSERT INTO invoices (id, created_at, created_by, updated_at, updated_by, invoice_no, invoice_date, customer_name,
           customer_name_search, tax_mode, rates_json, input_json, taxable_paise, tax_paise, total_before_round_off_paise,
           round_off_paise, payable_paise, calc_json)
         VALUES (?1, ?2, 'test', ?2, 'test', ?3, ?4, 'Old Customer', 'old customer', 'intra', '{}', '{}', ?5, 0, ?5, 0, ?5, '{}')`,
      )
      .bind(id, ts, no, date, payable)
      .run();
  await invoice(seeded.invoiceA, "INV-2025-26-0007", "2025-11-01", 288400); // FY 2025-26
  await invoice(seeded.invoiceB, "INV-2026-27-0008", "2026-05-10", 206300); // FY 2026-27

  // The line of invoice A, from before taxable_paise existed.
  await db
    .prepare(
      `INSERT INTO invoice_lines (id, invoice_id, revision_no, line_no, description, purity, hsn, gross_weight_mg, net_weight_mg,
         polish_mg, gold_rate_paise_per_kg, labour_rate_paise_per_kg, gst_rate_bps, chargeable_weight_mg, gold_amount_paise,
         labour_amount_paise, amount_paise, display_rate_paise_per_gram)
       VALUES (?1, ?2, 1, 1, 'Silver', 'silver', '7113', 9800, 9800, 0, 28572000, 0, 300, 9800, 280006, 0, 280006, 28572)`,
    )
    .bind(seeded.line, seeded.invoiceA)
    .run();

  for (const f of files.slice(cut)) await applyMigration(db, f);
}

await seedBeforeChange();

describe("spec 003 R8: existing rows after migration 0011 and later", () => {
  it("invoice numbers become INV-0007 and INV-0008, with the financial year and serial stored", async () => {
    const a = await db.prepare("SELECT invoice_no, fy, serial FROM invoices WHERE id = ?1").bind(seeded.invoiceA).first<{ invoice_no: string; fy: string; serial: number }>();
    const b = await db.prepare("SELECT invoice_no, fy, serial FROM invoices WHERE id = ?1").bind(seeded.invoiceB).first<{ invoice_no: string; fy: string; serial: number }>();
    expect(a).toEqual({ invoice_no: "INV-0007", fy: "2025-26", serial: 7 });
    expect(b).toEqual({ invoice_no: "INV-0008", fy: "2026-27", serial: 8 });
  });

  it("customer numbers lose the hyphen: C-0001 becomes C0001", async () => {
    const row = await db.prepare("SELECT customer_no FROM customers WHERE id = ?1").bind(seeded.customer).first<{ customer_no: string }>();
    expect(row?.customer_no).toBe("C0001");
  });

  it("the old unique index on invoice number alone is gone", async () => {
    const row = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'invoices_invoice_no_unique'").first();
    expect(row).toBeNull();
  });

  it("the same printed number may repeat in another financial year, but not twice in one year", async () => {
    // INV-0007 exists in 2025-26 only, so 2026-27 can use it, and 2025-26 can use INV-0008.
    const insert = (id: string, fy: string, no: string) =>
      db
        .prepare(
          `INSERT INTO invoices (id, created_at, created_by, updated_at, updated_by, invoice_no, fy, serial, invoice_date, customer_name,
             customer_name_search, tax_mode, rates_json, input_json, taxable_paise, tax_paise, total_before_round_off_paise,
             round_off_paise, payable_paise, calc_json)
           VALUES (?1, 'x', 'test', 'x', 'test', ?2, ?3, 1, '2026-06-01', 'N', 'n', 'intra', '{}', '{}', 100, 0, 100, 0, 100, '{}')`,
        )
        .bind(id, no, fy)
        .run();
    await insert("inv-new-1", "2026-27", "INV-0007");
    await insert("inv-new-2", "2025-26", "INV-0008");
    await expect(insert("inv-new-3", "2026-27", "INV-0008")).rejects.toThrow(/UNIQUE/);
  });

  it("the old line gets taxable = amount, plain weight pricing, and no discount (migration 0018)", async () => {
    const line = await db
      .prepare("SELECT taxable_paise, amount_paise, pricing_mode, stone_amount_paise, discount_paise FROM invoice_lines WHERE id = ?1")
      .bind(seeded.line)
      .first<Record<string, number | string>>();
    expect(line).toEqual({ taxable_paise: 280006, amount_paise: 280006, pricing_mode: "weight", stone_amount_paise: 0, discount_paise: 0 });
    const inv = await db.prepare("SELECT discount_json, discount_paise FROM invoices WHERE id = ?1").bind(seeded.invoiceA).first();
    expect(inv).toEqual({ discount_json: "{}", discount_paise: 0 });
  });
});
