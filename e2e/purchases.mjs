// Spec 022: purchases through the screens. Record a finished purchase with one ring line and see its U No.; record a
// raw silver purchase and see it in the raw stock; void the raw purchase and see the stock go back. Phone: read only.
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
const supplier = `E2E Wholesaler ${uniq}`;
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
const silverLocker = async (page) =>
  ((await api(page, "GET", "/api/inventory/purchases/raw-stock")).body.items ?? []).find((r) => r.metal === "silver" && r.purity === "silver" && r.locationName === "Locker")?.weightMg ?? 0;
const grams3 = (mg) => `${Math.floor(mg / 1000)}.${String(mg % 1000).padStart(3, "0")}`;

const page = await openPage({ width: 1280, height: 1000 });
const types = (await api(page, "GET", "/api/inventory/types")).body.items;
const ringId = types.find((t) => t.name === "Ring").id;

// ---- the list shows the raw stock section ----
await page.goto(`${B}/#/inventory/purchases`);
await page.waitForSelector("h1:has-text('Purchases')");
ok(await seen(page.locator('section[aria-label="Raw stock"] h2:has-text("Raw stock")')), "the purchases list shows the Raw stock section");
ok(await seen(page.locator('button:has-text("New purchase")')), "PC: the New purchase button is shown to the owner");

// ---- a finished purchase with one ring line ----
await page.click('button:has-text("New purchase")');
await page.waitForSelector("h1:has-text('New purchase')");
await page.click('button[aria-pressed]:has-text("Finished jewellery")');
await page.fill('input[aria-label="Supplier"]', supplier);
await page.fill('input[aria-label="Supplier bill number"]', `BILL-${uniq}`);
await page.selectOption('select[aria-label="Line 1 item type"]', ringId);
await page.fill('input[aria-label="Line 1 gross weight"]', "12.500");
await page.fill('input[aria-label="Line 1 net weight"]', "12.000");
await page.fill('input[aria-label="Line 1 amount"]', "15000");
await page.click('button:has-text("Save purchase")');
await page.waitForSelector("h1:has-text('PUR-')");
const finishedNo = (await page.locator("h1").first().textContent()).trim();
ok(/^PUR-\d{4}$/.test(finishedNo), `the finished purchase is saved as ${finishedNo}`);
ok(await seen(page.locator(`text=${supplier}`)), "the purchase page shows the supplier");
const uNoLink = page.locator('a[href^="#/inventory/items/"]').first();
const uNo = (await uNoLink.textContent()).trim();
ok(/^RING\d{2}$/.test(uNo), `the purchase page shows the created U No. ${uNo}`);
ok(await seen(page.locator('td:has-text("In stock")')), "the new item is In stock");
await uNoLink.click();
await page.waitForSelector(`h1:has-text('${uNo}')`);
ok(await seen(page.locator(`td:has-text("Purchased on ${finishedNo}")`)), "the item history says Purchased on the purchase number");
const finishedId = (await api(page, "GET", `/api/inventory/purchases?q=${encodeURIComponent(supplier)}`)).body.items.find((i) => i.purchaseNo === finishedNo).id;

// ---- a raw silver purchase, then the raw stock ----
const before = await silverLocker(page);
await page.goto(`${B}/#/inventory/purchases/new`);
await page.waitForSelector("h1:has-text('New purchase')");
await page.click('button[aria-pressed]:has-text("Raw gold or silver")');
await page.fill('input[aria-label="Supplier"]', `${supplier} bullion`);
await page.selectOption('select[aria-label="Place"]', { label: "Locker" });
await page.selectOption('select[aria-label="Line 1 metal"]', "silver");
await page.fill('input[aria-label="Line 1 weight"]', "250.000");
await page.click('button:has-text("Save purchase")');
await page.waitForSelector("h1:has-text('PUR-')");
const rawNo = (await page.locator("h1").first().textContent()).trim();
const rawId = (await api(page, "GET", `/api/inventory/purchases?q=${encodeURIComponent(supplier + " bullion")}`)).body.items.find((i) => i.purchaseNo === rawNo).id;
ok(/^PUR-\d{4}$/.test(rawNo), `the raw silver purchase is saved as ${rawNo}`);
ok(await seen(page.locator('td:has-text("250.000 g")')), "the purchase page shows 250.000 g of silver received");
ok((await silverLocker(page)) === before + 250_000, "the raw stock at Locker goes up by 250 g");
await page.goto(`${B}/#/inventory/purchases`);
await page.waitForSelector('section[aria-label="Raw stock"] h2');
ok(await seen(page.locator(`section[aria-label="Raw stock"] tr:has-text("Locker") >> td:has-text("${grams3(before + 250_000)}")`)), "the raw stock list shows the new silver total at Locker");

// ---- void the raw purchase: the stock goes back ----
await page.goto(`${B}/#/inventory/purchases/${rawId}`);
await page.waitForSelector(`h1:has-text('${rawNo}')`);
await page.click('button:has-text("Void purchase")');
await page.waitForSelector('[role="dialog"]');
await page.fill('input[aria-label="Void reason"]', "E2E test void");
await page.click('[role="dialog"] button:has-text("Void purchase")');
ok(await seen(page.locator('span:has-text("Void")').first()), "the raw purchase shows the VOID stamp");
ok(await seen(page.locator('text=E2E test void')), "the void reason is shown");
ok((await silverLocker(page)) === before, "the raw stock at Locker is back to where it was");
ok((await page.locator('button:has-text("Void purchase")').count()) === 0, "a voided purchase has no void button");

// ---- phone: read only ----
const phone = await openPage({ width: 390, height: 844 });
await phone.goto(`${B}/#/inventory/purchases`);
await phone.waitForSelector("h1:has-text('Purchases')");
ok(await seen(phone.locator(`tr:has-text("${finishedNo}")`)), "phone: the purchases list shows the finished purchase");
ok(!(await phone.locator('button:has-text("New purchase")').first().isVisible()), "phone: the New purchase button is hidden");
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the list does not scroll sideways");
await phone.goto(`${B}/#/inventory/purchases/${finishedId}`);
await phone.waitForSelector(`h1:has-text('${finishedNo}')`);
ok(await seen(phone.locator(`a[href^="#/inventory/items/"]:has-text("${uNo}")`)), "phone: the purchase page shows the U No.");
ok(!(await phone.locator('button:has-text("Void purchase")').first().isVisible()), "phone: the Void purchase button is hidden");
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the purchase page does not scroll sideways");
await phone.goto(`${B}/#/inventory/purchases/new`);
await phone.waitForSelector("h1:has-text('New purchase')");
ok(!(await phone.locator('form[aria-label="New purchase"]').isVisible()), "phone: the New purchase form is hidden");
await phone.close();

ok(errors.length === 0, `no browser errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await page.screenshot({ path: `${S}/purchases.png`, fullPage: true });
await browser.close();
