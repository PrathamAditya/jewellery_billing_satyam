import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
const S = process.argv[2] ?? "e2e/screenshots";
const B = process.env.BASE_URL ?? "http://localhost:8799";
const PASSWORD = process.env.OWNER_PASSWORD ?? "throwaway-local-pass-1";
mkdirSync(S, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && !/401|409/.test(m.text()) && errors.push("console: " + m.text()));
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };
const uniq = Date.now().toString().slice(-6);

await page.goto(B);
await page.fill('input[autocomplete="username"]', "owner");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Log in")');
await page.waitForSelector("text=Customers");
ok(true, "logged in");

// create
await page.goto(B + "/#/customers/new");
await page.fill('label:has-text("Name") input', `  Ramesh   Kumar ${uniq} `);
await page.fill('label:has-text("Mobile") >> nth=0 >> input', "+91 98765-" + uniq.slice(0, 5));
await page.fill('label:has-text("PAN") input', uniq.slice(1).replace(/\d/g, (d) => "abcdefghij"[d]) + "1234f");
await page.fill('label:has-text("Aadhaar") input', "1234 5678 9012");
await page.fill('label:has-text("Address") textarea', "12 Mall Road");
await page.click('button:has-text("Save customer")');
await page.waitForSelector("h1:has-text('Ramesh Kumar')");
const url1 = page.url();
ok(/#\/customers\/[0-9a-f-]{36}$/.test(url1), "saved and opened the customer page");
ok(await page.locator("text=XXXX XXXX 9012").count() === 1, "Aadhaar shown masked");
await page.click('button:has-text("Show")');
await page.waitForSelector("text=1234 5678 9012");
ok(true, "Show reveals the full Aadhaar");
await page.click('button:has-text("Hide")');
ok(await page.locator("text=XXXX XXXX 9012").count() === 1, "Hide masks it again");
await page.screenshot({ path: `${S}/shot-customer.png` });

// validation messages
await page.goto(B + "/#/customers/new");
await page.fill('label:has-text("Name") input', "A");
await page.fill('label:has-text("Mobile") >> nth=0 >> input', "123");
await page.click('button:has-text("Save customer")');
ok(await page.locator("text=Name must be 2 to 100 characters").count() === 1, "inline name error");
ok(await page.locator("text=Mobile must be 10 digits").count() === 1, "inline mobile error");
await page.screenshot({ path: `${S}/shot-validation.png` });

// duplicate mobile prompt
await page.fill('label:has-text("Name") input', "Family Member " + uniq);
await page.fill('label:has-text("Mobile") >> nth=0 >> input', "98765 " + uniq.slice(0, 5));
await page.click('button:has-text("Save customer")');
await page.waitForSelector("text=already belongs to");
ok(true, "duplicate-mobile prompt shown");
await page.screenshot({ path: `${S}/shot-dup.png` });
await page.click('button:has-text("Save as new anyway")');
await page.waitForSelector(`h1:has-text('Family Member ${uniq}')`);
ok(true, "saved as new anyway");

// edit + history
await page.click('button:has-text("Edit")');
await page.waitForSelector("h1:has-text('Edit')");
await page.fill('label:has-text("City") input', "Amritsar");
await page.fill('label:has-text("Reason") input', "added city");
await page.click('button:has-text("Save changes")');
await page.waitForSelector("text=Amritsar");
await page.click('button:has-text("History")');
await page.waitForSelector("text=added city");
ok(await page.locator("text=(empty)").count() >= 1 && await page.locator("text=Amritsar").count() >= 1, "history shows the change");
await page.screenshot({ path: `${S}/shot-history.png` });
await page.click('button:has-text("Ledger")');
await page.waitForSelector("text=Owes");
ok(await page.locator("text=Advance held >> visible=true").count() >= 1, "ledger tab shows the customer's advance held");

// list + search
await page.goto(B + "/#/customers");
await page.fill('input[aria-label="Search customers"]', "kumar " + uniq);
await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1, null, { timeout: 5000 }).catch(() => {});
ok(await page.locator("tbody tr").count() === 1 && await page.locator(`a:has-text("Ramesh Kumar ${uniq}")`).count() === 1, "search by name finds exactly that customer");
await page.screenshot({ path: `${S}/shot-list.png` });

// void / restore
await page.click(`a:has-text("Family Member ${uniq}")`).catch(async () => {
  await page.fill('input[aria-label="Search customers"]', "family member " + uniq);
  await page.click(`a:has-text("Family Member ${uniq}")`);
});
await page.waitForSelector(`h1:has-text('Family Member ${uniq}')`);
await page.click('button:has-text("Void")');
await page.click('button:has-text("Void customer")');
ok(await page.locator("text=Please give a reason").count() === 1, "void needs a reason");
await page.fill('div[role="dialog"] input', "duplicate entry");
await page.click('button:has-text("Void customer")');
await page.waitForSelector("text=voided: duplicate entry");
ok(true, "voided");
await page.click('button:has-text("Restore")');
await page.waitForSelector('button:has-text("Edit")');
ok(true, "restored");

// picker
await page.goto(B + "/#/picker-demo");
await page.fill('input[aria-label="Find customer"]', "ramesh kumar " + uniq);
await page.waitForSelector('[role="option"]');
await page.click('[role="option"]');
await page.waitForSelector("text=Picked:");
ok(true, "picker: search and pick");
await page.fill('input[aria-label="Find customer"]', "zzz-nobody");
await page.waitForSelector("text=No customer found");
await page.click('button:has-text("Add new customer")');
await page.fill('div[role="dialog"] label:has-text("Name") input', "Picker Added " + uniq);
await page.click('div[role="dialog"] button:has-text("Save customer")');
await page.waitForSelector(`text=Picked: Picker Added ${uniq}`);
ok(true, "picker: add new customer returns it to the caller");
await page.screenshot({ path: `${S}/shot-picker.png` });

// phone: view-only
const phone = await browser.newContext({ viewport: { width: 390, height: 780 } });
const p2 = await phone.newPage();
await p2.goto(B);
await p2.fill('input[autocomplete="username"]', "owner");
await p2.fill('input[type="password"]', PASSWORD);
await p2.click('button:has-text("Log in")');
await p2.waitForSelector("text=Customers");
await p2.goto(B + "/#/customers");
await p2.waitForSelector("tbody tr");
ok(await p2.locator('button:has-text("New customer")').isVisible() === false, "phone: New customer hidden");
await p2.locator("tbody tr").first().click();
await p2.waitForSelector("h1");
ok(await p2.locator('button:has-text("Edit")').isVisible() === false, "phone: Edit hidden");
ok(await p2.locator('button:has-text("Void")').isVisible() === false, "phone: Void hidden");
const overflow = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
ok(!overflow, "phone: no horizontal scroll on customer page");
await p2.screenshot({ path: `${S}/shot-phone.png` });
await p2.goto(B + "/#/customers");
await p2.waitForSelector("tbody tr");
ok(!(await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "phone: no horizontal scroll on list");
await p2.screenshot({ path: `${S}/shot-phone-list.png` });

ok(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
