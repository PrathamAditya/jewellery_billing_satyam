// Spec 030 browser test: the dashboard on the Home screen, its numbers against the API, and the phone width.
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

// Indian grouping and the rupee sign, as formatMoney shows them.
const inr = (paise) => {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const whole = String(Math.floor(abs / 100));
  let head = whole, tail = "";
  if (whole.length > 3) { tail = "," + whole.slice(-3); head = whole.slice(0, -3); }
  const groups = [];
  while (head.length > 2) { groups.unshift(head.slice(-2)); head = head.slice(0, -2); }
  if (head) groups.unshift(head);
  return `${sign}₹${groups.join(",")}${tail}.${String(abs % 100).padStart(2, "0")}`;
};

await page.goto(B);
await page.fill('input[autocomplete="username"]', "owner");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Log in")');
await page.waitForSelector("text=Today's rates");
await page.waitForSelector("h2:has-text('Dashboard')");

const read = () => page.evaluate(() => fetch("/api/dashboard", { credentials: "same-origin" }).then((r) => r.json()));
const before = await read();
ok(before.sales !== null && before.money !== null, "owner sees the sales and the money sections");

// Known activity today: a bill of 9.800 g silver, and an advance of Rs 1,000.00 by UPI.
const uniq = Date.now().toString().slice(-6);
const made = await page.evaluate(async (uniq) => {
  const h = { "Content-Type": "application/json" };
  const c = await (await fetch("/api/customers", { method: "POST", headers: h, body: JSON.stringify({ name: `Dash Test ${uniq}` }) })).json();
  const inv = await (await fetch("/api/invoices", { method: "POST", headers: h, body: JSON.stringify({ invoiceDate: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), customerId: c.customer.id, customerName: `Dash Test ${uniq}`, taxMode: "intra", lines: [{ description: "Chain", purity: "silver", hsn: "7113", grossWeightMg: 9800, netWeightMg: 9800, polishMg: 0, goldRatePaisePerKg: 28_572_000, labourRatePaisePerKg: 0, gstRateBps: 300 }] }) })).json();
  const pay = await (await fetch("/api/payments", { method: "POST", headers: h, body: JSON.stringify({ date: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), mode: "upi", reference: "DASH-" + uniq, customerId: c.customer.id, purpose: "advance", amountPaise: 100_000 }) })).json();
  return { payable: inv.payablePaise, advanceNo: pay.payment?.receiptNo ?? null };
}, uniq);
ok(made.payable > 0, `a bill of ${inr(made.payable)} and an advance of ₹1,000.00 were saved for today`);

// The page was loaded before the new activity: reload so the dashboard reads it again.
await page.reload();
await page.waitForSelector("h2:has-text('Dashboard')");
const after = await read();
ok(after.sales.todayPaise - before.sales.todayPaise === made.payable, `today's sales rose by the bill's payable (${inr(made.payable)})`);
ok(after.money.receivedTodayPaise - before.money.receivedTodayPaise === 100_000, "payments received today rose by ₹1,000.00");
ok(after.money.advancesHeldPaise - before.money.advancesHeldPaise === 100_000, "advances held rose by ₹1,000.00");
ok(after.money.advancesTakenTodayPaise - before.money.advancesTakenTodayPaise === 100_000, "advances taken today rose by ₹1,000.00");
ok(after.money.outstandingPaise - before.money.outstandingPaise === made.payable, "outstanding rose by the unpaid bill (the advance is not used)");
ok(after.monthly.length === 2 && after.monthly[0].months.length === 12, "the monthly summary has 12 months for two financial years");

for (const label of ["Today's sales", "Payments received today", "Outstanding", "Advances held", "Advances taken today", "Cheques not yet cleared", "Sales waiting for the rate"]) {
  ok(await page.locator(`div:text-is("${label}") >> visible=true`).count() === 1, `tile "${label}" is shown once`);
}
ok(await page.locator(`text=${inr(after.sales.todayPaise)} >> visible=true`).count() >= 1, `today's sales tile shows ${inr(after.sales.todayPaise)}`);
ok(await page.locator(`text=${inr(after.money.outstandingPaise)} >> visible=true`).count() >= 1, `outstanding tile shows ${inr(after.money.outstandingPaise)}`);
ok(await page.locator(`text=${inr(after.money.advancesHeldPaise)} >> visible=true`).count() >= 1, `advances held tile shows ${inr(after.money.advancesHeldPaise)}`);
ok(await page.locator('h3:has-text("Monthly, financial year")').count() === 2, "two monthly tables, current and previous financial year");
await page.screenshot({ path: `${S}/shot-dashboard.png`, fullPage: true });

// Phone width: no sideways scroll on the Home screen.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(overflow <= 0, `no sideways scroll at 390 px (overflow ${overflow})`);
await page.screenshot({ path: `${S}/shot-dashboard-phone.png`, fullPage: true });

ok(errors.length === 0, "no page errors in the dashboard run" + (errors.length ? `: ${errors.join(" | ")}` : ""));
await browser.close();
