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
const totals = page.locator('[aria-label="Totals"]');
const totalsText = async () => (await totals.innerText()).replace(/\s+/g, " ");

await page.goto(B);
await page.fill('input[autocomplete="username"]', "owner");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Log in")');
await page.waitForSelector("text=Today's rates");
await page.click('a:has-text("Calculator")');
await page.waitForSelector("h1:has-text('Invoice calculator')");
ok(await page.locator("text=Type a net weight and a gold rate").count() === 1, "empty calculator asks for input");

// A. the client's real invoice
await page.click('button:has-text("Fill with the Baba Jewellers example")');
await totals.waitFor();
let t = await totalsText();
ok(t.includes("Taxable value ₹2,800.06"), "A: amount before tax ₹2,800.06");
ok(t.includes("SGST @ 1.5% ₹42.00") && t.includes("CGST @ 1.5% ₹42.00"), "A: SGST and CGST ₹42.00 each");
ok(t.includes("Total Amount after Tax ₹2,884.06"), "A: total after tax ₹2,884.06 (as on the paper bill)");
ok(t.includes("Round-off -₹0.06") && t.includes("Payable ₹2,884.00"), "A: round-off -₹0.06, payable ₹2,884.00");
ok(await page.locator("tbody >> text=₹285.72").count() >= 1, "A: display rate ₹285.72 per gram");
await page.screenshot({ path: `${S}/shot-calc.png` });

// E. other state
await page.click('button:has-text("Other state (IGST)")');
t = await totalsText();
ok(t.includes("IGST @ 3% ₹84.00") && !t.includes("CGST"), "E: IGST ₹84.00, no CGST/SGST");
await page.click('button:has-text("Same state")');

// D. polish
await page.fill('input[aria-label="Polish % line 1"]', "5");
await page.fill('input[aria-label="Net g line 1"]', "10");
await page.fill('input[aria-label="Gross g line 1"]', "10");
t = await totalsText();
ok(t.includes("Taxable value ₹3,000.06") && t.includes("Payable ₹3,09,000.00".replace("3,09,000","3,090")), "D: polish 0.5 g -> ₹3,000.06 and payable ₹3,090.00");

// F. two rate groups
await page.fill('input[aria-label="Polish % line 1"]', "");
await page.fill('input[aria-label="Net g line 1"]', "9.8");
await page.fill('input[aria-label="Gross g line 1"]', "9.8");
await page.click('button:has-text("Add line")');
await page.fill('input[aria-label="Net g line 2"]', "12.345");
await page.fill('input[aria-label="Gold rate line 2"]', "11,000.50");
await page.fill('input[aria-label="Labour rate line 2"]', "450.25");
// Spec 012b: HSN 9988 is job work at 5%. Line 2 becomes job work, its amount is the job-work formula (5,558.34).
await page.selectOption('select[aria-label="HSN line 2"]', "9988");
t = await totalsText();
ok(await page.locator('output[aria-label="GST line 2"]').innerText() === "5%", "F: HSN 9988 shows 5% GST");
ok(t.includes("SGST @ 2.5%") && t.includes("SGST @ 1.5%"), "F: two rate groups shown");
ok(t.includes("Payable ₹8,720.00"), "F: payable ₹8,720.00 (spec 012b: job work line plus 3% line)");
ok(await page.locator("text=₹5,558.34").count() >= 1, "B: job-work amount ₹5,558.34 (owner formula)");
await page.screenshot({ path: `${S}/shot-calc-two.png` });

// validation messages
await page.fill('input[aria-label="Net g line 2"]', "12.3456");
ok(await page.locator("text=at most 3 decimal places").count() >= 1, "weight with 4 decimals is explained");
await page.fill('input[aria-label="Net g line 2"]', "12.345");
await page.selectOption('select[aria-label="HSN line 2"]', "7113");
await page.fill('input[aria-label="Gross g line 2"]', "1");
ok(await page.locator("text=gross weight cannot be less than net weight").count() === 1, "gross below net is refused");
await page.fill('input[aria-label="Gross g line 2"]', "");

// remove line
await page.click('button[aria-label="Remove line 2"]');
t = await totalsText();
ok(t.includes("Payable ₹2,884.00"), "removing line 2 goes back to ₹2,884.00");

// phone
const phone = await browser.newContext({ viewport: { width: 390, height: 800 } });
const p2 = await phone.newPage();
await p2.goto(B);
await p2.fill('input[autocomplete="username"]', "owner");
await p2.fill('input[type="password"]', PASSWORD);
await p2.click('button:has-text("Log in")');
await p2.waitForSelector("text=Today's rates");
ok(await p2.locator('a:has-text("Calculator")').isVisible() === false, "phone: Calculator link is hidden");
await p2.goto(B + "/#/calculator");
await p2.waitForSelector("text=read-only");
ok(await p2.locator("input").count() === 0 || (await p2.locator("input").first().isVisible()) === false, "phone: no inputs");

ok(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
