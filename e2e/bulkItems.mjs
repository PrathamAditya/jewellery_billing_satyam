// Spec 020b: bulk quantity items (Tilli) through the screens. Create with an opening quantity, sell, refuse a sale below zero,
// adjust with a reason, read the history; the phone is read only.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const S = process.argv[2] ?? "e2e/screenshots";
const B = process.env.BASE_URL ?? "http://localhost:8799";
const PASSWORD = process.env.OWNER_PASSWORD ?? "throwaway-local-pass-1";
mkdirSync(S, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const errors = [];
const ok = (cond, msg) => {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) process.exitCode = 1;
};
const uniq = Date.now().toString().slice(-6);
const name = `Tilli e2e ${uniq}`;
// Waits up to 5 s for the text to appear (lists and messages load after a click).
const seen = (locator) => locator.first().waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);

async function openPage(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/40[0-9]/.test(m.text()) && errors.push("console: " + m.text()));
  await page.goto(B);
  await page.fill('input[autocomplete="username"]', "owner");
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button:has-text("Log in")');
  await page.waitForSelector("text=Today's rates");
  return page;
}

// ---- PC: create with an opening quantity ----
const page = await openPage({ width: 1280, height: 1000 });
await page.goto(`${B}/#/inventory/bulk`);
await page.waitForSelector("h1:has-text('Bulk items')");
await page.click('button:has-text("New bulk item")');
await page.fill('input[aria-label="Bulk item name"]', name);
await page.selectOption('select[aria-label="Unit"]', "pcs");
await page.fill('input[aria-label="Opening quantity"]', "10");
await page.click('form[aria-label="New bulk item"] button:has-text("Save")');
await page.waitForSelector(`h1:has-text('${name}')`);
ok(await seen(page.locator('[data-testid="bulk-quantity"]:has-text("10")')), "a new bulk item starts with the opening quantity 10");

// ---- sell 3 ----
const openMovement = async () => {
  await page.click('button:has-text("Record movement")');
  await page.waitForSelector('form[aria-label="Record movement"]');
};
await openMovement();
await page.selectOption('select[aria-label="Movement kind"]', "sold");
await page.fill('input[aria-label="Quantity"]', "3");
await page.click('button:has-text("Save movement")');
ok(await seen(page.locator("text=Sold recorded. 7 pcs in stock now.")), "a sale of 3 leaves 7");
ok(await seen(page.locator('[data-testid="bulk-quantity"]:has-text("7")')), "the quantity on the page is 7");

// ---- selling more than is in stock is refused ----
await openMovement();
await page.selectOption('select[aria-label="Movement kind"]', "sold");
await page.fill('input[aria-label="Quantity"]', "20");
await page.click('button:has-text("Save movement")');
ok(await seen(page.locator(`[role="alert"]:has-text("Only 7 pcs of ${name} are in stock")`)), "a sale of 20 is refused with the quantity in stock");
await page.click('button:has-text("Cancel")');

// ---- an adjustment needs a reason, then takes two out ----
await openMovement();
await page.selectOption('select[aria-label="Movement kind"]', "adjusted");
await page.fill('input[aria-label="Quantity"]', "-2");
ok(await page.locator('button:has-text("Save movement")').isDisabled(), "an adjustment cannot be saved without a reason");
await page.fill('input[aria-label="Movement reason"]', `Counted short ${uniq}`);
await page.click('button:has-text("Save movement")');
ok(await seen(page.locator("text=Adjusted recorded. 5 pcs in stock now.")), "an adjustment of -2 with a reason leaves 5");

// ---- history: oldest first with the balance after each row ----
// Scoped to the movements table: the By place table (spec 021b) is a table in another section.
const rows = page.locator('section:has(h2:has-text("Movements")) table tbody tr');
await seen(page.locator(`td:has-text("Counted short ${uniq}")`));
const kinds = await rows.locator("td:nth-child(2)").allTextContents();
const balances = await rows.locator("td:nth-child(4)").allTextContents();
ok(JSON.stringify(kinds) === JSON.stringify(["Received", "Sold", "Adjusted"]), `history shows the kinds in order (${kinds.join(", ")})`);
ok(JSON.stringify(balances) === JSON.stringify(["10", "7", "5"]), `history balances are 10, 7, 5 (${balances.join(", ")})`);
ok(await seen(page.locator(`td:has-text("Opening stock")`)), "the opening quantity is the first row, with its reason");
await page.screenshot({ path: `${S}/bulk-item.png`, fullPage: true });

// ---- the list shows the quantity ----
await page.goto(`${B}/#/inventory/bulk`);
await page.waitForSelector('input[aria-label="Search bulk items"]');
await page.fill('input[aria-label="Search bulk items"]', name);
ok(await seen(page.locator(`tr:has-text("${name}") >> td:has-text("5")`)), "the bulk list shows 5 in stock");
await page.close();

// ---- phone: read only ----
const phone = await openPage({ width: 390, height: 844 });
await phone.goto(`${B}/#/inventory/bulk`);
await phone.waitForSelector('input[aria-label="Search bulk items"]');
await phone.fill('input[aria-label="Search bulk items"]', name);
ok(await seen(phone.locator(`tr:has-text("${name}")`)), "phone: the bulk list shows the item");
ok(!(await phone.locator('button:has-text("New bulk item")').first().isVisible()), "phone: New bulk item is hidden");
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the bulk list does not scroll sideways");
await phone.locator(`tr:has-text("${name}")`).first().click();
await phone.waitForSelector(`h1:has-text('${name}')`);
ok(!(await phone.locator('button:has-text("Record movement")').first().isVisible()), "phone: Record movement is hidden");
ok(await seen(phone.locator("text=Counted short " + uniq)), "phone: the movements are visible");
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the item page does not scroll sideways");
await phone.close();

ok(errors.length === 0, `no browser errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
