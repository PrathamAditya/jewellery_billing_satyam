import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const S = process.argv[2] ?? "e2e/screenshots";
const B = process.env.BASE_URL ?? "http://localhost:8799";
const PASSWORD = process.env.OWNER_PASSWORD ?? "throwaway-local-pass-1";
mkdirSync(S, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && !/40[0-9]/.test(m.text()) && errors.push("console: " + m.text()));
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };

await page.goto(B);
await page.fill('input[autocomplete="username"]', "owner");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Log in")');
await page.waitForSelector("text=Today's rates");

const uniq = Date.now().toString().slice(-6);
const name = `Ledger Test ${uniq}`;
const cid = await page.evaluate(async (name) => {
  const h = { "Content-Type": "application/json" };
  const c = await (await fetch("/api/customers", { method: "POST", headers: h, body: JSON.stringify({ name }) })).json();
  await fetch("/api/invoices", { method: "POST", headers: h, body: JSON.stringify({ invoiceDate: "2026-02-03", customerId: c.customer.id, customerName: name, taxMode: "intra", lines: [{ description: "Ring", purity: "22K916", hsn: "7113", grossWeightMg: 12020, netWeightMg: 12020, polishMg: 1202, goldRatePaisePerKg: 1515000000, labourRatePaisePerKg: 0, gstRateBps: 300 }] }) });
  await fetch("/api/opening-balances", { method: "POST", headers: h, body: JSON.stringify({ customerId: c.customer.id, amountPaise: 2500000, asOfDate: "2025-03-31", reference: "OLD-" + name.slice(-4) }) });
  return c.customer.id;
}, name);

// Ledger tab on the customer page
await page.goto(B + `/#/customers/${cid}`);
await page.waitForSelector(`h1:has-text('${name}')`);
await page.click('button:has-text("Ledger")');
await page.waitForSelector("text=Owes");
ok(await page.locator("dd:has-text('₹2,31,323.00')").count() >= 1, "ledger shows ₹2,31,323.00 owed (invoice ₹2,06,323.00 plus opening ₹25,000.00)");
ok(await page.locator('td:text-is("Opening balance")').count() === 1, "opening balance is listed as its own line");
ok(await page.locator('td:text-is("Invoice")').count() >= 1, "the invoice is listed");
await page.screenshot({ path: `${S}/shot-ledger.png` });

// Add an old advance from the booklet
await page.click('button:has-text("Add opening balance")');
await page.locator('label:has-text("We are holding an advance") input').check();
await page.fill('div[role="dialog"] input[inputmode="decimal"]', "10,000");
await page.fill('div[role="dialog"] label:has-text("Old reference") input', "BOOK-" + uniq);
await page.click('div[role="dialog"] button:has-text("Save")');
await page.locator("text=Opening balance added. >> visible=true").first().waitFor({ timeout: 10000 });
ok(await page.locator("dd:has-text('₹10,000.00')").count() >= 1, "old advance shows as advance held ₹10,000.00");
ok(await page.locator('td:text-is("Received")').count() === 1, "the old advance is shown as a received line in the ledger");

// Outstanding page lists the customer
await page.goto(B + "/#/outstanding");
await page.waitForSelector("h1:has-text('Outstanding')");
await page.fill('input[aria-label="Search outstanding"]', name);
await page.locator(`td:has-text("${name}")`).first().waitFor({ timeout: 10000 });
ok(await page.locator(`td:has-text("${name}")`).count() === 1, "outstanding list shows the customer");
await page.screenshot({ path: `${S}/shot-outstanding.png` });

// Phone: outstanding readable with no sideways scroll
const phone = await browser.newContext({ viewport: { width: 390, height: 800 } });
const p2 = await phone.newPage();
await p2.goto(B);
await p2.fill('input[autocomplete="username"]', "owner");
await p2.fill('input[type="password"]', PASSWORD);
await p2.click('button:has-text("Log in")');
await p2.waitForSelector("text=Today's rates");
await p2.goto(B + "/#/outstanding");
await p2.waitForSelector("h1:has-text('Outstanding')");
ok(!(await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "phone: outstanding page has no sideways page scroll");

ok(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
