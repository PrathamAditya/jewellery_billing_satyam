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

// Set up a customer and two invoices through the app's own API (same session)
const uniq = Date.now().toString().slice(-6);
const name = `Pay Test ${uniq}`;
const setup = await page.evaluate(async (name) => {
  const j = (r) => r.json();
  const c = await j(await fetch("/api/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }));
  const bill = (date) => ({ invoiceDate: date, customerId: c.customer.id, customerName: name, taxMode: "intra", lines: [{ description: "Silver", purity: "silver", hsn: "7113", grossWeightMg: 9800, netWeightMg: 9800, polishMg: 0, goldRatePaisePerKg: 28572000, labourRatePaisePerKg: 0, gstRateBps: 300 }] });
  const a = await j(await fetch("/api/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bill("2026-02-01")) }));
  const b = await j(await fetch("/api/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bill("2026-02-05")) }));
  return { customerId: c.customer.id, a: { id: a.id, no: a.invoiceNo, payable: a.payablePaise }, b: { id: b.id, no: b.invoiceNo, payable: b.payablePaise } };
}, name);
ok(setup.a.payable === 288400 && setup.b.payable === 288400, "two invoices of ₹2,884.00 are ready for the customer");

// Receive a payment of ₹6,000 against both invoices; ₹232.00 is left over
await page.goto(B + "/#/payments");
await page.waitForSelector("h1:has-text('Payments')");
await page.click('button:has-text("Receive payment")');
await page.fill('input[aria-label="Find customer"]', name);
await page.locator(`[role="option"]:has-text("${name}")`).first().click();
await page.fill('input[placeholder="e.g. 14,500"]', "6,000");
await page.locator('label:has-text("Pay outstanding invoices") input').check();
await page.locator(`li:has-text("${setup.a.no}")`).first().waitFor();
const preview = await page.locator("text=Kept as advance: ₹232.00").count();
ok(preview === 1, "the preview shows ₹232.00 kept as advance (oldest invoice first)");
await page.screenshot({ path: `${S}/shot-receive-preview.png` });
await page.click('button:has-text("Save payment")');
await page.waitForSelector("text=Applied to");
const receipt = (await page.locator("h1").first().innerText()).trim();
ok(/^PAY-\d{4}/.test(receipt), "saved as a receipt " + receipt);
ok(await page.locator(`td:has-text("${setup.a.no}")`).count() >= 1 && await page.locator(`td:has-text("${setup.b.no}")`).count() >= 1, "applied to both invoices");
ok(await page.locator("dd:has-text('₹232.00')").count() >= 1, "left as advance ₹232.00");

// The invoice shows it is paid in full
await page.goto(B + `/#/invoices/${setup.a.id}`);
await page.waitForSelector("text=Paid in full");
ok(true, "the first invoice shows Paid in full");

// Reverse the allocation to the second invoice
await page.goto(B + "/#/payments");
await page.fill('input[aria-label="Search payments"]', name);
await page.locator(`a:has-text("${receipt.split(" ")[0]}")`).first().click();
await page.waitForSelector("text=Applied to");
const row = page.locator(`tr:has-text("${setup.b.no}")`);
await row.locator('button:has-text("Reverse")').click();
await page.fill('div[role="dialog"] input', "typed to the wrong bill");
await page.click('div[role="dialog"] button:has-text("Reverse")');
await page.waitForSelector("text=Allocation reversed");
ok(await page.locator("dd:has-text('₹3,116.00')").count() >= 1, "after reversing, ₹3,116.00 is left as advance");
ok(await page.locator(`tr:has-text("${setup.b.no}") >> text=reversed`).count() === 1, "the reversed allocation is marked reversed");
await page.screenshot({ path: `${S}/shot-payment-page.png` });

// Void the payment
await page.click('button:has-text("Void payment")');
await page.fill('div[role="dialog"] input', "entered twice");
await page.click('div[role="dialog"] button:has-text("Void payment")');
await page.waitForSelector("text=Payment voided");
await page.goto(B + `/#/invoices/${setup.a.id}`);
await page.waitForSelector("text=Balance due");
ok(await page.locator("text=Not paid").count() >= 1, "after the void the first invoice is unpaid again");

// Cash over the limit: warning, must be confirmed first
await page.goto(B + "/#/payments");
await page.click('button:has-text("Receive payment")');
await page.fill('input[aria-label="Find customer"]', name);
await page.locator(`[role="option"]:has-text("${name}")`).first().click();
await page.selectOption('label:has-text("Mode") select', "cash");
await page.fill('input[placeholder="e.g. 14,500"]', "200000");
await page.click('button:has-text("Save payment")');
await page.waitForSelector("text=Please confirm the cash amount first");
ok(true, "cash over the limit asks for confirmation first");
await page.locator('label:has-text("I have checked this cash amount") input').check();
await page.click('button:has-text("Save payment")');
await page.locator("h1").first().waitFor();
await page.waitForFunction(() => /PAY-|Payment at sale/.test(document.querySelector("h1")?.innerText ?? ""), null, { timeout: 10000 });
ok(true, "after confirming, the cash payment is saved");

// Phone: read-only
const phone = await browser.newContext({ viewport: { width: 390, height: 800 } });
const p2 = await phone.newPage();
await p2.goto(B);
await p2.fill('input[autocomplete="username"]', "owner");
await p2.fill('input[type="password"]', PASSWORD);
await p2.click('button:has-text("Log in")');
await p2.waitForSelector("text=Today's rates");
await p2.goto(B + "/#/payments");
await p2.waitForSelector("h1:has-text('Payments')");
ok(await p2.locator('button:has-text("Receive payment")').isVisible() === false, "phone: Receive payment hidden");
ok(!(await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "phone: payments list has no sideways page scroll");

ok(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
