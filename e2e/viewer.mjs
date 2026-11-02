// The viewer role (read-only, spec 004): the screens do not offer what the role cannot do.
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
const username = `viewer${uniq}`;
const TEMP = "viewer-temp-pass-1";
const NEW = "viewer-new-pass-22";

// The owner makes the viewer and one customer with an Aadhaar number to look at.
const ownerPage = await (await browser.newContext()).newPage();
await ownerPage.goto(B);
await ownerPage.fill('input[autocomplete="username"]', "owner");
await ownerPage.fill('input[type="password"]', PASSWORD);
await ownerPage.click('button:has-text("Log in")');
await ownerPage.waitForSelector("text=Today's rates");
const made = await ownerPage.evaluate(async ({ username, TEMP }) => {
  const post = (path, body) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const user = (await post("/api/users", { username, displayName: "Viewer Check", role: "viewer", temporaryPassword: TEMP })).status;
  const res = await post("/api/customers", { name: "Viewer Aadhaar " + username, aadhaar: "123412341234" });
  // The id comes from the create response: a list search can miss a customer when the list is long.
  return { user, cust: res.status, customerId: (await res.json()).customer?.id ?? null };
}, { username, TEMP });
ok(made.user === 201 && made.cust === 201 && made.customerId, "the owner makes a viewer and a customer with an Aadhaar number");

// The viewer signs in, sets a new password (the temporary one is one-time), and looks around.
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
await page.goto(B);
await page.fill('input[autocomplete="username"]', username);
await page.fill('input[type="password"]', TEMP);
await page.click('button:has-text("Log in")');
await page.waitForTimeout(1500);
const changed = await page.evaluate(async ({ TEMP, NEW }) => (await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: TEMP, newPassword: NEW }) })).status, { TEMP, NEW });
ok(changed === 200, "the viewer changes the temporary password");
await page.reload();
await page.waitForSelector("text=Today's rates", { timeout: 15000 });

// People: the owner's page is not shown to a viewer.
await page.goto(`${B}/#/users`);
await page.waitForSelector("text=You do not have access to People and roles.");
ok((await page.locator('button:has-text("New person")').count()) === 0, "viewer: People page shows no 'New person' button");

// Rates: the rates are visible but cannot be typed in.
await page.goto(`${B}/#/rates`);
await page.waitForSelector("h2:has-text('Rates for today')");
const rateInput = page.locator('input[aria-label^="Gold 24K995 rate"]').first();
ok(await rateInput.isDisabled(), "viewer: the rate input is disabled");
ok((await page.locator('button:has-text("Save today\'s rates")').count()) === 0, "viewer: no 'Save today's rates' button");

// Customer: no Aadhaar reveal for a viewer (the reveal needs customers.edit).
await page.goto(`${B}/#/customers/${made.customerId}`);
await page.waitForSelector("text=Aadhaar");
ok((await page.locator('button:has-text("Show")').count()) === 0, "viewer: the customer page offers no Aadhaar 'Show'");

// Settings: every field is disabled for a viewer.
await page.goto(`${B}/#/settings`);
await page.waitForSelector("h1:has-text('Settings')");
const enabledFields = await page.evaluate(() => [...document.querySelectorAll("main input, main textarea, main select")].filter((el) => el.getClientRects().length > 0 && !el.matches(":disabled")).length);
ok(enabledFields === 0, `viewer: no settings field is editable (${enabledFields} enabled)`);

ok(errors.length === 0, "no browser errors" + (errors.length ? `: ${errors.join(" | ")}` : ""));
await browser.close();
