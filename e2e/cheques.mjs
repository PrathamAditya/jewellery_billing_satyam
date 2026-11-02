// Spec 019b: cheques through the screens. Record, deposit, clear; a second cheque is bounced and the invoice owes again.
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

// One customer and a silver bill of 9.800 g (payable ₹2,884.00).
const cust = await api("POST", "/api/customers", { name: `Cheque Check ${uniq}` });
const customerId = cust.body.customer.id;
const bill = (name) =>
  api("POST", "/api/invoices", {
    invoiceDate: "2026-02-03",
    customerId,
    customerName: name,
    taxMode: "intra",
    lines: [{ description: "Silver", purity: "silver", hsn: "7113", grossWeightMg: 9800, netWeightMg: 9800, polishBps: 0, goldRatePaisePerKg: 28572000, labourRatePaisePerKg: 0 }],
  });
const first = await bill(`Cheque Check ${uniq}`);
ok(first.status === 201 && first.body.payablePaise === 288400, "a bill of ₹2,884.00 is saved for the cheque checks");

// ---- first cheque: record it on the invoice page, then deposit and clear it ----
await page.goto(`${B}/#/invoices/${first.body.id}`);
await page.waitForSelector(`h1:has-text('${first.body.invoiceNo}')`);
await page.click('button:has-text("Receive payment")');
await page.selectOption('select:has(option[value="cheque"])', "cheque");
await page.fill('input[placeholder="e.g. 14,500"]', "2,884");
await page.locator('label:has-text("Pay outstanding invoices") input').check();
await page.fill('label:has-text("Reference") input', `CQ-${uniq}`);
await page.fill('label:has-text("Cheque bank") input', "State Bank");
await page.fill('label:has-text("Name on the cheque") input', "Cheque Check");
await page.click('button:has-text("Save payment")');
await page.waitForSelector("text=Cheque: Received");
ok(true, "the cheque is recorded and shows as Received");
const cheque1 = page.url().split("/payments/")[1];
ok(await page.locator("text=State Bank").isVisible(), "the cheque shows its bank");

await page.click('button:has-text("Mark deposited")');
await page.waitForSelector("text=Cheque: Deposited");
await page.click('button:has-text("Mark cleared")');
await page.waitForSelector("text=Cheque: Cleared");
ok(true, "the cheque moves to Deposited and then Cleared");
await page.screenshot({ path: `${S}/shot-cheque-cleared.png` });

// ---- second cheque: bounce it, the invoice owes the money again ----
const second = await bill(`Cheque Bounce ${uniq}`);
const paid = await api("POST", "/api/payments", { date: today, customerId, mode: "cheque", reference: `CQ-B-${uniq}`, amountPaise: 288400, purpose: "against_invoices", invoiceId: second.body.id, allocation: "auto" });
ok(paid.status === 201, "a second cheque for the second bill is recorded through the API");
const invoiceBalance = async (id) => (await api("GET", `/api/invoices/${id}`)).body.balanceDuePaise;
ok((await invoiceBalance(second.body.id)) === 0, "the second bill is paid by the cheque");

await page.goto(`${B}/#/payments/${paid.body.payment.id}`);
await page.waitForSelector("text=Cheque: Received");
await page.click('button:has-text("Mark bounced")');
await page.fill('div[role="dialog"] input', "Funds not available");
await page.click('div[role="dialog"] button:has-text("Mark bounced")');
await page.waitForSelector("text=Cheque bounced.");
ok(true, "the cheque is marked bounced with its reason");
ok((await invoiceBalance(second.body.id)) === 288400, "the bill owes the money again after the bounce");
ok(await page.locator("text=Voided: Cheque bounced: Funds not available").isVisible(), "the payment shows as voided with the bounce reason");

// The cleared cheque from before is untouched by the bounce.
ok((await invoiceBalance(first.body.id)) === 0, "the first bill stays paid (its cheque cleared)");

// ---- the list: the cheque filter and the pending line ----
await page.goto(`${B}/#/payments`);
await page.waitForSelector('select[aria-label="Cheque status"]');
await page.selectOption('select[aria-label="Cheque status"]', "bounced");
await page.waitForTimeout(700);
ok((await page.locator('text=Cheque · Bounced').count()) >= 1, "the bounced filter lists a bounced cheque");

// ---- phone: the cheque is read, the actions are not offered ----
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${B}/#/payments/${cheque1}`);
await page.waitForSelector("text=Cheque: Cleared");
ok(!(await page.locator('button:has-text("Mark bounced")').first().isVisible().catch(() => false)), "phone: no cheque action buttons are visible");
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the payment page does not scroll sideways");

ok(errors.length === 0, "no browser errors" + (errors.length ? `: ${errors.join(" | ")}` : ""));
await browser.close();
