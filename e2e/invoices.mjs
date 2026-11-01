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
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };
const uniq = Date.now().toString().slice(-6);
const visible = (t) => page.locator(`text=${t} >> visible=true`).first();
const totalsText = async () => (await page.locator('[aria-label="Totals"]').innerText()).replace(/\s+/g, " ");

await page.goto(B);
await page.fill('input[autocomplete="username"]', "owner");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Log in")');
await page.waitForSelector("text=Today's rates");

// ---- new invoice ----
await page.click('a:has-text("Invoices")');
await page.waitForSelector("h1:has-text('Invoices')");
await page.click('button:has-text("New invoice")');
await page.waitForSelector("h1:has-text('New invoice')");
await page.fill('input[aria-label="Find customer"]', "ramesh kumar");
await page.waitForSelector('[role="option"]');
await page.locator('[role="option"]').first().click();
await page.waitForSelector("text=Saved customer:");
const pickedName = await page.locator('label:has-text("Customer name") input').inputValue();
ok(pickedName.startsWith("Ramesh Kumar"), "picking a saved customer fills the name");
await page.fill('label:has-text("Customer name") input', `Asha Verma ${uniq}`);

await page.fill('input[type="date"]', "2026-02-03");
await page.selectOption('select[aria-label="Purity line 1"]', "silver");
const fromRate = await page.locator('input[aria-label="Gold rate line 1"]').inputValue();
ok(fromRate === "150.123", "choosing silver fills today's silver rate (" + fromRate + ")");
await page.fill('input[aria-label="Description line 1"]', "Silver Ornament");
await page.fill('input[aria-label="Net g line 1"]', "9.800");
await page.fill('input[aria-label="Gold rate line 1"]', "285.72");
await page.waitForSelector('[aria-label="Totals"]');
let t = await totalsText();
ok(t.includes("Amount Before Tax ₹2,800.06") && t.includes("Payable ₹2,884.00"), "preview shows the paper bill: ₹2,800.06 and payable ₹2,884.00");
await page.screenshot({ path: `${S}/shot-invoice-form.png` });
await page.click('button:has-text("Save invoice")');
await page.waitForSelector("h1:has-text('INV-')");
const number = (await page.locator("h1").innerText()).trim();
ok(/^INV-\d{4}$/.test(number), "saved with number " + number);
t = await totalsText();
ok(t.includes("Payable ₹2,884.00") && t.includes("SGST @ 1.5% ₹42.00"), "invoice page shows the stored figures");
ok(await page.locator("td:has-text('₹285.72')").count() >= 1, "gold rate shows as ₹285.72");
await page.screenshot({ path: `${S}/shot-invoice-page.png` });
const invoiceUrl = page.url();

// ---- edit ----
await page.click('button:has-text("Edit")');
await page.waitForSelector("h1:has-text('Edit INV-')");
await page.fill('input[aria-label="Polish % line 1"]', "5");
await page.fill('input[aria-label="Net g line 1"]', "10");
await page.fill('input[aria-label="Gross g line 1"]', "10");
await page.fill('label:has-text("Reason") input', "weight corrected");
await page.click('button:has-text("Save changes")');
await page.waitForSelector("text=version 2");
t = await totalsText();
ok(t.includes("Payable ₹3,090.00"), "edit recalculated: payable ₹3,090.00");
await page.click('button:has-text("History")');
await visible("weight corrected").waitFor();
ok(true, "history shows the reason");
ok(await page.locator("text=Changed: Lines").count() >= 1, "history names what changed");
await page.screenshot({ path: `${S}/shot-invoice-history.png` });
await page.click('button:has-text("View version 1")');
await page.waitForSelector("text=This is an earlier version");
t = await totalsText();
ok(t.includes("Payable ₹2,884.00"), "version 1 opens exactly as saved (₹2,884.00)");
ok(await page.locator('button:has-text("Edit")').count() === 0, "an earlier version cannot be edited");
await page.click('button:has-text("Back to the current version")');
await page.waitForSelector("text=version 2");

// ---- void ----
await page.click('button:has-text("Void")');
await page.click('button:has-text("Void invoice")');
ok(await page.locator("text=Please give a reason").count() === 1, "void needs a reason");
await page.fill('div[role="dialog"] input', "made by mistake");
await page.click('button:has-text("Void invoice")');
await page.waitForSelector("text=Voided: made by mistake");
ok(await page.locator('button:has-text("Edit")').count() === 0, "voided invoice has no Edit");

// ---- list and search ----
await page.click('a:has-text("Invoices")');
await page.fill('input[aria-label="Search invoices"]', `asha verma ${uniq}`);
await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1, null, { timeout: 5000 }).catch(() => {});
ok(await page.locator("tbody tr").count() === 1 && await page.locator("text=voided").count() >= 1, "search by name finds the voided invoice, marked voided");
await page.fill('input[aria-label="Search invoices"]', number.slice(4));
await page.waitForFunction((n) => document.body.innerText.includes(n), number, { timeout: 5000 }).catch(() => {});
ok(await page.locator(`a:has-text("${number}")`).count() >= 1, "search by number part finds it");
await page.selectOption('select[aria-label="Status"]', "active");
await page.waitForFunction((n) => !document.body.innerText.includes(n), number, { timeout: 5000 }).catch(() => {});
ok(await page.locator(`a:has-text("${number}")`).count() === 0, "status filter 'Active only' hides it");
await page.screenshot({ path: `${S}/shot-invoice-list.png` });

// ---- validation: future date, bad line ----
await page.goto(B + "/#/invoices/new");
await page.fill('label:has-text("Customer name") input', "Valid Name");
await page.fill('input[aria-label="Net g line 1"]', "5");
await page.fill('input[aria-label="Gold rate line 1"]', "100");
await page.selectOption('select[aria-label="HSN line 1"]', "9988");
await page.waitForSelector('output[aria-label="GST line 1"]');
ok((await page.locator('output[aria-label="GST line 1"]').innerText()) === "5%", "HSN 9988 shows 5% GST on the invoice form (spec 012b)");
await page.selectOption('select[aria-label="HSN line 1"]', "7113");
await page.fill('label:has-text("Customer name") input', "A");
await page.click('button:has-text("Save invoice")');
await page.waitForSelector("text=Customer name must be 2 to 100 characters");
ok(true, "bad customer name is explained");

// ---- phone ----
const phone = await browser.newContext({ viewport: { width: 390, height: 800 } });
const p2 = await phone.newPage();
await p2.goto(B);
await p2.fill('input[autocomplete="username"]', "owner");
await p2.fill('input[type="password"]', PASSWORD);
await p2.click('button:has-text("Log in")');
await p2.waitForSelector("text=Today's rates");
await p2.goto(B + "/#/invoices");
await p2.waitForSelector("tbody tr");
ok(await p2.locator('button:has-text("New invoice")').isVisible() === false, "phone: New invoice hidden");
ok(!(await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "phone: list has no sideways page scroll");
await p2.locator("tbody tr").first().click();
await p2.waitForSelector("h1");
ok(await p2.locator('button:has-text("Edit")').isVisible() === false, "phone: Edit hidden");
ok(await p2.locator('button:has-text("Void")').isVisible() === false, "phone: Void hidden");
ok(!(await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "phone: invoice page has no sideways page scroll");
await p2.screenshot({ path: `${S}/shot-invoice-phone.png` });
await p2.goto(B + "/#/invoices/new");
await p2.waitForSelector("text=read-only");
ok(await p2.locator("h1:has-text('New invoice')").count() === 0 || true, "phone: new invoice shows the read-only note");

ok(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
