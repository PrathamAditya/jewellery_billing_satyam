// Showroom feedback round 3:
// - Direct payment on invoice (stays on invoice, no jump to payment tab) + Save & receive another
// - Only 2 payment timing options on invoice (At time of delivery right after generate, Later payment when opened later)
// - Direct Old Gold adjustment right on invoice / settlement
// - Spacious invoice entry + automatic initial gold rate + saved item autocomplete (R -> Ring)
// - Settlement 3 sections (Advance, Old Gold, Payment) in app and in printed back page
// - Balance Due shown on Payment & Old Gold A5 landscape receipts
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const S = process.argv[2] ?? "e2e/screenshots";
const B = process.env.BASE_URL ?? "http://localhost:8799";
const PASSWORD = process.env.OWNER_PASSWORD ?? "throwaway-local-pass-1";
mkdirSync(S, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && !/40[0-9]|409/.test(m.text()) && errors.push("console: " + m.text()));
const ok = (cond, msg) => {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) process.exitCode = 1;
};
const uniq = Date.now().toString().slice(-6);
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const flat = (t) => t.replace(/\s+/g, " ");
const pagesOf = (file) => Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file]).toString())[1]);
const isA5Landscape = (file) => {
  const [, w, h] = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(execFileSync("pdfinfo", [file]).toString());
  return Math.abs(Number(w) - 595) < 2 && Math.abs(Number(h) - 420) < 2;
};
const textOf = (file) => execFileSync("pdftotext", [file, "-"]).toString().replace(/\s+/g, " ");

const api = (method, path, body) =>
  page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    },
    { method, path, body },
  );

await page.goto(B);
await page.fill('input[autocomplete="username"]', "owner");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Log in")');
await page.waitForSelector("text=Today's rates");

const cname = `Round3 ${uniq}`;
const custRes = await api("POST", "/api/customers", { name: cname, mobile: "9800000003" });
ok(custRes.status === 201, "customer created");
const customerId = custRes.body.customer.id;

// Seed an advance so we can test all 3 settlement sections (Advance, Old Gold, Payment)
const advRes = await api("POST", "/api/payments", { date: today, customerId, mode: "upi", reference: `ADV-${uniq}`, amountPaise: 500_000, purpose: "advance" });
ok(advRes.status === 201, "customer advance created");

// Seed an in-stock Ring item for autocomplete
const stockRes = await api("POST", "/api/inventory/items", { typeId: "type-ring", pieces: 1, metal: "gold", purity: "22K916", grossWeightMg: 5200, netWeightMg: 5000, hsn: "7113" });
ok(stockRes.status === 201, "in-stock Ring item created");
const uNo = stockRes.body.item.uNo;

// ---- 1. Spacious invoice entry + auto rate + item autocomplete ----
await page.goto(`${B}/#/invoices/new`);
await page.waitForSelector("h1:has-text('New invoice')");
await page.fill('input[aria-label="Find customer"]', cname);
await page.locator(`[role="option"]:has-text("${cname}")`).first().click();

// Automatic 22K rate filled without switching purity
const autoGold = await page.locator('input[aria-label="Gold rate line 1"]').inputValue();
ok(autoGold.trim() !== "", `initial 22K gold rate auto-filled (${autoGold})`);

// No sideways scroll on desktop form
ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "spacious invoice entry has no sideways scroll on desktop");

// Type "R" -> autocomplete shows Ring; typing the U No. finds the exact in-stock item even when many rings exist
const desc1 = page.locator('[aria-label="Description line 1"]');
await desc1.click();
await desc1.fill("R");
await page.waitForSelector('[aria-label="Item suggestions line 1"]');
const sugText = flat(await page.locator('[aria-label="Item suggestions line 1"]').innerText());
ok(sugText.includes("Ring"), "typing R shows saved item 'Ring'");
await desc1.fill(uNo);
await page.waitForSelector(`[aria-label="Item suggestions line 1"] [role="option"]:has-text("${uNo}")`);
await page.locator(`[aria-label="Item suggestions line 1"] [role="option"]:has-text("${uNo}")`).click();
ok((await desc1.inputValue()) === "Ring", "picking item fills Description 'Ring'");
ok((await page.locator('input[aria-label="Net g line 1"]').inputValue()) === "5.000", "picking in-stock Ring fills Net g 5.000");

await page.screenshot({ path: `${S}/shot-round3-invoice-form.png` });
await page.click('button:has-text("Save invoice")');
await page.waitForSelector("h1:has-text('INV-')");
const invUrl = page.url();
const invId = invUrl.split("/").pop();
const invNo = (await page.locator("h1").first().innerText()).trim();
ok(/^INV-\d{4}$/.test(invNo), `saved invoice ${invNo}`);

// ---- 2. Right after generating: defaults to "At time of delivery", only 2 options, repeat payment, stays on invoice ----
await page.click('button:has-text("Receive payment")');
await page.waitForSelector('[role="dialog"]');
const dlgText = flat(await page.locator('[role="dialog"]').innerText());
ok(dlgText.includes("At time of delivery") && dlgText.includes("Later payment") && !dlgText.includes("old booklet"), "receive dialog on invoice shows only 2 timing options");
const atDeliveryChecked = await page.locator('label:has-text("At time of delivery") input').isChecked();
ok(atDeliveryChecked, "newly generated invoice defaults to 'At time of delivery'");

await page.fill('input[placeholder="e.g. 14,500"]', "1,000");
await page.click('button:has-text("Save & receive another")');
await page.waitForSelector('text=Saved At time of delivery');
ok(await page.locator('input[placeholder="e.g. 14,500"]').inputValue() === "", "Save & receive another clears amount for next payment");

await page.locator('label:has-text("Later payment") input').check();
await page.fill('input[placeholder="e.g. 14,500"]', "2,000");
await page.click('div[role="dialog"] button:has-text("Save payment")');
await page.waitForSelector('[role="dialog"]', { state: "detached" });
ok(page.url().includes(`#/invoices/${invId}`), "saving payment stays on the invoice page (does not jump to payment tab)");
await page.waitForSelector("text=added to");
const payHref = await page.locator('a:has-text("Print receipt")').getAttribute("href");

// Reopening the invoice later defaults to "Later payment"
await page.goto(`${B}/#/invoices`);
await page.waitForSelector(`a:has-text("${invNo}")`);
await page.click(`a:has-text("${invNo}")`);
await page.waitForSelector(`h1:has-text("${invNo}")`);
await page.click('button:has-text("Receive payment")');
await page.waitForSelector('[role="dialog"]');
ok(await page.locator('label:has-text("Later payment") input').isChecked(), "reopening an invoice later defaults to 'Later payment'");
await page.click('div[role="dialog"] button:has-text("Cancel")');

// ---- 3. Direct inline Old Gold adjustment on invoice ----
await page.click('button:has-text("Adjust old gold")');
await page.waitForSelector('[role="dialog"]');
await page.fill('input[aria-label="Old gold gross 1"]', "1.000");
await page.fill('input[aria-label="Old gold rate 1"]', "5,000");
await page.waitForSelector("text=Old gold value (rounded)");
await page.click('div[role="dialog"] button:has-text("Adjust old gold")');
await page.waitForSelector('[role="dialog"]', { state: "detached" });
ok(page.url().includes(`#/invoices/${invId}`), "adjusting old gold inline stays on the invoice page");
await page.waitForSelector("text=adjusted against");
const ogpPrintHref = await page.locator('a:has-text("Print receipt")').getAttribute("href");

// ---- 4. Settlement tab & printed back page have 3 sections (Advance, Old Gold, Payment) ----
await page.click('button:has-text("Settlement")');
await page.waitForSelector("text=Received against this invoice");
await page.click('button:has-text("Use an advance")');
await page.click('div[role="dialog"] button:has-text("Apply")');
await page.waitForSelector("text=Advance applied to the invoice.");
const settleText = flat(await page.locator("body").innerText());
ok(settleText.includes("Advance") && settleText.includes("Old Gold") && settleText.includes("Payment") && settleText.includes(advRes.body.payment.receiptNo), "in-app settlement shows Advance, Old Gold, and Payment sections");
await page.screenshot({ path: `${S}/shot-round3-settlement.png` });

// ---- 5. Balance Due on A5 Payment Receipt & Old Gold Receipt + 3-section Settlement print ----
if (payHref) {
  await page.goto(`${B}/${payHref}`);
  await page.waitForFunction(() => document.querySelector(".print-stage")?.innerText.includes("Payment Receipt"));
  await page.waitForLoadState("networkidle");
  const payPdf = `${S}/round3-payment-a5.pdf`;
  await page.pdf({ path: payPdf, preferCSSPageSize: true, printBackground: true });
  const pt = textOf(payPdf);
  ok(isA5Landscape(payPdf) && pagesOf(payPdf) === 1, "payment receipt prints as A5 landscape");
  ok(/balance due/i.test(pt) && pt.includes(invNo), "payment receipt prints Balance due against the invoice");
}

if (ogpPrintHref) {
  await page.goto(`${B}/${ogpPrintHref}`);
  await page.waitForFunction(() => document.querySelector(".print-stage")?.innerText.includes("Old Gold Purchase"));
  await page.waitForLoadState("networkidle");
  const ogPdf = `${S}/round3-oldgold-a5.pdf`;
  await page.pdf({ path: ogPdf, preferCSSPageSize: true, printBackground: true });
  const ot = textOf(ogPdf);
  ok(isA5Landscape(ogPdf) && pagesOf(ogPdf) === 1, "old gold receipt prints as A5 landscape");
  ok(/balance due/i.test(ot) && ot.includes(invNo), "old gold receipt prints Balance due and invoice no.");
}

await page.goto(`${B}/#/print/invoice/${invId}`);
await page.waitForFunction(() => document.querySelector(".print-stage")?.innerText.includes("Settlement and Payment Record"));
await page.selectOption("select", "first");
await page.waitForLoadState("networkidle");
const invPdf = `${S}/round3-invoice-3sections.pdf`;
await page.pdf({ path: invPdf, preferCSSPageSize: true, printBackground: true });
const it = textOf(invPdf);
ok(it.includes("Total advance") && it.includes("Total old gold") && it.includes("Total payment"), "printed settlement page has Advance, Old Gold, and Payment sections");

ok(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
