// Spec 021b: stock places and transfers through the screens. Add a place, move an item there from its page, see
// the place on the list and on the stock-by-place page; move a bulk quantity and check both numbers. Phone: read only.
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
const placeName = `Testing centre 2 ${uniq}`;
const bulkName = `Tilli Loc ${uniq}`;
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

// The API, called from the logged-in page so the session cookie goes with it.
async function api(page, method, path, data) {
  const res = await page.request.fetch(`${B}${path}`, { method, data, headers: { Origin: B, "Content-Type": "application/json" } });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

// ---- PC: set up an item and a bulk item at Showroom (API) ----
const page = await openPage({ width: 1280, height: 1000 });
const types = (await api(page, "GET", "/api/inventory/types")).body.items;
const ringId = types.find((t) => t.name === "Ring").id;
const made = await api(page, "POST", "/api/inventory/items", { typeId: ringId, metal: "gold", purity: "22K916", grossWeightMg: 12_500, netWeightMg: 12_000, hsn: "7113" });
ok(made.status === 201 && made.body.item.locationName === "Showroom", "a new ring starts at Showroom");
const item = made.body.item;
const bulk = await api(page, "POST", "/api/inventory/bulk", { name: bulkName, unit: "pcs", openingQuantity: 10 });
ok(bulk.status === 201, "a bulk item is created with 10 pcs at Showroom");
const bulkId = bulk.body.item.id;

// ---- add a place from the Locations page ----
await page.goto(`${B}/#/inventory/locations`);
await page.waitForSelector("h1:has-text('Stock locations')");
ok(await seen(page.locator("td:has-text('Showroom')")), "the Locations page lists Showroom");
ok(await seen(page.locator("td:has-text('Karigar')")), "the Locations page lists the seeded Karigar place");
await page.fill('input[aria-label="Place name"]', placeName);
await page.click('button:has-text("Add place")');
ok(await seen(page.locator(`text=${placeName} is added.`)), "a new place is added from the form");
ok(await seen(page.locator(`td a:has-text("${placeName}")`)), "the new place is in the list");
const placeId = await page.locator(`td a:has-text("${placeName}")`).first().getAttribute("href");
const placeHash = placeId.split("/").pop();

// ---- move the item from its page ----
await page.goto(`${B}/#/inventory/items/${item.id}`);
await page.waitForSelector(`h1:has-text('${item.uNo}')`);
ok(await seen(page.locator("text=Showroom").first()), "the item page shows its place, Showroom");
await page.click('button:has-text("Transfer")');
await page.waitForSelector('form[aria-label="Transfer"]');
await page.selectOption('select[aria-label="To place"]', { label: placeName });
await page.click('form[aria-label="Transfer"] button:has-text("Make transfer")');
ok(await seen(page.locator(`text=Moved to ${placeName}.`)), "the item is moved, and the page says where to");
ok(await seen(page.locator(`section:has(h2:has-text("Location history")) td:has-text("${placeName}")`)), "the location history shows the move");
const itemNow = (await api(page, "GET", `/api/inventory/items/${item.id}`)).body.item;
ok(itemNow.locationName === placeName && itemNow.status === "in_stock", "the item is at the new place and still in stock");

// ---- the list and the stock-by-place page show it ----
await page.goto(`${B}/#/inventory`);
await page.waitForSelector('input[aria-label="Search U No."]');
await page.fill('input[aria-label="Search U No."]', item.uNo);
ok(await seen(page.locator(`tr:has-text("${item.uNo}") >> td:has-text("${placeName}")`)), "the list shows the place name for the item");
await page.goto(`${B}/#/inventory/locations/${placeHash}`);
await page.waitForSelector(`h1:has-text('${placeName}')`);
ok(await seen(page.locator(`tr:has-text("${item.uNo}")`)), "the stock-by-place page lists the item");

// ---- move a bulk quantity: 4 of the 10 to the new place ----
await page.goto(`${B}/#/inventory/bulk/${bulkId}`);
await page.waitForSelector(`h1:has-text('${bulkName}')`);
ok(await seen(page.locator(`[data-testid="bulk-at-Showroom"]:has-text("10")`)), "the bulk item has 10 at Showroom before the move");
await page.click('button:has-text("Transfer")');
await page.waitForSelector('form[aria-label="Transfer"]');
await page.selectOption('select[aria-label="To place"]', { label: placeName });
await page.fill('input[aria-label="Transfer quantity"]', "4");
await page.click('form[aria-label="Transfer"] button:has-text("Make transfer")');
ok(await seen(page.locator(`text=4 moved to ${placeName}.`)), "4 pcs are moved to the new place");
ok(await seen(page.locator(`[data-testid="bulk-at-Showroom"]:has-text("6")`)), "Showroom now has 6");
ok(await seen(page.locator(`[data-testid="bulk-at-${placeName}"]:has-text("4")`)), `${placeName} now has 4`);
ok(await seen(page.locator('[data-testid="bulk-quantity"]:has-text("10")')), "the total is still 10");
await page.goto(`${B}/#/inventory/locations/${placeHash}`);
await page.waitForSelector(`h1:has-text('${placeName}')`);
ok(await seen(page.locator(`tr:has-text("${bulkName}") >> td:has-text("4 pcs")`)), "the place page shows 4 pcs of the bulk item");
await page.screenshot({ path: `${S}/stock-location.png`, fullPage: true });
await page.close();

// ---- phone: read only ----
const phone = await openPage({ width: 390, height: 844 });
await phone.goto(`${B}/#/inventory/items/${item.id}`);
await phone.waitForSelector(`h1:has-text('${item.uNo}')`);
ok(await seen(phone.locator(`section:has(h2:has-text("Location history")) td:has-text("${placeName}")`)), "phone: the item's location history is visible");
ok(!(await phone.locator('button:has-text("Transfer")').first().isVisible()), "phone: the Transfer button is hidden");
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the item page does not scroll sideways");
await phone.goto(`${B}/#/inventory/locations`);
await phone.waitForSelector("h1:has-text('Stock locations')");
ok(await seen(phone.locator(`td a:has-text("${placeName}")`)), "phone: the places are listed");
ok(!(await phone.locator('form[aria-label="Add a place"]').isVisible()), "phone: the Add a place form is hidden");
ok(!(await phone.locator('button:has-text("Rename")').first().isVisible()), "phone: Rename is hidden");
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the places page does not scroll sideways");
await phone.goto(`${B}/#/inventory/locations/${placeHash}`);
await phone.waitForSelector(`h1:has-text('${placeName}')`);
ok(await seen(phone.locator(`tr:has-text("${item.uNo}")`)), "phone: the place page lists the item");
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the place page does not scroll sideways");
await phone.goto(`${B}/#/inventory/bulk/${bulkId}`);
await phone.waitForSelector(`h1:has-text('${bulkName}')`);
ok(!(await phone.locator('button:has-text("Transfer")').first().isVisible()), "phone: the bulk Transfer button is hidden");
ok(await seen(phone.locator(`[data-testid="bulk-at-${placeName}"]`)), "phone: the bulk page shows the balance at each place");
await phone.close();

ok(errors.length === 0, `no browser errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
