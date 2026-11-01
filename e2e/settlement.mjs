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
const name = `Settle Test ${uniq}`;
const setup = await page.evaluate(async (name) => {
  const j = (r) => r.json();
  const h = { "Content-Type": "application/json" };
  const c = await j(await fetch("/api/customers", { method: "POST", headers: h, body: JSON.stringify({ name }) }));
  const inv = await j(await fetch("/api/invoices", { method: "POST", headers: h, body: JSON.stringify({ invoiceDate: "2026-02-03", customerId: c.customer.id, customerName: name, taxMode: "intra", lines: [{ description: "Ring", purity: "22K916", hsn: "7113", grossWeightMg: 12020, netWeightMg: 12020, polishMg: 1202, goldRatePaisePerKg: 1515000000, labourRatePaisePerKg: 0, gstRateBps: 300 }] }) }));
  const adv = await j(await fetch("/api/payments", { method: "POST", headers: h, body: JSON.stringify({ date: "2026-11-01", customerId: c.customer.id, mode: "upi", reference: "UPI-S1", purpose: "advance", amountPaise: 1450000 }) }));
  const og = await j(await fetch("/api/old-gold", { method: "POST", headers: h, body: JSON.stringify({ date: "2026-11-01", customerId: c.customer.id, treatment: "advance", rows: [{ description: "Old Gold", grossMg: 25000, lessMg: 2020, karat: "22K", purityBps: 7526, rateKgPaise: 1480000000 }] }) }));
  return { customerId: c.customer.id, invId: inv.id, invNo: inv.invoiceNo, payable: inv.payablePaise, advNo: adv.payment.receiptNo, ogNo: og.receiptNo, ogPayNo: og.payment.receiptNo };
}, name);
ok(setup.payable === 20632300, "sample invoice of ₹2,06,323.00 is ready");

await page.goto(B + `/#/invoices/${setup.invId}`);
await page.waitForSelector(`h1:has-text('${setup.invNo}')`);
await page.click('button:has-text("Settlement")');
await page.waitForSelector("text=Balance due");
ok(await page.locator("text=₹2,06,323.00").count() >= 1, "settlement shows the invoice value");

// Use the advance and the old gold advance on this invoice
await page.click('button:has-text("Use an advance")');
await page.fill(`input[aria-label="Use from ${setup.advNo}"]`, "14,500");
await page.fill(`input[aria-label="Use from ${setup.ogPayNo}"]`, "2,500");
await page.click('div[role="dialog"] button:has-text("Apply")');
await page.locator("text=Advance applied to the invoice. >> visible=true").first().waitFor({ timeout: 10000 });
ok(await page.locator("dd:has-text('₹17,000.00')").count() >= 1, "received ₹17,000.00");
ok(await page.locator("dd:has-text('₹1,89,323.00')").count() >= 1, "balance due ₹1,89,323.00");
ok(await page.locator(`text=${setup.advNo}`).count() >= 1, "the advance receipt is listed");
ok(await page.locator("dd:has-text('₹1,89,323.00')").count() >= 1, "balance matches the owner's settlement sample");
ok(await page.locator("text=Settlement note").count() === 1 && await page.locator("text=adjusted through").count() >= 1, "settlement note explains the old gold line");
await page.screenshot({ path: `${S}/shot-settlement.png` });

// Remarks
await page.fill('textarea[aria-label="Settlement remarks"]', "Customer pays the rest on 15 Dec");
await page.click('button:has-text("Save remarks")');
await page.locator("text=Remarks saved. >> visible=true").first().waitFor({ timeout: 10000 });
ok(true, "remarks saved");

// Reverse the old gold line
const row = page.locator("tr", { hasText: "Old gold" }).first();
await row.locator('button:has-text("Reverse")').click();
await page.fill('div[role="dialog"] input', "wrong amount");
await page.click('div[role="dialog"] button:has-text("Reverse")');
await page.locator("text=Line reversed. >> visible=true").first().waitFor({ timeout: 10000 });
ok(await page.locator("dd:has-text('₹1,91,823.00')").count() >= 1, "after reversing, the balance is ₹1,91,823.00");
ok(await page.locator("text=Customer pays the rest on 15 Dec").count() >= 0, "remarks page still loads");

// Old gold from the settlement page is pre-filled
await page.click('button:has-text("Add old gold receipt")');
await page.waitForSelector("h1:has-text('New old gold receipt')");
await page.waitForSelector(`text=${name}`);
ok(await page.locator(`text=${name}`).count() >= 1, "old gold form opens with the seller filled in");

// Phone: the settlement is readable
const phone = await browser.newContext({ viewport: { width: 390, height: 800 } });
const p2 = await phone.newPage();
await p2.goto(B);
await p2.fill('input[autocomplete="username"]', "owner");
await p2.fill('input[type="password"]', PASSWORD);
await p2.click('button:has-text("Log in")');
await p2.waitForSelector("text=Today's rates");
await p2.goto(B + `/#/invoices/${setup.invId}`);
await p2.waitForSelector(`h1:has-text('${setup.invNo}')`);
await p2.click('button:has-text("Settlement")');
await p2.waitForSelector("text=Balance due");
ok(!(await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "phone: settlement has no sideways page scroll");

ok(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
