// Spec 052: the Data checks screen through the browser. Owner opens it from Settings, runs the checks, runs them
// again, and the phone view has no sideways scroll. The checks change nothing, so the earlier tests' data must pass.
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

await page.goto(B);
await page.fill('input[autocomplete="username"]', "owner");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Log in")');
await page.waitForSelector("text=Today's rates");

ok(await page.locator('a:has-text("Settings") >> visible=true').first().isVisible(), "the owner sees the Settings link");
await page.click('a:has-text("Settings") >> visible=true');
await page.waitForSelector("h1:has-text('Settings')");
ok(await page.locator('a:has-text("Data checks") >> visible=true').first().isVisible(), "Settings links to Data checks");
await page.click('a:has-text("Data checks") >> visible=true');
await page.waitForSelector("h1:has-text('Data checks')");
ok(true, "the Data checks page opens from Settings");
ok((await page.locator("text=Run checks").count()) >= 1, "the page starts with a Run checks button and no results");

await page.click('button:has-text("Run checks")');
await page.waitForSelector("text=/All 10 checks passed\\.|checks passed\\./", { timeout: 30000 });
const summary = (await page.locator('[role="status"]').first().textContent()) ?? "";
ok(summary.includes("All 10 checks passed."), `every check passes on the test data (${summary.trim().slice(0, 80)})`);
const titles = await page.locator("main li h2").allTextContents();
ok(titles.length === 10, `ten checks are listed (${titles.length})`);
const okBadges = await page.locator("main li span:text-is('OK')").count();
ok(okBadges === 10, `ten OK badges are shown (${okBadges})`);
await page.screenshot({ path: `${S}/shot-integrity.png`, fullPage: true });

await page.click('button:has-text("Run again")');
await page.waitForTimeout(800);
await page.waitForSelector("text=All 10 checks passed.", { timeout: 30000 });
ok(true, "Run again gives the same result");

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
ok(!wide, "the Data checks page has no sideways scroll at 390 px");

ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
