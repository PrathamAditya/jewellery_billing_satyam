// Spec 025: monthly stock reconciliation through the screens. A fresh place with one ring and one bulk item is set up
// (API), a count is opened (API), the lines the test does not look at are counted as the system has them (API), then
// the screen counts the ring as not found, the bulk item at 6 against 8, saves, shows the live difference, and closes
// with the confirmation that states two adjustments. Phone: read only, no sideways scroll.
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
const placeName = `Count place ${uniq}`;
const bulkName = `Tilli count ${uniq}`;
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

const page = await openPage({ width: 1280, height: 1000 });

// ---- set up a fresh place, a ring that will not be found, a ring that will be found, and a bulk item ----
const place = (await api(page, "POST", "/api/inventory/locations", { name: placeName })).body.location;
ok(!!place?.id, "a fresh place is added for the count");
const types = (await api(page, "GET", "/api/inventory/types")).body.items;
const ringId = types.find((t) => t.name === "Ring").id;
const ring = (await api(page, "POST", "/api/inventory/items", { typeId: ringId, metal: "gold", purity: "22K916", grossWeightMg: 12_500, netWeightMg: 12_000, hsn: "7113", locationId: place.id })).body.item;
const gone = (await api(page, "POST", "/api/inventory/items", { typeId: ringId, metal: "gold", purity: "22K916", grossWeightMg: 9_000, netWeightMg: 8_500, hsn: "7113", locationId: place.id })).body.item;
const bulk = (await api(page, "POST", "/api/inventory/bulk", { name: bulkName, unit: "pcs", openingQuantity: 8, locationId: place.id })).body.item;
ok(!!ring?.id && !!gone?.id && !!bulk?.id, "two rings and a bulk item (8 pcs) are at the fresh place");

// ---- open the count (API) and count the other lines as the system has them ----
const opened = await api(page, "POST", "/api/inventory/reconciliations", { id: crypto.randomUUID(), month: "2041-03", locationId: place.id });
ok(opened.status === 201, "the count for the fresh place is opened");
const recId = opened.body.reconciliation.id;
const lineOfRing = opened.body.lines.find((l) => l.inventoryItemId === ring.id);
const lineOfGone = opened.body.lines.find((l) => l.inventoryItemId === gone.id);
const lineOfBulk = opened.body.lines.find((l) => l.bulkItemId === bulk.id);
const others = opened.body.lines
  .filter((l) => ![lineOfRing.id, lineOfGone.id, lineOfBulk.id].includes(l.id))
  .map((l) => ({ id: l.id, counted: l.lineKind === "item" ? "found" : l.systemAtOpening, note: null }));
if (others.length) ok((await api(page, "PUT", `/api/inventory/reconciliations/${recId}/counts`, { lines: others })).status === 200, "the other lines are counted as the system has them");

// ---- PC: the screen ----
await page.goto(`${B}/#/inventory/reconciliations/${recId}`);
await page.waitForSelector(`h1:has-text('Stock count 2041-03 at ${placeName}')`);
ok(await seen(page.locator(`tr:has-text("${ring.uNo}")`)), "the count page lists the ring");
await page.selectOption(`select[aria-label="Count of ${ring.uNo} Ring"]`, "found");
await page.selectOption(`select[aria-label="Count of ${gone.uNo} Ring"]`, "not_found");
await page.fill(`input[aria-label="Count of ${bulkName} (pcs)"]`, "6");
ok(await seen(page.locator(`tr:has-text("${bulkName}") >> td:has-text("-2")`)), "the difference shows -2 live before saving");
await page.click('button:has-text("Save counts")');
await page.waitForSelector("text=Counts saved.");
ok(await seen(page.locator(`tr:has-text("${gone.uNo}") >> td:has-text("-1")`)), "the ring not found shows -1 after saving");
await page.screenshot({ path: `${S}/reconciliation-count.png`, fullPage: true });

await page.click('button:has-text("Close count")');
ok(await seen(page.locator('text=writes 2 adjustments')), "the confirmation says the close writes 2 adjustments");
await page.click('button:has-text("Confirm close")');
await page.waitForSelector("text=The count is closed");
ok(await seen(page.locator('text=it cannot be changed')), "the closed count says it cannot be changed");
ok(!(await page.locator('button:has-text("Confirm close")').first().isVisible().catch(() => false)), "the close button is gone after closing");

// the adjustments are in the stock
const bulkNow = (await api(page, "GET", `/api/inventory/bulk/${bulk.id}`)).body.byLocation.find((b) => b.locationId === place.id);
ok(bulkNow?.quantity === 6, "the bulk item at the place is 6 after the close");
const goneNow = (await api(page, "GET", `/api/inventory/items/${gone.id}`)).body.item;
ok(goneNow.locationName === "Missing" && goneNow.status === "in_stock", "the piece not found is at Missing and still in stock");
await page.goto(`${B}/#/inventory/reconciliations`);
await page.waitForSelector("h1:has-text('Stock count')");
ok(await seen(page.locator(`tr:has-text("${placeName}") >> td:has-text("Closed")`)), "the list shows the count as closed");
await page.goto(`${B}/#/inventory`);
await page.waitForSelector("h1:has-text('Inventory')");
ok(await seen(page.locator('a:has-text("Stock count")')), "the inventory page links to the stock count");
await page.goto(`${B}/#/inventory/reconciliations`);
await page.waitForSelector("h1:has-text('Stock count')");
ok((await page.locator('form[aria-label="Open a count"]').isVisible()) === true, "PC: the open form is shown");

// a second open count, still open, for the phone check
const again = await api(page, "POST", "/api/inventory/reconciliations", { id: crypto.randomUUID(), month: "2041-04", locationId: place.id });
ok(again.status === 201, "a second count for the same place (another month) opens");
const againId = again.body.reconciliation.id;

// ---- phone: read only ----
const phone = await openPage({ width: 390, height: 844 });
await phone.goto(`${B}/#/inventory/reconciliations`);
await phone.waitForSelector("h1:has-text('Stock count')");
ok(!(await phone.locator('form[aria-label="Open a count"]').isVisible()), "phone: the open form is hidden");
ok(await seen(phone.locator(`tr:has-text("2041-04")`)), "phone: the list shows the open count");
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the list does not scroll sideways");
await phone.goto(`${B}/#/inventory/reconciliations/${againId}`);
await phone.waitForSelector(`h1:has-text('Stock count 2041-04')`);
ok(!(await phone.locator('button:has-text("Save counts")').first().isVisible()), "phone: Save counts is hidden");
ok(!(await phone.locator('button:has-text("Close count")').first().isVisible()), "phone: Close count is hidden");
ok(!(await phone.locator('select[aria-label^="Count of"]').first().isVisible()), "phone: the count selects are hidden");
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the count page does not scroll sideways");
await phone.close();

ok(errors.length === 0, `no browser errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
