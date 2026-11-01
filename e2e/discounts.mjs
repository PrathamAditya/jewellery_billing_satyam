// Spec 012c: pricing modes, discounts on gold, labour and total, the stored invoice, and the read-only phone view.
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

const totals = async () => (await page.locator('[aria-label="Totals"]').innerText()).replace(/\s+/g, " ");

await page.goto(B);
await page.fill('input[autocomplete="username"]', "owner");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Log in")');
await page.waitForSelector("text=Today's rates");

await page.goto(`${B}/#/calculator`);
await page.waitForSelector("h1:has-text('Invoice calculator')");
const clear = async () => {
  await page.click('button:has-text("Clear")');
  await page.waitForSelector('input[aria-label="Description line 1"]');
};

// ---- example A: two lines, gold 1%, labour fixed 300, total fixed 1,000 ----
await clear();
await page.fill('input[aria-label="Description line 1"]', `Gold A ${uniq}`);
await page.fill('input[aria-label="Gross g line 1"]', "10.000");
await page.fill('input[aria-label="Net g line 1"]', "10.000");
await page.fill('input[aria-label="Gold rate line 1"]', "6000");
await page.fill('input[aria-label="Labour rate line 1"]', "500");
await page.click('button:has-text("Add line")');
await page.fill('input[aria-label="Description line 2"]', `Gold B ${uniq}`);
await page.fill('input[aria-label="Gross g line 2"]', "5.000");
await page.fill('input[aria-label="Net g line 2"]', "5.000");
await page.fill('input[aria-label="Gold rate line 2"]', "6000");
await page.fill('input[aria-label="Labour rate line 2"]', "400");
await page.fill('input[aria-label="Gold discount amount"]', "1");
await page.fill('input[aria-label="Labour discount amount"]', "300");
await page.fill('input[aria-label="Total discount amount"]', "1000");
await page.waitForFunction(() => document.querySelector('[aria-label="Totals"]')?.innerText.includes("Payable"));
let t = await totals();
ok(t.includes("Total value ₹97,000.00"), "A: total value before discount ₹97,000.00");
ok(t.includes("Less: gold discount − ₹900.00") && t.includes("Less: labour discount − ₹300.00") && t.includes("Less: total discount − ₹1,000.00"), "A: the three discounts are ₹900, ₹300 and ₹1,000");
ok(t.includes("Taxable value ₹94,800.00"), "A: taxable value ₹94,800.00");
ok(t.includes("Payable ₹97,644.00"), "A: payable ₹97,644.00 (spec 012c example A)");
await page.screenshot({ path: `${S}/shot-discounts-example-a.png` });

// A percent above 100 is refused next to its box, and the totals are not shown for it.
await page.fill('input[aria-label="Gold discount amount"]', "150");
ok((await page.locator("text=A discount cannot be more than 100%").count()) >= 1, "a percent above 100% is refused, naming the box");
await page.fill('input[aria-label="Gold discount amount"]', "1");

// ---- example B: separate stone ----
await clear();
await page.fill('input[aria-label="Description line 1"]', `Stone ${uniq}`);
await page.selectOption('select[aria-label="Pricing line 1"]', "separate");
await page.fill('input[aria-label="Gross g line 1"]', "5.300");
await page.fill('input[aria-label="Net g line 1"]', "5.000");
await page.fill('input[aria-label="Gold rate line 1"]', "6000");
await page.fill('input[aria-label="Stone g line 1"]', "0.300");
await page.fill('input[aria-label="Stone amount line 1"]', "12,500");
await page.waitForFunction(() => document.querySelector('[aria-label="Totals"]')?.innerText.includes("Payable"));
t = await totals();
ok(t.includes("Payable ₹43,775.00"), "B: separate stone, payable ₹43,775.00 (spec 012c example B)");

// ---- example C: combined total ----
await clear();
await page.fill('input[aria-label="Description line 1"]', `Combined ${uniq}`);
await page.selectOption('select[aria-label="Pricing line 1"]', "combined");
await page.fill('input[aria-label="Net g line 1"]', "6.000");
await page.fill('input[aria-label="Total amount line 1"]', "50,000");
await page.waitForFunction(() => document.querySelector('[aria-label="Totals"]')?.innerText.includes("Payable"));
t = await totals();
ok(t.includes("Payable ₹51,500.00"), "C: combined total, payable ₹51,500.00 (spec 012c example C)");

// ---- a saved invoice with discounts shows them on the invoice page ----
const today = "2026-02-03";
const saved = await page.evaluate(async (date) => {
  const line = (over) => ({ description: "Gold Chain", purity: "22K916", hsn: "7113", grossWeightMg: 10000, netWeightMg: 10000, polishBps: 0, goldRatePaisePerKg: 600000000, labourRatePaisePerKg: 50000000, ...over });
  const body = {
    invoiceDate: date,
    customerName: "Discount Check",
    taxMode: "intra",
    lines: [line(), line({ netWeightMg: 5000, grossWeightMg: 5000, labourRatePaisePerKg: 40000000 })],
    discounts: { gold: { kind: "percent", value: 100 }, labour: { kind: "fixed", value: 30000 }, total: { kind: "fixed", value: 100000 } },
  };
  const res = await fetch("/api/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}, today);
ok(saved.status === 201 && saved.body.payablePaise === 9764400, `example A saved as an invoice (${saved.status})`);
await page.goto(`${B}/#/invoices/${saved.body.id}`);
await page.waitForSelector(`h1:has-text('${saved.body.invoiceNo}')`);
await page.waitForFunction(() => document.querySelector('[aria-label="Totals"]')?.innerText.includes("Payable"));
t = await totals();
ok(t.includes("Less: total discount − ₹1,000.00") && t.includes("Payable ₹97,644.00"), "the invoice page shows the stored discounts and payable");

// ---- phone: the calculator is read-only, the editing is hidden ----
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${B}/#/calculator`);
await page.waitForSelector("text=This phone view is read-only");
ok((await page.locator("text=Discounts (optional) >> visible=true").count()) === 0, "phone: the discount editing is hidden");
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: no sideways scroll");

ok(errors.length === 0, "no browser errors" + (errors.length ? `: ${errors.join(" | ")}` : ""));
await browser.close();
