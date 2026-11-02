// Spec 031 browser test: the Reports screen downloads an Excel file (sheet name, size) and a PDF.
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { chromium } from "playwright-core";

const S = process.argv[2] ?? "e2e/screenshots";
const B = process.env.BASE_URL ?? "http://localhost:8799";
const PASSWORD = process.env.OWNER_PASSWORD ?? "throwaway-local-pass-1";
mkdirSync(S, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && !/40[0-9]/.test(m.text()) && errors.push("console: " + m.text()));
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };

// Reads the sheet names and the entry names of a stored zip (an .xlsx) without any library.
function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let k = 0; k < count; k++) {
    const size = buf.readUInt32LE(p + 24), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loc = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    const start = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
    out[name] = buf.subarray(start, start + size).toString("utf8");
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

await page.goto(B);
await page.fill('input[autocomplete="username"]', "owner");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Log in")');
await page.waitForSelector("text=Today's rates");

await page.click('a:has-text("Reports") >> visible=true');
await page.waitForSelector("h1:has-text('Reports')");
ok(await page.locator('label:has-text("Sales register") input').isChecked(), "the sales register is chosen by default");
ok(await page.locator('label:has-text("Financial year") input').isChecked(), "the period is a financial year by default");

// Excel for the current financial year
let [dl] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("Download Excel")')]);
let path = await dl.path();
let buf = readFileSync(path);
let parts = zipEntries(buf);
ok(/^sales-register_FY\d{4}-\d{2}\.xlsx$/.test(dl.suggestedFilename()), `Excel file named ${dl.suggestedFilename()}`);
ok(buf.length > 1000, `Excel file is ${buf.length} bytes`);
ok(/<sheet name="Sales register"/.test(parts["xl/workbook.xml"] ?? ""), "the sheet is named Sales register");
ok(typeof parts["xl/worksheets/sheet1.xml"] === "string" && parts["xl/worksheets/sheet1.xml"].includes("<sheetData>"), "the sheet holds data rows");

// Outstanding, Excel, with a date range
await page.locator('label:has-text("Outstanding by customer") input').check();
ok(await page.locator("text=does not apply >> visible=true").count() === 1, "the outstanding report says the period does not apply");
await page.locator('label:has-text("Date range") input').check();
await page.fill('label:text-is("From") input', "2026-04-01");
await page.fill('label:text-is("To") input', new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10));
[dl] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("Download Excel")')]);
buf = readFileSync(await dl.path());
parts = zipEntries(buf);
ok(/^outstanding_\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()), `outstanding Excel named ${dl.suggestedFilename()}`);
ok(/<sheet name="Outstanding by customer"/.test(parts["xl/workbook.xml"] ?? ""), "the outstanding sheet is named Outstanding by customer");

// PDF for the payments register over a date range
await page.locator('label:has-text("Payments register") input').check();
await page.fill('label:text-is("From") input', "2026-04-01");
[dl] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("Download PDF")')]);
const pdf = readFileSync(await dl.path());
ok(pdf.subarray(0, 8).toString("latin1") === "%PDF-1.4", `PDF file ${dl.suggestedFilename()} starts with %PDF-1.4 (${pdf.length} bytes)`);
ok(pdf.toString("latin1").trimEnd().endsWith("%%EOF"), "the PDF ends with %%EOF");

// A bad period is shown as a message, not a download
await page.locator('label:has-text("Date range") input').check();
await page.fill('label:text-is("From") input', "2027-06-01");
await page.fill('label:text-is("To") input', "2027-05-01");
await page.click('button:has-text("Download Excel")');
await page.locator("text=The end date is before the start date >> visible=true").first().waitFor({ timeout: 10000 });
ok(await page.locator("text=The end date is before the start date >> visible=true").count() === 1, "a date range that ends before it starts is refused on screen");
await page.screenshot({ path: `${S}/shot-reports.png`, fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(overflow <= 0, `no sideways scroll on the Reports screen at 390 px (overflow ${overflow})`);

ok(errors.length === 0, "no page errors on the Reports screen" + (errors.length ? `: ${errors.join(" | ")}` : ""));
await browser.close();
