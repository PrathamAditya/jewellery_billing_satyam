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
const name = `Order Test ${uniq}`;
await page.evaluate(async (name) => {
  await fetch("/api/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
}, name);

// New order
await page.goto(B + "/#/orders");
await page.waitForSelector("h1:has-text('Orders')");
await page.click('button:has-text("New order")');
await page.fill('div[role="dialog"] input[aria-label="Find customer"]', name);
await page.locator(`div[role="dialog"] [role="option"]:has-text("${name}")`).first().click();
await page.fill('div[role="dialog"] input[placeholder="e.g. Bridal set, wedding in December"]', `Bridal set ${uniq}`);
await page.click('div[role="dialog"] button:has-text("Create order")');
await page.waitForSelector("h1:has-text('ORD-')");
const orderNo = (await page.locator("h1").first().innerText()).split(" ")[0];
ok(/^ORD-\d{4}$/.test(orderNo), "order created as " + orderNo);

// Advance of ₹10,000 on the order
await page.click('button:has-text("Receive advance")');
await page.fill('div[role="dialog"] input[placeholder="e.g. 14,500"]', "10,000");
await page.fill('div[role="dialog"] label:has-text("Reference") input', "UPI-A1");
await page.click('div[role="dialog"] button:has-text("Save payment")');
await page.waitForFunction(() => /PAY-/.test(document.querySelector("h1")?.innerText ?? ""), null, { timeout: 15000 });
ok(true, "advance taken on the order and receipt shown");
await page.goto(B + `/#/orders`);
await page.fill('input[aria-label="Search orders"]', orderNo);
await page.locator(`a:has-text("${orderNo}")`).first().click();
await page.waitForSelector("text=Advance held for this order");

// Old booklet advance of ₹5,000 on the same order
await page.click('button:has-text("Receive advance")');
await page.locator('label:has-text("Advance from the old booklet") input').check();
await page.fill('div[role="dialog"] input[placeholder="e.g. 14,500"]', "5,000");
await page.fill('div[role="dialog"] label:has-text("Receipt number in the old booklet") input', `BOOK-${uniq}`);
await page.click('div[role="dialog"] button:has-text("Save payment")');
await page.waitForFunction(() => /PAY-|Payment at sale/.test(document.querySelector("h1")?.innerText ?? ""), null, { timeout: 15000 });
await page.goto(B + `/#/orders`);
await page.fill('input[aria-label="Search orders"]', orderNo);
await page.locator(`a:has-text("${orderNo}")`).first().click();
await page.waitForSelector("text=Advance held for this order");
ok(await page.locator("dd:has-text('₹15,000.00')").count() >= 1, "the order holds ₹15,000.00 across two advances");
ok(await page.locator("text=Opening advance (old booklet)").count() === 1, "the old booklet advance is marked as opening");

// Cancel with a partial refund
await page.click('button:has-text("Cancel order")');
await page.locator('label:has-text("Pay the customer back") input').check();
await page.fill('div[role="dialog"] input[inputmode="decimal"]', "12,000");
await page.fill('div[role="dialog"] label:has-text("Reference") input', `NEFT-${uniq}`);
await page.click('div[role="dialog"] button:has-text("Cancel order")');
await page.waitForSelector("text=Order cancelled and the refund recorded");
ok(await page.locator("text=cancelled").count() >= 1, "order is cancelled");
ok(await page.locator("text=Refunds").count() === 1, "refund is listed");
ok(await page.locator("dd:has-text('₹3,000.00')").count() >= 1, "₹3,000.00 is still held after the refund");
await page.screenshot({ path: `${S}/shot-order-cancelled.png` });

// Phone: no New order button
const phone = await browser.newContext({ viewport: { width: 390, height: 800 } });
const p2 = await phone.newPage();
await p2.goto(B);
await p2.fill('input[autocomplete="username"]', "owner");
await p2.fill('input[type="password"]', PASSWORD);
await p2.click('button:has-text("Log in")');
await p2.waitForSelector("text=Today's rates");
await p2.goto(B + "/#/orders");
await p2.waitForSelector("h1:has-text('Orders')");
ok(await p2.locator('button:has-text("New order")').isVisible() === false, "phone: New order hidden");
ok(!(await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "phone: orders list has no sideways page scroll");

ok(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
