// Spec 032: daily cash closing through the screens. Cash in today, count the drawer, close the day, add a correction note.
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
const rupees = (paise) => (paise / 100).toFixed(2);

await page.goto(B);
await page.fill('input[autocomplete="username"]', "owner");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Log in")');
await page.waitForSelector("text=Today's rates");

const api = (method, path, body) =>
  page.evaluate(
    async ({ method, path, body }) => {
      const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    },
    { method, path, body },
  );

// Today's cash: a cash advance of ₹1,000.00 and a UPI payment of ₹500.00 (the UPI one must not count).
const cust = await api("POST", "/api/customers", { name: `Cash Closing ${uniq}` });
const customerId = cust.body.customer.id;
const cash = await api("POST", "/api/payments", { date: today, mode: "cash", customerId, purpose: "advance", amountPaise: 100_000 });
ok(cash.status === 201, "a cash advance of ₹1,000.00 is recorded for today");
const upi = await api("POST", "/api/payments", { date: today, mode: "upi", reference: `UPI-${uniq}`, customerId, purpose: "advance", amountPaise: 50_000 });
ok(upi.status === 201, "a UPI payment of ₹500.00 is recorded for today");

await page.click('a:has-text("Cash closing") >> visible=true');
await page.waitForSelector("h1:has-text('Cash closing')");
await page.waitForSelector(`text=Cash Closing ${uniq} >> visible=true`);
ok(true, "the day's cash lists the cash advance by name");
const day = (await api("GET", `/api/cash-closing?date=${today}`)).body;
// The UPI payment belongs to the same customer, so one row with that name means only the cash one is listed.
ok((await page.locator("tbody tr", { hasText: `Cash Closing ${uniq}` }).count()) === 1, "the UPI payment of the same customer is not in the cash list");
ok((await page.locator("tbody tr >> visible=true").count()) >= day.movements.length, "every cash movement of the day is listed");
await page.screenshot({ path: `${S}/shot-cash-day.png` });

if (day.closing) {
  // A run earlier against this database already closed today: check the closed view instead.
  ok(await page.locator("text=closed >> visible=true").first().isVisible(), "today is already closed, and the screen says so");
} else {
  // The first closing types the opening cash. Count ₹1,000.00 less than expected, so a reason is needed.
  await page.fill('label:has-text("Cash in the drawer at the start of the day") input', "0");
  await page.fill('label:has-text("Cash counted in the drawer") input', rupees(day.totals.netPaise - 100_000));
  await page.waitForSelector("text=Short: >> visible=true");
  ok(true, "the difference shows live as short");
  ok(await page.locator('label:has-text("Reason for the difference") input').isVisible(), "a reason box appears when the count differs");
  ok(await page.locator('button:has-text("Close the day")').isDisabled() === false, "the close button is ready once the reason is known");
  await page.click('button:has-text("Close the day")');
  await page.waitForSelector(`text=is closed. >> visible=true`).catch(() => {});
  ok((await page.locator("text=is closed. >> visible=true").count()) === 0, "without a reason the day is not closed");
  await page.fill('label:has-text("Reason for the difference") input', `Short by ₹1,000 ${uniq}`);
  await page.click('button:has-text("Close the day")');
  await page.waitForSelector("text=is closed. >> visible=true");
  ok(true, "the day closes with the reason");
  await page.screenshot({ path: `${S}/shot-cash-closed.png` });
}

// A closed day cannot be closed again, and a correction is added as a note.
ok((await api("POST", "/api/cash-closing", { date: today, countedPaise: 1, reason: "again" })).status === 409, "a second close of the same day is refused");
ok((await page.locator('button:has-text("Close the day") >> visible=true').count()) === 0, "a closed day offers no close button");
await page.fill('input[aria-label="Correction note"]', `Counted again ${uniq}`);
await page.click('button:has-text("Add note")');
await page.waitForSelector(`text=Counted again ${uniq} >> visible=true`);
ok(true, "a correction note is added to the closed day");

// Phone: the day and history are read, the close form and note box are not offered.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${B}/#/cash-closing`);
await page.waitForSelector("h1:has-text('Cash closing')");
ok(!(await page.locator('button:has-text("Close the day") >> visible=true').first().isVisible().catch(() => false)), "phone: the close button is not visible");
ok(!(await page.locator('button:has-text("Add note") >> visible=true').first().isVisible().catch(() => false)), "phone: the note box is not visible");
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "phone: the cash closing page does not scroll sideways");

ok(errors.length === 0, "no browser errors" + (errors.length ? `: ${errors.join(" | ")}` : ""));
await browser.close();
