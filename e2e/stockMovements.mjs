// Spec 021: an invoice takes stock. Create an item (API), make an invoice that uses it, see it sold, see the
// second invoice refused on its line, void the invoice, see the item back in stock. A bulk line too. Phone: read only.
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
const types = (await api(page, "GET", "/api/inventory/types")).body.items;
const ringId = types.find((t) => t.name === "Ring").id;
const made = await api(page, "POST", "/api/inventory/items", { typeId: ringId, metal: "gold", purity: "22K916", grossWeightMg: 12_500, netWeightMg: 12_000, hsn: "7113", location: `Stock ${uniq}` });
ok(made.status === 201, "an item is created for the test");
const item = made.body.item;
const uNo = item.uNo;
const bulk = await api(page, "POST", "/api/inventory/bulk", { name: `Tilli ${uniq}`, unit: "pcs", openingQuantity: 10 });
ok(bulk.status === 201, "a bulk item (Tilli) is created with 10 pcs");
const bulkId = bulk.body.item.id;

// Fill the invoice form: a walk-in buyer, one line with a silver rate typed.
async function newInvoiceLine(description, rate = "285.72") {
  await page.goto(`${B}/#/invoices/new`);
  await page.waitForSelector("text=Customer name");
  await page.fill('label:has-text("Customer name") input', `Stock Buyer ${uniq}`);
  await page.fill('input[aria-label="Description line 1"]', description);
  await page.fill('input[aria-label="Net g line 1"]', "9.800");
  await page.fill('input[aria-label="Gold rate line 1"]', rate);
}

// ---- 1: an invoice takes the item ----
await newInvoiceLine("Ring for stock test");
await page.selectOption('select[aria-label="Stock line 1"]', "item");
await page.fill('input[aria-label="U No. line 1"]', uNo.toLowerCase());
await page.click('button:has-text("Save invoice")');
await page.waitForSelector("h1:has-text('INV-')");
const invoiceUrl = page.url();
const invoiceNo = (await page.locator("h1").innerText()).trim();
ok(/^INV-\d{4}$/.test(invoiceNo), `the invoice is saved (${invoiceNo})`);
ok(await seen(page.locator('section[aria-label="Stock on this invoice"]')), "the invoice page lists the stock it took");
ok(await seen(page.locator(`text=U No. ${uNo}`)), `the invoice page names ${uNo}`);

// ---- 2: the item is sold, with the history naming the invoice ----
await page.goto(`${B}/#/inventory/items/${item.id}`);
await page.waitForSelector(`h1:has-text('${uNo}')`);
ok(await seen(page.locator('div.font-medium:text-is("Sold")')), `${uNo} shows as Sold`);
ok(await seen(page.locator(`td:has-text("Sold on invoice ${invoiceNo}")`)), "the history says Sold on the invoice");

// ---- 3: a second invoice for the same item is refused on its line ----
await newInvoiceLine("Ring again");
await page.selectOption('select[aria-label="Stock line 1"]', "item");
await page.fill('input[aria-label="U No. line 1"]', uNo);
await page.click('button:has-text("Save invoice")');
ok(await seen(page.locator(`[role="alert"]:has-text("${uNo} is sold")`)), "the second invoice is refused with the item named on the line");
ok(await page.locator("h1:has-text('INV-')").count() === 0, "the refused invoice is not saved");

// ---- 4: void the first invoice, the item is back in stock ----
await page.goto(invoiceUrl);
await page.waitForSelector("h1:has-text('INV-')");
await page.click('button:has-text("Void")');
await page.fill('div[role="dialog"] input', "stock test");
await page.click('button:has-text("Void invoice")');
await page.waitForSelector("text=Voided: stock test");
ok(true, "the invoice is voided");
await page.goto(`${B}/#/inventory/items/${item.id}`);
await page.waitForSelector(`h1:has-text('${uNo}')`);
ok(await seen(page.locator('div.font-medium:text-is("In stock")')), `${uNo} is back in stock after the void`);
ok(await seen(page.locator(`td:has-text("Invoice ${invoiceNo} voided")`)), "the history says the invoice was voided");

// ---- 5: a bulk line takes 3 of the 10 Tilli ----
await newInvoiceLine("Tilli set");
await page.selectOption('select[aria-label="Stock line 1"]', "bulk");
await page.selectOption('select[aria-label="Bulk item line 1"]', bulkId);
await page.fill('input[aria-label="Quantity line 1"]', "3");
await page.click('button:has-text("Save invoice")');
await page.waitForSelector("h1:has-text('INV-')");
ok(await seen(page.locator(`text=Tilli ${uniq}`)), "the invoice page shows the bulk quantity taken");
const after = await api(page, "GET", `/api/inventory/bulk/${bulkId}`);
ok(after.body.item.quantity === 7, `Tilli is 7 pcs after the sale (${after.body.item.quantity})`);

// ---- phone: read only, no sideways scroll ----
const phone = await openPage({ width: 390, height: 844 });
await phone.goto(invoiceUrl);
await phone.waitForSelector("h1:has-text('INV-')");
ok(await seen(phone.locator('section[aria-label="Stock on this invoice"]')), "phone: the invoice page lists the stock");
ok(!(await phone.locator('button:has-text("Void")').first().isVisible()), "phone: Void stays hidden");
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the invoice page does not scroll sideways");
await phone.close();

await page.screenshot({ path: `${S}/shot-stock-invoice.png`, fullPage: true });
ok(errors.length === 0, `no browser errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
