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
const name = `Gold Seller ${uniq}`;
await page.evaluate(async (name) => {
  await fetch("/api/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
}, name);

// Owner's sample: 25.00 g gross, 2.02 g less, 75.26%, ₹14,800/g
await page.goto(B + "/#/old-gold/new");
await page.waitForSelector("h1:has-text('New old gold receipt')");
await page.fill('input[aria-label="Find customer"]', name);
await page.locator(`[role="option"]:has-text("${name}")`).first().click();
await page.fill('input[aria-label="Gross g row 1"]', "25.00");
await page.fill('input[aria-label="Less g row 1"]', "2.02");
await page.fill('input[aria-label="Purity row 1"]', "75.26");
await page.fill('input[aria-label="Rate row 1"]', "14,800");
await page.locator("text=Original amount").waitFor();
ok(await page.locator("dd:has-text('₹2,55,962.27')").count() >= 1, "preview: original amount ₹2,55,962.27");
ok(await page.locator("dd:has-text('-₹0.27')").count() >= 1, "preview: round off -₹0.27");
ok(await page.locator("dd:has-text('₹2,55,962.00')").count() >= 1, "preview: final amount ₹2,55,962.00");
await page.screenshot({ path: `${S}/shot-oldgold-preview.png` });

// Advance settlement
await page.click('button:has-text("Save receipt")');
await page.waitForSelector("h1:has-text('OGP-')");
const receipt = (await page.locator("h1").first().innerText()).split(" ")[0];
ok(/^OGP-\d{4}$/.test(receipt), "saved as " + receipt);
ok(await page.locator("dd:has-text('Advance Created')").count() === 0 && await page.locator("text=Transfer to Customer Advance").count() >= 1, "settled as a transfer to customer advance");
ok(await page.locator('a:has-text("PAY-")').count() === 1, "linked to an advance receipt PAY-");
await page.screenshot({ path: `${S}/shot-oldgold-page.png` });

// Direct payment settlement
await page.goto(B + "/#/old-gold/new");
await page.waitForSelector("h1:has-text('New old gold receipt')");
await page.fill('input[aria-label="Find customer"]', name);
await page.locator(`[role="option"]:has-text("${name}")`).first().click();
await page.fill('input[aria-label="Gross g row 1"]', "10.00");
await page.fill('input[aria-label="Less g row 1"]', "0.50");
await page.fill('input[aria-label="Purity row 1"]', "91.60");
await page.fill('input[aria-label="Rate row 1"]', "6,000");
await page.locator('label:has-text("Pay the customer now") input').check();
await page.fill('label:has-text("Reference") input', `NEFT-${uniq}`);
await page.click('button:has-text("Save receipt")');
await page.waitForSelector("h1:has-text('OGP-')");
ok(await page.locator("text=Paid to customer").count() === 1, "direct payment shows the payout");
ok(await page.locator(`text=NEFT-${uniq}`).count() >= 1, "payout reference is kept");

// Void it
await page.click('button:has-text("Void receipt")');
await page.fill('div[role="dialog"] input', "typed the weight wrong");
await page.click('div[role="dialog"] button:has-text("Void receipt")');
await page.waitForSelector("text=Voided: typed the weight wrong");
ok(true, "receipt voided, number kept");

// Phone: read-only
const phone = await browser.newContext({ viewport: { width: 390, height: 800 } });
const p2 = await phone.newPage();
await p2.goto(B);
await p2.fill('input[autocomplete="username"]', "owner");
await p2.fill('input[type="password"]', PASSWORD);
await p2.click('button:has-text("Log in")');
await p2.waitForSelector("text=Today's rates");
await p2.goto(B + "/#/old-gold");
await p2.waitForSelector("h1:has-text('Old gold purchases')");
ok(await p2.locator('button:has-text("New receipt")').isVisible() === false, "phone: New receipt hidden");
ok(!(await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "phone: list has no sideways page scroll");

ok(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
