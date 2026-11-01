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
const input = (label) => page.locator(`input[aria-label^="${label} rate"]`);
const toggle = (label, text) => page.locator(`div:has(> span:text-is("${label}")) button:has-text("${text}")`).first();

await page.goto(B);
await page.fill('input[autocomplete="username"]', "owner");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Log in")');
await page.waitForSelector("text=Today's rates");
ok(true, "home shows the Today's rates card");

await page.click('a:has-text("Rates")');
await page.waitForSelector("h1:has-text('Rates')");
await page.waitForSelector("text=Rates for today");

// live conversion and unit switch
await input("Gold 24K995").fill("12,000");
await page.waitForSelector("text=₹1,20,00,000 per kg · ₹12,000.00 per gram");
ok(true, "typing per gram shows both figures");
await page.locator('button:has-text("per kg")').first().click();
ok((await input("Gold 24K995").inputValue()) === "12000000", "switching to per kg converts the typed value exactly");
await page.locator('button:has-text("per gram")').first().click();
ok((await input("Gold 24K995").inputValue()) === "12000", "and back to per gram");
await input("Gold 24K995").fill("12,000.5555");
await page.waitForSelector("text=at most 3 decimal places");
ok(true, "too many decimals is explained, not rounded");
await input("Gold 24K995").fill("12,000");

await input("Gold 22K916").fill("11,000");
await input("Silver").fill("150.123");
await page.locator("text=₹1,50,123 per kg · ₹150.123 per gram >> visible=true").first().waitFor();
ok(true, "silver per gram with 3 decimals is exact");

async function saveAll() {
  await page.click('button:has-text("Save today\'s rates")');
  // confirm any typo-guard prompts that appear (baseline may differ from a previous run)
  for (let i = 0; i < 3; i++) {
    const yes = page.locator('button:has-text("Yes, save it")').first();
    if (await yes.waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) await yes.click();
  }
}
await saveAll();
await page.locator("text=Saved today: ₹12,000.00 per gram >> visible=true").first().waitFor();
await page.locator("text=Saved today: ₹150.123 per gram >> visible=true").first().waitFor();
ok(true, "saved all three, status shows 'Saved today'");
await page.screenshot({ path: `${S}/shot-rates.png` });

// typo guard
await input("Gold 24K995").fill("13,500");
await page.click('button:has-text("Save today\'s rates")');
await page.waitForSelector("text=+12.5% from the previous rate");
ok(true, "typo guard asks to confirm a +12.5% change");
await page.screenshot({ path: `${S}/shot-guard.png` });
await page.click('button:has-text("No, go back")');
ok(await page.locator("text=Saved today: ₹12,000.00 per gram >> visible=true").count() === 1, "'No, go back' saved nothing");
await page.click('button:has-text("Save today\'s rates")');
await page.click('button:has-text("Yes, save it")');
await page.locator("text=Saved today: ₹13,500.00 per gram >> visible=true").first().waitFor();
ok(true, "'Yes, save it' saves it");
await input("Gold 24K995").fill("12,000");
await saveAll();
await page.locator("text=Saved today: ₹12,000.00 per gram >> visible=true").first().waitFor();

// home card
await page.click('a:has-text("Home")');
await page.waitForSelector("text=₹12,000.00");
ok(await page.locator("text=Today's rate is not set").count() === 0, "home card has no warning when all three are saved today");
await page.screenshot({ path: `${S}/shot-home.png` });

// earlier date
await page.click('a:has-text("Rates")');
await page.click('button:has-text("Add a rate for an earlier date")');
await page.fill('div[role="dialog"] input[type="date"]', "2026-10-20");
await page.selectOption('div[role="dialog"] select', "silver");
const price = (140 + (Date.now() % 40) / 10).toFixed(1);
await page.fill('div[role="dialog"] input[aria-label^="Silver rate"]', price);
await page.waitForSelector("text=This is not today's date");
await page.click('div[role="dialog"] button:has-text("Save anyway")');
await page.waitForSelector("tbody tr:has-text('20 Oct 2026')");
ok(true, "earlier-date rate saved and shown in the table");

// edit with reason + history
await page.locator("tbody tr:has-text('20 Oct 2026') button").nth(2).click();
await page.waitForSelector('div[role="dialog"] h2:has-text("Silver")');
const newPrice = (Number(price) + 1.1).toFixed(1);
await page.fill('div[role="dialog"] input[aria-label^="Silver rate"]', newPrice);
await page.fill('div[role="dialog"] label:has-text("Reason") input', "typed wrong");
await page.click('div[role="dialog"] button:has-text("Save")');
await page.waitForSelector("div[role=dialog]", { state: "detached" });
await page.locator("tbody tr:has-text('20 Oct 2026') button").nth(2).click();
await page.waitForSelector("text=Earlier values");
await page.waitForSelector('text=typed wrong');
ok(true, "edit kept the old value; history shows it with the reason");
await page.screenshot({ path: `${S}/shot-rate-history.png` });
await page.click('div[role="dialog"] button:has-text("Cancel")');

// future date blocked in dialog
await page.click('button:has-text("Add a rate for an earlier date")');
await page.fill('div[role="dialog"] input[type="date"]', "2099-01-01");
await page.fill('div[role="dialog"] input[aria-label^="Gold 24K995 rate"]', "12,000");
await page.click('div[role="dialog"] button:has-text("Save")');
ok(await page.locator("text=cannot be saved for a future date").count() === 1, "a future date is refused");
await page.click('div[role="dialog"] button:has-text("Cancel")');

// phone
const phone = await browser.newContext({ viewport: { width: 390, height: 800 } });
const p2 = await phone.newPage();
await p2.goto(B);
await p2.fill('input[autocomplete="username"]', "owner");
await p2.fill('input[type="password"]', PASSWORD);
await p2.click('button:has-text("Log in")');
await p2.waitForSelector("text=Today's rates");
await p2.goto(B + "/#/rates");
await p2.waitForSelector("text=Saved today");
ok(await p2.locator('button:has-text("Save today")').isVisible() === false, "phone: Save is hidden");
ok(await p2.locator("input").first().isVisible() === false, "phone: no rate inputs");
ok(await p2.locator('button:has-text("Add a rate for an earlier date")').isVisible() === false, "phone: Add earlier is hidden");
await p2.locator("tbody tr").first().locator("button").first().click();
ok(await p2.locator('div[role="dialog"]').count() === 0, "phone: tapping a rate does not open an editor");
ok(!(await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "phone: no sideways page scroll");
await p2.screenshot({ path: `${S}/shot-rates-phone.png` });
await p2.goto(B + "/#/");
await p2.waitForSelector("text=Today's rates");
ok(!(await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "phone: home card fits");
await p2.screenshot({ path: `${S}/shot-home-phone.png` });

ok(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
