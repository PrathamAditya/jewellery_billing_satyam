// Spec 019d: credit notes through the screens. Return a line from a bill, apply the held credit to a second bill,
// see the settlement line, void the note, print it, and read it on a phone.
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
const balanceOf = async (id) => (await api("GET", `/api/invoices/${id}`)).body.balanceDuePaise;

// One customer, two silver bills of 9.800 g (payable ₹2,884.00 each). The first is paid ₹2,500.00 at sale.
const cust = await api("POST", "/api/customers", { name: `Credit Check ${uniq}` });
const customerId = cust.body.customer.id;
const name = `Credit Check ${uniq}`;
const bill = () =>
  api("POST", "/api/invoices", {
    invoiceDate: "2026-02-03",
    customerId,
    customerName: name,
    taxMode: "intra",
    lines: [{ description: "Silver chain", purity: "silver", hsn: "7113", grossWeightMg: 9800, netWeightMg: 9800, polishBps: 0, goldRatePaisePerKg: 28572000, labourRatePaisePerKg: 0 }],
  });
const first = await bill();
const second = await bill();
ok(first.status === 201 && first.body.payablePaise === 288400, "a bill of ₹2,884.00 is saved for the credit checks");
const sale = await api("POST", "/api/payments", { date: today, customerId, mode: "upi", reference: `CN-${uniq}`, purpose: "at_sale", invoiceId: first.body.id, amountPaise: 250000 });
ok(sale.status === 201, "₹2,500.00 is received at the time of sale on the first bill");

// ---- return a line from the bill's page ----
await page.goto(`${B}/#/invoices/${first.body.id}`);
await page.waitForSelector(`h1:has-text('${first.body.invoiceNo}')`);
await page.click('button:has-text("Credit note")');
await page.waitForSelector('div[role="dialog"] input[placeholder="0.00"]');
await page.fill('div[role="dialog"] input[placeholder="0.00"]', "1000");
await page.fill('div[role="dialog"] input[placeholder="e.g. Chain returned, wrong size"]', "Chain returned, wrong size");
ok((await page.locator('div[role="dialog"]:has-text("1,030.00")').count()) >= 1, "the preview shows the credit note of ₹1,030.00");
await page.click('button:has-text("Save credit note")');
await page.waitForURL(/#\/credit-notes\//);
await page.waitForSelector("text=Still held");
ok(await page.locator("text=₹646.00").first().isVisible(), "the note holds ₹646.00 after ₹384.00 went to the bill");
ok((await balanceOf(first.body.id)) === 0, "the first bill is settled by the credit");
const noteUrl = page.url();
const noteId = noteUrl.split("/credit-notes/")[1];
const cnNo = (await page.locator("h1").first().innerText()).trim();
ok(/^CN-\d{4}$/.test(cnNo), `the note has its number (${cnNo})`);

// ---- apply the held credit to the second bill ----
await page.click('button:has-text("Apply to a bill")');
await page.waitForSelector('div[role="dialog"] select');
await page.selectOption('div[role="dialog"] select', { index: 1 });
await page.fill('div[role="dialog"] input[inputmode="decimal"]', "646");
await page.click('div[role="dialog"] button:has-text("Apply")');
await page.waitForSelector("text=Saved.");
ok((await balanceOf(second.body.id)) === 223800, "the second bill owes ₹2,238.00 after the ₹646.00 is applied");
ok(((await page.locator("span:has-text('Still held')").first().innerText()) ?? "").includes("₹0.00"), "nothing is held any more");

// ---- the first bill's settlement shows the credit line ----
await page.goto(`${B}/#/invoices/${first.body.id}`);
await page.waitForSelector(`h1:has-text('${first.body.invoiceNo}')`);
await page.click('button:has-text("Settlement")');
await page.waitForSelector(`a:has-text("${cnNo}")`);
ok(await page.locator(`a:has-text("${cnNo}")`).isVisible(), "the settlement page lists the credit note as received");

// ---- print view ----
await page.goto(`${B}/#/print/credit-note/${noteId}`);
await page.waitForSelector('div.serif:text-is("CREDIT NOTE")');
ok(await page.locator(`div:text-is("No. ${cnNo}")`).isVisible(), "the printed credit note carries its number");
ok(await page.locator('div:text-is("Credit amount")').first().isVisible().catch(() => false) || (await page.locator("span:text-is('Credit amount')").count()) >= 1, "the printed credit note shows the amount");

// ---- void: the applied credit goes back to the bill ----
await page.goto(`${B}/#/credit-notes/${noteId}`);
await page.waitForSelector(`h1:has-text('${cnNo}')`);
await page.click('button:has-text("Void")');
await page.fill('div[role="dialog"] input', "Customer kept the chain");
await page.click('div[role="dialog"] button:has-text("Confirm")');
await page.waitForSelector("text=Voided:");
ok((await balanceOf(first.body.id)) === 38400, "voiding the note puts the ₹384.00 back on the first bill");
ok((await balanceOf(second.body.id)) === 288400, "voiding puts the ₹646.00 back on the second bill");

// ---- list ----
await page.goto(`${B}/#/credit-notes`);
await page.waitForSelector(`text=${cnNo}`);
ok(await page.locator(`td:has-text("${cnNo}")`).first().isVisible(), "the list shows the note");

// ---- phone: read only ----
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${B}/#/credit-notes/${noteId}`);
await page.waitForSelector(`h1:has-text('${cnNo}')`);
ok(!(await page.locator('button:has-text("Void")').first().isVisible().catch(() => false)), "phone: no void button is visible");
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the credit note page does not scroll sideways");

ok(errors.length === 0, "no browser errors" + (errors.length ? `: ${errors.join(" | ")}` : ""));
await browser.close();
