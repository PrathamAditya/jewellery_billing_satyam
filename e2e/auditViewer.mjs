// Spec 051: the audit history viewer through the screens. Owner sees rows, filters, opens a detail, phone view read-only.
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

// A customer saved now, so there is a fresh row to find.
await page.evaluate(async (name) => {
  await fetch("/api/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
}, `Audit Check ${uniq}`);

ok(await page.locator('a:has-text("Audit") >> visible=true').first().isVisible(), "the owner sees the Audit link in the top bar");
await page.click('a:has-text("Audit") >> visible=true');
await page.waitForSelector("h1:has-text('Audit history')");
ok(true, "the Audit history page opens");
await page.waitForSelector("tbody tr td:has-text('customer_create')");
ok(true, "the page lists the customer save with its action");
ok((await page.locator("tbody tr").count()) >= 2, "rows are listed");
await page.screenshot({ path: `${S}/shot-audit-list.png` });

// Filter by action: every row shown is that action.
await page.selectOption('select[aria-label="Action"]', "customer_create");
await page.waitForTimeout(500);
const actions = await page.locator("tbody tr td:nth-child(3)").allTextContents();
ok(actions.length > 0 && actions.every((a) => a.trim() === "customer_create"), "filter by action shows only that action");

// Filter by a date range: today only still shows the row just saved.
await page.selectOption('select[aria-label="Action"]', "");
await page.fill('input[aria-label="From date"]', today);
await page.fill('input[aria-label="To date"]', today);
await page.waitForTimeout(500);
ok((await page.locator("tbody tr").count()) >= 1, "a date range of today still shows today's rows");
await page.fill('input[aria-label="From date"]', "2019-01-01");
await page.fill('input[aria-label="To date"]', "2019-01-02");
await page.waitForTimeout(500);
ok((await page.locator("text=No changes match these filters.").count()) === 1, "a date range with no rows says so");
await page.click('button:has-text("Clear filters")');
await page.waitForTimeout(500);

// Row detail: the customer save carries its stored JSON detail, shown when the row is opened.
await page.selectOption('select[aria-label="Action"]', "customer_create");
await page.waitForTimeout(500);
await page.locator('button:has-text("Detail")').first().click();
ok(await page.locator("pre").first().isVisible(), "a row's detail opens and shows the stored JSON");
ok((await page.locator("pre").first().textContent()).includes("Audit Check"), "the detail holds the saved customer's name");
await page.click('button:has-text("Clear filters")');

// Read only: no edit, delete or void controls on the page.
const writes = await page.locator('button:has-text("Edit"), button:has-text("Delete"), button:has-text("Void"), button:has-text("Save")').count();
ok(writes === 0, "the page has no edit, delete, void or save controls");

// Phone: the table scrolls inside its box, the page does not scroll sideways.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${B}/#/audit`);
await page.waitForSelector("h1:has-text('Audit history')");
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the audit page does not scroll sideways");

ok(errors.length === 0, "no browser errors" + (errors.length ? `: ${errors.join(" | ")}` : ""));
await browser.close();
