import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const S = process.argv[2] ?? "e2e/screenshots";
const B = process.env.BASE_URL ?? "http://localhost:8799";
const PASSWORD = process.env.OWNER_PASSWORD ?? "throwaway-local-pass-1";
mkdirSync(S, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };
const errors = [];

async function login(context, username, password) {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(B);
  await page.fill('input[autocomplete="username"]', username);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Log in")');
  return page;
}

const uniq = Date.now().toString().slice(-6);
const username = `staff${uniq}`;
const temp = `temp-pass-${uniq}`;
const mine = `my-own-pass-${uniq}`;

// Owner adds a person with a temporary password
const ownerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const owner = await login(ownerCtx, "owner", PASSWORD);
await owner.waitForSelector("text=Today's rates");
await owner.goto(B + "/#/users");
await owner.waitForSelector("h1:has-text('People and roles')");
await owner.click('button:has-text("New person")');
await owner.fill('div[role="dialog"] label:has-text("Name") input', `Test Staff ${uniq}`);
await owner.fill('div[role="dialog"] label:has-text("Username") input', username);
await owner.selectOption('div[role="dialog"] select', "staff");
await owner.fill('div[role="dialog"] label:has-text("Temporary password") input', temp);
await owner.click('div[role="dialog"] button:has-text("Add person")');
await owner.locator("text=Person added. >> visible=true").first().waitFor({ timeout: 10000 });
ok(true, "owner adds a staff person with a temporary password");
ok(await owner.locator(`tr:has-text("${username}") >> text=Must change password`).count() >= 1, "the new person shows 'Must change password'");

// Owner can see the activity of a person
await owner.click(`tr:has-text("${username}") button:has-text("Activity")`);
await owner.locator('div[role="dialog"] h2:has-text("Activity")').waitFor();
ok(true, "owner opens the activity of a person");
await owner.click('div[role="dialog"] button:has-text("Close")').catch(() => owner.keyboard.press("Escape"));

// The new person logs in and is asked to choose a password first
const staffCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const staff = await login(staffCtx, username, temp);
await staff.waitForSelector("text=Choose your own password");
ok(true, "first login with the temporary password asks for a new password");
await staff.fill('label:has-text("Temporary password") input', temp);
await staff.fill('label:has-text("New password") input', mine);
await staff.fill('label:has-text("Repeat the new password") input', mine);
await staff.click('button:has-text("Save and continue")');
await staff.waitForSelector("text=Jewellery Billing");
ok(true, "after choosing a password the person reaches the app");

// Staff permissions in the menu and on screens
ok(await staff.locator('a:has-text("People") >> visible=true').count() === 0, "staff does not see the People link");
ok(await staff.locator('a:has-text("Settings") >> visible=true').count() === 1, "staff can see Settings (read only)");
await staff.goto(B + "/#/rates");
await staff.waitForSelector("h1:has-text('Rates')");
ok(await staff.locator('button:has-text("Save today\'s rates") >> visible=true').count() === 0, "staff cannot save rates");
await staff.goto(B + "/#/invoices");
await staff.waitForSelector("h1:has-text('Invoices')");
ok(await staff.locator('button:has-text("New invoice") >> visible=true').count() === 1, "staff can start a new invoice");
await staff.goto(B + "/#/settings");
await staff.waitForSelector("text=Only the owner can change them");
ok(await staff.locator('fieldset[disabled]').count() === 1, "staff sees settings but every field is disabled");

// Phone: the People page does not scroll the whole page sideways
const phone = await browser.newContext({ viewport: { width: 390, height: 800 } });
const p2 = await login(phone, "owner", PASSWORD);
await p2.waitForSelector("text=Today's rates");
await p2.goto(B + "/#/users");
await p2.waitForSelector("h1:has-text('People and roles')");
ok(!(await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "phone: People page has no sideways page scroll");
await p2.screenshot({ path: `${S}/shot-users-phone.png` });
await owner.screenshot({ path: `${S}/shot-users.png` });

ok(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
