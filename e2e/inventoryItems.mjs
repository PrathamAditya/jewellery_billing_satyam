// Spec 020: inventory items with a U No. through the screens. Create, search, change status, read the history; phone is read only.
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
// Waits up to 5 s for the text to appear (the lists and messages load after a click).
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

// ---- PC: create an item from the form ----
const page = await openPage({ width: 1280, height: 1000 });
await page.goto(`${B}/#/inventory/new`);
await page.waitForSelector('form[aria-label="New item"]');
await page.selectOption('select[aria-label="Item type"]', { label: "Ring (RING)" });
await page.selectOption('select[aria-label="Purity"]', "22K916");
await page.fill('input[aria-label="Gross weight"]', "12.500");
await page.fill('input[aria-label="Net weight"]', "12.000");
await page.fill('input[aria-label="Location"]', `Case ${uniq}`);
await page.fill('input[aria-label="Labour note"]', "Making per gram");
await page.click('button:has-text("Save item")');
await page.waitForSelector("h1:has-text('Ring')");
const heading = (await page.textContent("h1")).trim();
const uNo = heading.split(" ")[0];
ok(/^[A-Z0-9]{4}\d{2} Ring$/.test(heading), `a new ring is saved with a U No. (${uNo})`);
ok(await seen(page.locator(`text=Case ${uniq}`).first()), "the item page shows its location");
ok(await seen(page.locator("text=Created").first()), "the history starts with the Created row");

// ---- a typed U No. that is already in use is refused on the form ----
await page.goto(`${B}/#/inventory/new`);
await page.waitForSelector('form[aria-label="New item"]');
await page.selectOption('select[aria-label="Item type"]', { label: "Ring (RING)" });
await page.fill('input[aria-label="U No."]', uNo);
await page.fill('input[aria-label="Gross weight"]', "3.000");
await page.fill('input[aria-label="Net weight"]', "2.900");
await page.click('button:has-text("Save item")');
ok(await seen(page.locator(`text=${uNo} is already used by another item`)), "a duplicate U No. is refused with a clear message");

// ---- search by U No. ----
await page.goto(`${B}/#/inventory`);
await page.waitForSelector('input[aria-label="Search U No."]');
await page.fill('input[aria-label="Search U No."]', uNo.toLowerCase().slice(0, 3));
ok(await seen(page.locator(`td:has-text("${uNo}")`).first()), "search by part of the U No. finds the item");

// ---- change status with a reason ----
await page.locator(`td:has-text("${uNo}")`).first().click();
await page.waitForSelector(`h1:has-text('${uNo}')`);
await page.selectOption('select[aria-label="New status"]', "reserved");
await page.fill('input[aria-label="Reason"]', `Held for a bride ${uniq}`);
await page.click('button:has-text("Change status")');
ok(await seen(page.locator("text=Status changed to Reserved")), "the status changes to Reserved");
ok(await seen(page.locator(`td:has-text("Held for a bride ${uniq}")`)), "the status history shows the reason");
await seen(page.locator(`td:has-text("Held for a bride ${uniq}")`));
const rows = await page.locator("section table tbody tr").count();
ok(rows >= 2, `the history has the creation row and the change (${rows} rows)`);
await page.screenshot({ path: `${S}/inventory-item.png`, fullPage: true });

// ---- the item types page can add a type (PC) ----
await page.goto(`${B}/#/inventory/types`);
await page.waitForSelector('form[aria-label="Add item type"]');
await page.fill('input[aria-label="Type name"]', `Pendant ${uniq}`);
await page.fill('input[aria-label="Item code"]', `P${uniq.slice(-3)}`);
await page.click('button:has-text("Add type")');
ok(await seen(page.locator(`text=Pendant ${uniq} added`)), "a new item type can be added by the owner");
await page.close();

// ---- phone: look up only ----
const phone = await openPage({ width: 390, height: 844 });
await phone.goto(`${B}/#/inventory`);
await phone.waitForSelector('input[aria-label="Search U No."]');
await phone.fill('input[aria-label="Search U No."]', uNo);
ok(await seen(phone.locator(`td:has-text("${uNo}")`).first()), "phone: the search finds the item");
ok(!(await phone.locator('button:has-text("New item")').first().isVisible()), "phone: the New item button is hidden");
ok(!(await phone.locator('a:has-text("Item types")').first().isVisible()), "phone: the Item types link is hidden");
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the list does not scroll sideways");
await phone.locator(`td:has-text("${uNo}")`).first().click();
await phone.waitForSelector(`h1:has-text('${uNo}')`);
ok(!(await phone.locator('select[aria-label="New status"]').isVisible()), "phone: the status form is hidden");
ok(!(await phone.locator('button:has-text("Void item")').first().isVisible()), "phone: the void form is hidden");
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the item page does not scroll sideways");
await phone.close();

ok(errors.length === 0, `no browser errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
