// Spec 019c: credit sales with the rate fixed later, through the screens. Create the sale, take money before the
// rate is fixed, fix the rate, see the pending list, and check the phone view and the printed sheet.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const S = process.argv[2] ?? "e2e/screenshots";
const B = process.env.BASE_URL ?? "http://localhost:8799";
const PASSWORD = process.env.OWNER_PASSWORD ?? "throwaway-local-pass-1";
mkdirSync(S, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && !/40[0-9]/.test(m.text()) && errors.push("console: " + m.text()));
const ok = (cond, msg) => {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) process.exitCode = 1;
};
const uniq = Date.now().toString().slice(-6);
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

await page.goto(B);
await page.fill('input[autocomplete="username"]', "owner");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Log in")');
await page.waitForSelector("text=Today's rates");

const api = (method, path, body) =>
  page.evaluate(
    async ({ method, path, body }) => {
      const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    },
    { method, path, body },
  );
const idOf = async (number) => (await api("GET", `/api/invoices?q=${encodeURIComponent(number)}`)).body.items.find((i) => i.invoiceNo === number)?.id;

// ---- 1. a sale with the rate fixed later, from the invoice form ----
const name = `Credit Check ${uniq}`;
const customerId = (await api("POST", "/api/customers", { name })).body.customer.id;
await page.click('a:has-text("Invoices")');
await page.waitForSelector("h1:has-text('Invoices')");
await page.click('button:has-text("New invoice")');
await page.waitForSelector("h1:has-text('New invoice')");
await page.click('button:has-text("Fixed when paid (credit)")');
await page.fill('input[aria-label="Find customer"]', name);
await page.waitForSelector('[role="option"]');
await page.locator('[role="option"]').first().click();
await page.waitForSelector("text=Saved customer:");
await page.fill('input[aria-label="Description line 1"]', "Silver Chain");
await page.selectOption('select[aria-label="Purity line 1"]', "silver");
await page.fill('input[aria-label="Net g line 1"]', "9.800");
ok((await page.locator('input[aria-label="Gold rate line 1"]').count()) === 0, "a sale with the rate fixed later has no gold rate box");
ok((await page.locator("text=Rate pending: the gold rate is not typed now").count()) === 1, "the form says the rate is pending");
await page.screenshot({ path: `${S}/shot-pending-form.png` });
await page.click('button:has-text("Save sale (rate pending)")');
await page.waitForSelector("h1:has-text('INV-')");
const number = (await page.locator("h1").first().innerText()).trim().split(/\s/)[0];
const pendingId = await idOf(number);
ok(number.startsWith("INV-") && !!pendingId, "the sale is saved with a number: " + number);
ok((await page.locator('button:has-text("Edit") >> visible=true').count()) === 0, "a pending sale has no Edit button");
ok((await page.locator('button:has-text("Fix the rate") >> visible=true').count()) === 1, "a pending sale shows Fix the rate");
ok((await page.locator("text=Amount due is shown once the rate is fixed").count()) === 1, "the invoice page shows no amount due while pending");

// ---- 2. money paid before the rate is fixed ----
await page.click('button:has-text("Receive payment on this sale") >> visible=true');
await page.waitForSelector('div[role="dialog"]');
await page.fill('div[role="dialog"] input', "1,000");
await page.click('div[role="dialog"] button:has-text("Save payment")');
await page.waitForSelector("h1:has-text('PAY-')");
ok(/^PAY-\d{4}$/.test((await page.locator("h1").first().innerText()).trim()), "the money is saved as a receipt, held on the sale");

// ---- 3. fix the rate: the sale becomes payable and the money is applied ----
await page.goto(`${B}/#/invoices/${pendingId}`);
await page.waitForSelector(`h1:has-text('${number}')`);
await page.click('button:has-text("Fix the rate") >> visible=true');
await page.waitForSelector('div[role="dialog"]');
await page.fill('div[role="dialog"] input[type="date"]', today);
await page.locator('div[role="dialog"] input[inputmode="decimal"]').first().fill("285.72");
await page.click('button:has-text("Fix the rate and save")');
await page.waitForSelector("text=Part paid");
const bar = await page.locator("body").innerText();
ok(bar.includes("₹2,884.00") && bar.includes("1,884.00"), "after fixing: payable ₹2,884.00 and balance due ₹1,884.00 (₹1,000 applied)");
ok((await page.locator('button:has-text("Edit") >> visible=true').count()) === 1, "a fixed sale can be edited again");
await page.screenshot({ path: `${S}/shot-fixed-invoice.png` });
const led = await api("GET", `/api/customers/${customerId}/ledger`);
ok(led.body.outstandingPaise === 188400 && led.body.advanceHeldPaise === 0, "the ledger owes ₹1,884.00 and holds no advance");

// ---- 4. a second pending sale shows in the Outstanding pending list, and the totals do not move ----
const second = await api("POST", "/api/invoices/pending", {
  invoiceDate: today,
  customerId,
  customerName: name,
  taxMode: "intra",
  lines: [{ description: "Gold Ring", purity: "22K916", hsn: "7113", grossWeightMg: 4000, netWeightMg: 4000, polishBps: 0, labourRatePaisePerKg: 0 }],
});
ok(second.status === 201, "a second pending sale is created through the API for the list check");
await page.goto(`${B}/#/outstanding`);
await page.waitForSelector("h1:has-text('Outstanding')");
await page.waitForSelector("text=Pending rate (not in the totals");
ok((await page.locator(`text=${second.body.invoiceNo}`).count()) >= 1, "the pending list shows the second sale");

// ---- 5. the printed sheet of a pending sale has no amount ----
await page.goto(`${B}/#/print/invoice/${second.body.id}`);
await page.waitForSelector("text=Rate and amount to be fixed when paid");
ok((await page.locator("text=Total invoice value").count()) === 0, "a pending sale prints no total");

// ---- 6. phone: read-only, no sideways scroll ----
const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p2 = await phone.newPage();
p2.on("pageerror", (e) => errors.push("phone pageerror: " + e.message));
await p2.goto(B);
await p2.fill('input[autocomplete="username"]', "owner");
await p2.fill('input[type="password"]', PASSWORD);
await p2.click('button:has-text("Log in")');
await p2.waitForSelector("text=Today's rates");
await p2.goto(`${B}/#/invoices/${second.body.id}`);
await p2.waitForSelector(`h1:has-text('${second.body.invoiceNo}')`);
ok((await p2.locator('button:has-text("Fix the rate") >> visible=true').count()) === 0, "phone: Fix the rate is hidden");
ok((await p2.locator('button:has-text("Receive payment on this sale") >> visible=true').count()) === 0, "phone: receiving money on the sale is hidden");
const sideways = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
ok(!sideways, "phone: the invoice page does not scroll sideways");
await p2.screenshot({ path: `${S}/shot-phone-pending.png` });
await phone.close();

ok(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
