// Dark mode: the header toggle switches the screens, the choice is kept after a reload, and print views stay light.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const S = process.argv[2] ?? "e2e/screenshots";
const B = process.env.BASE_URL ?? "http://localhost:8799";
const PASSWORD = process.env.OWNER_PASSWORD ?? "throwaway-local-pass-1";
mkdirSync(S, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "light" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && !/40[0-9]/.test(m.text()) && errors.push("console: " + m.text()));
const ok = (cond, msg) => {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) process.exitCode = 1;
};

const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
const bodyBg = () => page.evaluate(() => getComputedStyle(document.querySelector("#root > div")).backgroundColor);
const toggle = () => page.locator('header button[aria-label^="Switch to"]').first();

await page.goto(B);
await page.fill('input[autocomplete="username"]', "owner");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Log in")');
await page.waitForSelector("text=Today's rates");

ok(!(await isDark()), "the first visit follows the light device setting");
await toggle().click();
ok(await isDark(), "the toggle switches to dark");
ok((await bodyBg()) === "rgb(12, 10, 9)", `the page background turns dark (${await bodyBg()})`);
await page.screenshot({ path: `${S}/shot-theme-dark-home.png` });

await page.reload();
await page.waitForSelector("text=Today's rates");
ok(await isDark(), "the dark choice is kept after a reload");

await page.goto(`${B}/#/rates`);
await page.waitForSelector("h1:has-text('Rates')");
ok(await isDark(), "other screens use the same theme");
await page.screenshot({ path: `${S}/shot-theme-dark-rates.png` });

// Print views are light whatever the screen theme, and the theme comes back when leaving them.
await page.goto(`${B}/#/print/invoice/no-such-invoice`);
await page.waitForFunction(() => document.querySelector("main") !== null);
ok(!(await isDark()), "print views are light even when the screen is dark");
await page.goto(`${B}/#/`);
await page.waitForSelector("text=Today's rates");
ok(await isDark(), "leaving a print view brings the dark theme back");

await toggle().click();
ok(!(await isDark()), "the toggle switches back to light");

// Phone: the toggle is there and the header still fits without sideways scrolling.
await toggle().click();
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${B}/#/`);
await page.waitForSelector("text=Today's rates");
ok(await toggle().isVisible(), "the toggle is visible on a 390 px phone");
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the dark home does not scroll sideways on a phone");
await page.screenshot({ path: `${S}/shot-theme-dark-phone.png` });

ok(errors.length === 0, "no browser errors" + (errors.length ? `: ${errors.join(" | ")}` : ""));
await browser.close();
