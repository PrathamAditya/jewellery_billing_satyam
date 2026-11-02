// Spec 023: karigar job work through the screens. Buy raw gold through the API, add a karigar, open a job from the
// karigar page, record the finished pieces, close the job (the held metal is wastage within the allowance), pay the labour
// and see the balances at zero. A second karigar tries to pay more than is owed and is refused. Phone: read only.
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
const karigarName = `E2E Karigar ${uniq}`;
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
const showroomGold = async (page) =>
  ((await api(page, "GET", "/api/inventory/purchases/raw-stock")).body.items ?? []).find((r) => r.metal === "gold" && r.purity === "22K916" && r.locationName === "Showroom")?.weightMg ?? 0;

const page = await openPage({ width: 1280, height: 1000 });

// ---- raw gold to issue (spec 022), so the job has metal to take ----
const goldBefore = await showroomGold(page);
const seed = await api(page, "POST", "/api/inventory/purchases", {
  purchaseType: "raw_metal",
  purchaseDate: new Date().toISOString().slice(0, 10),
  supplierName: `E2E Bullion ${uniq}`,
  lines: [{ kind: "raw_metal", metal: "gold", purity: "22K916", weightMg: 500_000, amountPaise: null }],
});
ok(seed.status === 201, "raw 22K gold bought for the job (500.000 g at the Showroom)");

// ---- a new karigar from the list ----
await page.goto(`${B}/#/karigar`);
await page.waitForSelector("h1:has-text('Karigars')");
ok(await seen(page.locator('button:has-text("New karigar")')), "PC: the New karigar button is shown to the owner");
await page.click('button:has-text("New karigar")');
await page.fill('input[aria-label="Karigar name"]', karigarName);
await page.fill('input[aria-label="Karigar phone"]', "98000 00000");
await page.click('button:has-text("Save karigar")');
await page.waitForSelector("h1:has-text('" + karigarName + "')");
ok(await seen(page.locator(`text=${karigarName}`)), "the karigar page opens after saving");
const karigarId = page.url().split("/").pop();

// ---- open a job: 100.000 g of 22K gold, labour per gram at ₹150, the default 2.00% allowance ----
await page.click('button:has-text("New job")');
await page.waitForSelector("h1:has-text('New job')");
await page.waitForSelector(`select[aria-label="Karigar"] option[value="${karigarId}"]`, { state: "attached" });
ok((await page.inputValue('select[aria-label="Karigar"]')) === karigarId, "the new job form has the karigar chosen from the karigar page");
await page.fill('input[aria-label="Labour rate"]', "150");
await page.fill('input[aria-label="Line 1 weight"]', "100.000");
await page.click('button:has-text("Open job")');
await page.waitForSelector("h1:has-text('JOB-')");
const jobNo = (await page.locator("h1").first().textContent()).trim();
ok(/^JOB-\d{4}$/.test(jobNo), `the job is saved as ${jobNo}`);
ok(await seen(page.locator('td:has-text("100.000 g")')), "the job shows 100.000 g issued");
ok(await seen(page.locator('text=2.00%')), "the job shows the 2.00% wastage allowance");
ok((await showroomGold(page)) === goldBefore + 500_000 - 100_000, "the Showroom raw gold went down by the 100.000 g issued");

// ---- record the finished pieces: 98.000 g of 3 pieces, so 2.000 g is still held (the full allowance) ----
await page.fill('input[aria-label="Return line 1 weight"]', "98.000");
await page.fill('input[aria-label="Return line 1 pieces"]', "3");
await page.click('button:has-text("Record return")');
await page.waitForSelector("text=Finished pieces back: 3");
ok(await seen(page.locator('td:has-text("98.000 g")')), "the job shows 98.000 g back as finished pieces");
ok(await seen(page.locator('text=₹14,700.00')), "the labour on the job is ₹14,700.00 (98.000 g at ₹150 a gram)");

// ---- close: the 2.000 g still held is written off as wastage, which is within the allowance ----
await page.click('button:has-text("Close job")');
await page.click('button:has-text("Confirm close")');
await page.waitForSelector("text=This job is closed");
ok(await seen(page.locator('td:has-text("2.000 g")')), "the job closes with 2.000 g of wastage (within the allowance)");
ok(!(await seen(page.locator('button:has-text("Record return")'))), "a closed job shows no return form");

// ---- the karigar page: balances at zero, labour owed, then the payment ----
await page.goto(`${B}/#/karigar/${karigarId}`);
await page.waitForSelector(`h1:has-text('${karigarName}')`);
ok(await seen(page.locator('text=None with the karigar')), "the karigar has no metal left with him");
ok(await seen(page.locator('text=₹14,700.00 owed')), "the karigar is owed ₹14,700.00 of labour");
await page.fill('input[aria-label="Payment amount"]', "15000");
await page.click('button:has-text("Record payment")');
await page.waitForSelector('[role="alert"]:has-text("is owed to this karigar")', { timeout: 5000 }).catch(() => {});
ok(await seen(page.locator('[role="alert"]:has-text("is owed to this karigar")')), "paying more than is owed is refused and says how much is owed");
await page.fill('input[aria-label="Payment amount"]', "14700");
await page.selectOption('select[aria-label="Payment mode"]', "upi");
await page.fill('input[aria-label="Payment reference"]', `UPI-E2E-${uniq}`);
await page.click('button:has-text("Record payment")');
await page.waitForSelector("text=₹0.00 owed");
ok(await seen(page.locator('text=₹0.00 owed')), "after the payment the labour owed is ₹0.00");
ok(await seen(page.locator(`text=Paid to karigar`)), "the statement shows the payment");
ok(await seen(page.locator(`td:has-text("Wastage")`)), "the statement shows the wastage line");
await page.screenshot({ path: `${S}/karigar-page.png`, fullPage: true });

// ---- the list shows the karigar with nothing owed ----
await page.goto(`${B}/#/karigar`);
await page.waitForSelector("h1:has-text('Karigars')");
const row = page.locator(`tr:has-text("${karigarName}")`);
ok(await seen(row), "the list shows the karigar");
ok(await seen(row.locator('td:has-text("₹0.00")')), "the list shows ₹0.00 labour owed for him");

// ---- phone: read only, no sideways scroll ----
const phone = await openPage({ width: 390, height: 844 });
await phone.goto(`${B}/#/karigar/${karigarId}`);
await phone.waitForSelector(`h1:has-text('${karigarName}')`);
ok(!(await seen(phone.locator('button:has-text("New job")'))), "phone: the New job button is hidden");
ok(!(await seen(phone.locator('form[aria-label="Pay the karigar"]'))), "phone: the payment form is hidden");
const scrollsPhone = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
ok(!scrollsPhone, "phone: the karigar page does not scroll sideways");
await phone.goto(`${B}/#/karigar/jobs/${(await api(phone, "GET", `/api/karigar/karigars/${karigarId}`)).body.jobs[0].id}`);
await phone.waitForSelector("h1:has-text('JOB-')");
ok(!(await seen(phone.locator('form[aria-label="Record return"]'))), "phone: the return form is hidden on the job page");
ok(!(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "phone: the job page does not scroll sideways");

ok(errors.length === 0, "no browser errors on the karigar screens" + (errors.length ? `: ${errors.join(" | ")}` : ""));
await browser.close();
