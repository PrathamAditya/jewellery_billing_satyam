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

// Business details: fake test values only (never real GSTIN, PAN, phone or bank numbers in the repo)
await page.goto(B + "/#/settings");
await page.waitForSelector("h1:has-text('Settings')");
const uniq = Date.now().toString().slice(-5);
await page.fill('label:has-text("Legal business name") input', `Test Showroom ${uniq}`);
await page.fill('label:has-text("Address") textarea', "Shop 9, Test Market\nTest Town");
await page.fill('label:has-text("GSTIN") input', "22AAAAA0000A1Z5");
await page.click('button:has-text("Save")');
await page.locator("text=Saved. New documents use these details >> visible=true").first().waitFor({ timeout: 10000 });
ok(true, "business details saved");

await page.goto(B + "/#/");
await page.waitForSelector("text=Today's rates");
ok(await page.locator("text=Business details are not filled in yet >> visible=true").count() === 0, "banner is gone once the business details are filled in");

// Bad GSTIN is explained next to the field
await page.goto(B + "/#/settings");
await page.waitForSelector("h1:has-text('Settings')");
await page.fill('label:has-text("GSTIN") input', "BAD");
await page.click('button:has-text("Save")');
await page.locator("text=GSTIN is not valid >> visible=true").first().waitFor({ timeout: 10000 });
ok(true, "invalid GSTIN is explained under the field");
await page.fill('label:has-text("GSTIN") input', "22AAAAA0000A1Z5");
await page.click('button:has-text("Save")');
await page.locator("text=Saved. New documents use these details >> visible=true").first().waitFor({ timeout: 10000 });

// Limits
await page.click('button:has-text("Limits")');
await page.fill('label:has-text("Cash warning limit") input', "150000");
await page.click('button:has-text("Save")');
await page.locator("text=Saved. New documents use these details >> visible=true").first().waitFor({ timeout: 10000 });
await page.click('button:has-text("Limits")');
ok(await page.locator('label:has-text("Cash warning limit") input').inputValue() === "150000", "cash limit kept after reload");

// Numbers: set next number for a far-off year so the test can re-run
await page.click('button:has-text("Numbers")');
await page.fill('input[placeholder="2026-27"]', "2041-42");
await page.fill('label:has-text("Next number") input', "2762");
await page.click('button:has-text("Set next number")');
await page.locator("text=The next INV number for 2041-42 is 2762 >> visible=true").first().waitFor({ timeout: 10000 });
ok(true, "next invoice number can be set to continue the paper book");
await page.fill('label:has-text("Next number") input', "5");
await page.click('button:has-text("Set next number")');
await page.locator("text=higher than the current number >> visible=true").first().waitFor({ timeout: 10000 });
ok(true, "a lower next number is refused");
await page.screenshot({ path: `${S}/shot-settings-numbers.png` });

// Logo: a 1x1 PNG
await page.click('button:has-text("Logo and print")');
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
await page.setInputFiles('input[aria-label="Upload logo"]', { name: "logo.png", mimeType: "image/png", buffer: png });
await page.locator("text=Logo saved. >> visible=true").first().waitFor({ timeout: 10000 });
ok(true, "small PNG logo uploads");
await page.click('button:has-text("Remove logo")');

// Phone: read-only
const phone = await browser.newContext({ viewport: { width: 390, height: 800 } });
const p2 = await phone.newPage();
await p2.goto(B);
await p2.fill('input[autocomplete="username"]', "owner");
await p2.fill('input[type="password"]', PASSWORD);
await p2.click('button:has-text("Log in")');
await p2.waitForSelector("text=Today's rates");
await p2.goto(B + "/#/settings");
await p2.waitForSelector("text=read-only");
ok(await p2.locator('button:has-text("Save")').first().isVisible() === false, "phone: no Save buttons");
ok(!(await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "phone: settings page does not scroll sideways");

ok(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
