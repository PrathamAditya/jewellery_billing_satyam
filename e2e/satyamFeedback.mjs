// The showroom's second feedback list (points 1 to 15): each one is exercised in a real browser against the local Worker.
// 1 22K from 24K, 2 old gold receipts, 3 several payment modes, 4 HSN, 5 copy from line 1, 6 bigger text boxes, 7 labour with GST,
// 8 many items on a bill, 9 another customer's advance, 10 A5 receipts, 11 reverse calculation, 12 more old gold lines,
// 13 back to the settlement page, 14 outstanding shown, 15 previous advance shown.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const S = process.argv[2] ?? "e2e/screenshots";
const B = process.env.BASE_URL ?? "http://localhost:8799";
const PASSWORD = process.env.OWNER_PASSWORD ?? "throwaway-local-pass-1";
mkdirSync(S, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && !/40[0-9]|409/.test(m.text()) && errors.push("console: " + m.text()));
const ok = (cond, msg) => {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) process.exitCode = 1;
};
const uniq = Date.now().toString().slice(-6);
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const flat = (t) => t.replace(/\s+/g, " ");

const pagesOf = (file) => Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file]).toString())[1]);
const isA4Portrait = (file) => {
  const [, w, h] = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(execFileSync("pdfinfo", [file]).toString());
  return Math.abs(Number(w) - 595) < 1 && Math.abs(Number(h) - 842) < 1;
};
const textOf = (file) => execFileSync("pdftotext", [file, "-"]).toString().replace(/\s+/g, " ");
async function saveAsPdf(name) {
  await page.waitForLoadState("networkidle");
  const file = `${S}/${name}.pdf`;
  await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  return file;
}
async function openPrint(route, marker) {
  await page.goto(`${B}/#/`);
  await page.waitForSelector("text=Today's rates");
  await page.goto(`${B}/#${route}`);
  await page.waitForFunction((m) => document.querySelector(".print-stage")?.innerText.includes(m), marker, { timeout: 15000 });
}
const api = (method, path, body) =>
  page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    },
    { method, path, body },
  );
const line = (netMg, goldPaisePerKg, description = "Gold Chain") => ({ description, purity: "silver", hsn: "7113", grossWeightMg: netMg, netWeightMg: netMg, polishBps: 0, goldRatePaisePerKg: goldPaisePerKg, labourRatePaisePerKg: 0 });
async function newCustomer(name) {
  const c = await api("POST", "/api/customers", { name });
  if (c.status !== 201) throw new Error("customer not saved: " + JSON.stringify(c.body));
  return c.body.customer.id;
}
async function newInvoice(customerId, customerName, lines) {
  const i = await api("POST", "/api/invoices", { invoiceDate: today, customerId, customerName, taxMode: "intra", remarks: null, lines });
  if (i.status !== 201) throw new Error("invoice not saved: " + JSON.stringify(i.body).slice(0, 300));
  return i.body;
}
async function pickCustomer(name) {
  await page.fill('input[aria-label="Find customer"]', name);
  await page.locator(`[role="option"]:has-text("${name}")`).first().click();
}

await page.goto(B);
await page.fill('input[autocomplete="username"]', "owner");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Log in")');
await page.waitForSelector("text=Today's rates");

// ---------------------------------------------------------------- 1. the 22K rate from the 24K rate
{
  const before = await api("GET", "/api/rates/applicable");
  const prev24 = before.body.rates?.gold_24k995?.pricePaisePerKg;
  // Stay within 10% of any rate already saved today, so the typing-mistake guard does not ask first.
  const typedPerGram = prev24 ? Math.round(prev24 / 100_000) + 1 : 7500;
  await page.goto(`${B}/#/rates`);
  await page.waitForSelector("h1:has-text('Rates')");
  await page.fill('input[aria-label="Gold 22K916 rate per gram"]', "");
  await page.fill('input[aria-label="Gold 24K995 rate per gram"]', String(typedPerGram));
  const filled = await page.locator('input[aria-label="Gold 22K916 rate per gram"]').inputValue();
  const expected22 = (() => {
    const p24 = BigInt(typedPerGram) * 100_000n; // paise per kg
    const units = (p24 * 916n + 49_750n) / 99_500n;
    return Number(units) * 100;
  })();
  const asGram = (paisePerKg) => {
    const milli = paisePerKg / 100;
    const frac = String(milli % 1000).padStart(3, "0").replace(/0+$/, "");
    return frac ? `${Math.floor(milli / 1000)}.${frac}` : String(Math.floor(milli / 1000));
  };
  ok(filled === asGram(expected22), `typing the 24K rate (${typedPerGram} per gram) fills the 22K rate by itself: ${filled} (expected ${asGram(expected22)})`);
  ok(await page.locator("text=Worked out from the 24K rate").isVisible(), "the page says where the 22K figure came from");
  await page.screenshot({ path: `${S}/shot-rates-auto22.png` });
  // The owner can still type her or his own 22K rate: the automatic fill stops.
  await page.fill('input[aria-label="Gold 22K916 rate per gram"]', "6,000");
  await page.fill('input[aria-label="Gold 24K995 rate per gram"]', String(typedPerGram + 1));
  ok((await page.locator('input[aria-label="Gold 22K916 rate per gram"]').inputValue()) === "6,000", "a 22K rate typed by hand is not overwritten when the 24K rate changes");
  // Back to automatic, save both, and check what was stored.
  await page.fill('input[aria-label="Gold 22K916 rate per gram"]', "");
  await page.fill('input[aria-label="Gold 24K995 rate per gram"]', String(typedPerGram));
  await page.click("button:has-text(\"Save today's rates\")");
  for (let i = 0; i < 4; i++) {
    const yes = page.locator('button:has-text("Yes, save it")').first();
    if (await yes.isVisible().catch(() => false)) await yes.click();
    else await page.waitForTimeout(500);
  }
  await page.waitForTimeout(800);
  const after = await api("GET", "/api/rates/applicable");
  ok(after.body.rates.gold_24k995.pricePaisePerKg === typedPerGram * 100_000, "the 24K rate is saved as typed");
  ok(after.body.rates.gold_22k916.pricePaisePerKg === expected22 && !after.body.rates.gold_22k916.carriedForward, "the 22K rate is saved too, worked out as 24K x 916 / 995, for today");
}

// ---------------------------------------------------------------- 4, 5, 6, 7: the lines of a bill
{
  await page.goto(`${B}/#/invoices/new`);
  await page.waitForSelector("h1:has-text('New invoice')");
  const desc = page.locator('[aria-label="Description line 1"]');
  ok((await desc.evaluate((el) => el.tagName)) === "TEXTAREA", "6: the description is a roomy multi-line box");
  const box = await desc.boundingBox();
  ok(box.width >= 240 && box.height >= 60, `6: the description box is big enough to read (${Math.round(box.width)} x ${Math.round(box.height)} px)`);
  await desc.fill("Gold Chain 22K\nwith pendant and stone");
  ok((await desc.inputValue()).includes("\n"), "6: a description can run to more than one line");
  const addr = page.locator('label:has-text("Address") textarea');
  ok((await addr.count()) === 1, "6: the customer address is a bigger box too");

  // 4: the bill type sets the HSN of every line.
  await page.selectOption('select[aria-label="Purity line 1"]', "22K916");
  ok((await page.locator('select[aria-label="HSN line 1"]').inputValue()) === "7113", "4: a new bill starts as a jewellery sale, HSN 7113");
  await page.click('button[aria-pressed]:has-text("Job work")');
  ok((await page.locator('select[aria-label="HSN line 1"]').inputValue()) === "9988" && (await page.locator('output[aria-label="GST line 1"]').innerText()) === "5%", "4: choosing Job work sets HSN 9988 and 5% GST");
  await page.click('button[aria-pressed]:has-text("Jewellery sale")');
  ok((await page.locator('select[aria-label="HSN line 1"]').inputValue()) === "7113" && (await page.locator('output[aria-label="GST line 1"]').innerText()) === "3%", "4: and Jewellery sale puts HSN 7113 and 3% back");

  // 5: copy rate, labour and polish from line 1, while every line stays editable.
  await page.fill('input[aria-label="Net g line 1"]', "9.800");
  await page.fill('input[aria-label="Gold rate line 1"]', "285.72");
  await page.fill('input[aria-label="Labour rate line 1"]', "20");
  await page.fill('input[aria-label="Polish % line 1"]', "2");
  ok((await page.locator('button:has-text("Copy rate, labour and polish from line 1")').count()) === 0, "5: with one line there is nothing to copy to");
  await page.click('button:has-text("Add line")');
  await page.fill('[aria-label="Description line 2"]', "Gold ring");
  await page.fill('input[aria-label="Net g line 2"]', "5.000");
  await page.click('button:has-text("Add line")');
  await page.fill('input[aria-label="Net g line 3"]', "3.000");
  await page.click('button:has-text("Copy rate, labour and polish from line 1")');
  const copied = async (n) => [await page.locator(`input[aria-label="Gold rate line ${n}"]`).inputValue(), await page.locator(`input[aria-label="Labour rate line ${n}"]`).inputValue(), await page.locator(`input[aria-label="Polish % line ${n}"]`).inputValue()];
  ok(JSON.stringify(await copied(2)) === JSON.stringify(["285.72", "20", "2"]) && JSON.stringify(await copied(3)) === JSON.stringify(["285.72", "20", "2"]), "5: one click copies the rate, labour and polish of line 1 to the other lines");
  ok((await page.locator('input[aria-label="Net g line 2"]').inputValue()) === "5.000" && (await page.locator('[aria-label="Description line 2"]').inputValue()) === "Gold ring", "5: weights and descriptions are not touched by the copy");
  await page.fill('input[aria-label="Gold rate line 3"]', "290");
  ok((await page.locator('input[aria-label="Gold rate line 3"]').inputValue()) === "290" && (await page.locator('input[aria-label="Gold rate line 2"]').inputValue()) === "285.72", "5: a line can still have its own rate afterwards");
  await page.fill('input[aria-label="Labour rate line 3"]', "35");
  await page.click('button[aria-label="Copy rate, labour and polish from line 1 to line 3"]');
  ok((await page.locator('input[aria-label="Gold rate line 3"]').inputValue()) === "285.72" && (await page.locator('input[aria-label="Labour rate line 3"]').inputValue()) === "20", "5: 'Same as line 1' copies to just that one line");
  await page.screenshot({ path: `${S}/shot-lines-copy.png` });

  // 7: a labour rate typed with GST included is worked out without it.
  const totals = async () => flat(await page.locator('[aria-label="Totals"]').innerText());
  await page.click('button[aria-label="Remove line 3"]');
  await page.click('button[aria-label="Remove line 2"]');
  await page.fill('input[aria-label="Polish % line 1"]', "");
  await page.fill('input[aria-label="Labour rate line 1"]', "100");
  await page.waitForSelector('[aria-label="Totals"]');
  const plain = await totals();
  await page.check('input[aria-label="Labour rates include GST"]');
  await page.fill('input[aria-label="Labour rate line 1"]', "103");
  ok(await page.locator("text=₹100.00 without GST").isVisible(), "7: a labour rate of 103 with GST shows '₹100.00 without GST'");
  const withGst = await totals();
  ok(plain === withGst && /Payable ₹\d/.test(plain), `7: labour 103 including GST gives the same bill as labour 100 without it (${plain.match(/Payable ₹[\d,.]+/)?.[0]})`);
  await page.uncheck('input[aria-label="Labour rates include GST"]');
  await page.fill('input[aria-label="Labour rate line 1"]', "0");

  // Switching to a sale whose rate is fixed later, and back, must not break the lines grid (it has its own grid and no bill-type bar).
  await page.click('button:has-text("Fixed when paid (credit)")');
  ok((await page.locator('[aria-label="Bill type"]').count()) === 0 && (await page.locator("text=Fixed when paid").count()) >= 1, "the credit (rate fixed later) grid has no bill-type bar");
  await page.click('button:has-text("Fixed now")');
  ok(await page.locator('[aria-label="Bill type"]').isVisible() && (await page.locator('input[aria-label="Net g line 1"]').inputValue()) === "9.800", "and switching back brings the full grid back with the typed figures");
}

// ---------------------------------------------------------------- 11: reverse calculation
{
  await page.goto(`${B}/#/calculator`);
  await page.waitForSelector("h1:has-text('Invoice calculator')");
  await page.fill('input[aria-label="Net g line 1"]', "9.800");
  await page.click('button:has-text("Reverse calculation")');
  await page.fill('input[aria-label="Final amount for reverse calculation"]', "2,884");
  await page.click('button:has-text("Work it out")');
  const answer = flat(await page.locator('section[aria-label="Reverse calculation"] [role="status"]').first().innerText());
  ok(/Gold rate per gram on line 1 is ₹[\d.,]+ per gram\. The bill then comes to exactly ₹2,884\.00/.test(answer), "11: type ₹2,884 and the gold rate is worked out: " + answer.slice(0, 110));
  await page.click('button:has-text("Use this on line 1")');
  const rate = Number((await page.locator('input[aria-label="Gold rate line 1"]').inputValue()).replace(/,/g, ""));
  ok(rate > 285 && rate < 286.5, `11: the rate is put on the line (${rate} per gram, the paper bill's 285.72 is one of the answers)`);
  const t = flat(await page.locator('[aria-label="Totals"]').innerText());
  ok(t.includes("Payable ₹2,884.00"), "11: and the bill's payable is exactly ₹2,884.00");
  // Solve the net weight instead: gold 285.72, total 2,884 -> 9.800 g
  await page.fill('input[aria-label="Gold rate line 1"]', "285.72");
  await page.fill('input[aria-label="Net g line 1"]', "");
  await page.selectOption('select[aria-label="What to work out"]', "weight");
  await page.fill('input[aria-label="Final amount for reverse calculation"]', "2,884");
  await page.click('button:has-text("Work it out")');
  await page.click('button:has-text("Use this on line 1")');
  ok((await page.locator('input[aria-label="Net g line 1"]').inputValue()) === "9.800", "11: the net weight can be worked out too (9.800 g)");
  // A total no rate can make says so instead of guessing.
  await page.selectOption('select[aria-label="What to work out"]', "labour");
  await page.fill('input[aria-label="Final amount for reverse calculation"]', "1");
  await page.click('button:has-text("Work it out")');
  const low = flat(await page.locator('section[aria-label="Reverse calculation"] [role="status"]').first().innerText());
  ok(/closest|too/i.test(low), "11: an amount that cannot be reached says so: " + low.slice(0, 100));
}

// ---------------------------------------------------------------- 3, 14, 15: one receipt, cash and UPI; outstanding and advance shown
let multiPaymentId;
{
  const name = `Multi Mode ${uniq}`;
  const customerId = await newCustomer(name);
  const inv = await newInvoice(customerId, name, [line(10000, 28_572_000)]);
  const first = await api("POST", "/api/payments", { date: today, customerId, mode: "upi", reference: `OLD-${uniq}`, amountPaise: 300_000, purpose: "advance" });
  ok(first.status === 201, "an advance of ₹3,000 is already held for the customer");
  await page.goto(`${B}/#/payments`);
  await page.waitForSelector("h1:has-text('Payments')");
  await page.click('button:has-text("Receive payment")');
  await pickCustomer(name);
  await page.waitForSelector('[aria-label="What the customer owes and holds"]');
  const ctx1 = flat(await page.locator('[aria-label="What the customer owes and holds"]').innerText());
  ok(ctx1.includes(`Outstanding: ₹${(inv.payablePaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })} on 1 invoice`), "14: choosing the customer shows what they owe: " + ctx1.slice(0, 70));
  ok(ctx1.includes("Advance already held: ₹3,000.00"), "15: and the advance already held: ₹3,000.00");
  await page.selectOption('label:has-text("Mode") select', "cash");
  await page.fill('input[placeholder="e.g. 14,500"]', "5,000");
  const ctx2 = flat(await page.locator('[aria-label="What the customer owes and holds"]').innerText());
  ok(ctx2.includes("Advance after this receipt: ₹8,000.00"), "15: receiving ₹5,000 as an advance shows the total advance after it: ₹8,000.00");
  await page.click('button:has-text("Add another payment mode")');
  await page.fill('input[aria-label="Amount of payment mode 2"]', "9,500");
  await page.selectOption('select[aria-label="Payment mode 2"]', "upi");
  await page.fill('input[aria-label="Reference of payment mode 2"]', `UPI-${uniq}`);
  ok(flat(await page.locator("body").innerText()).includes("Total received on this receipt: ₹14,500.00"), "3: the dialog adds the two modes: ₹14,500.00");
  ok(flat(await page.locator('[aria-label="What the customer owes and holds"]').innerText()).includes("Advance after this receipt: ₹17,500.00"), "15: and the advance after both modes: ₹17,500.00");
  await page.screenshot({ path: `${S}/shot-receive-two-modes.png` });
  await page.click('button:has-text("Save payment")');
  await page.waitForSelector("h1:has-text('PAY-')");
  multiPaymentId = page.url().split("/").pop();
  const rc = (await page.locator("h1").first().innerText()).trim();
  ok(/^PAY-\d{4}/.test(rc), `3: saved as ONE receipt ${rc}`);
  await page.waitForSelector("text=Payment modes on this receipt");
  const modesText = flat(await page.locator('[aria-label="Payment modes"]').innerText());
  ok(modesText.includes("Cash") && modesText.includes("UPI") && modesText.includes("₹5,000.00") && modesText.includes("₹9,500.00") && modesText.includes(`UPI-${uniq}`), "3: the receipt page lists Cash ₹5,000 and UPI ₹9,500 with its reference");
  ok(flat(await page.locator("dl").first().innerText()).includes("₹14,500.00"), "3: and the receipt total is ₹14,500.00");
  const list = await api("GET", `/api/payments?customerId=${customerId}`);
  ok(list.body.items.filter((p) => p.receiptNo === rc).length === 1, "3: the payments list shows that receipt once");

  // 10: the A5 receipt
  await openPrint(`/print/payment/${multiPaymentId}`, rc);
  const pdf = await saveAsPdf("feedback-receipt-two-modes");
  const text = textOf(pdf);
  ok(pagesOf(pdf) === 1 && isA4Portrait(pdf), "10: the receipt is one A4 sheet holding the A5 receipt");
  ok(text.includes("Payment received (1 of 2)") && text.includes("Payment received (2 of 2)") && text.includes("Cash") && text.includes("UPI") && text.includes(`UPI-${uniq}`) && text.includes("14,500.00"), "3: the printed receipt has a line for cash and a line for UPI, and the total");
  ok(text.includes("Previous advance remaining") && text.includes("3,000.00") && text.includes("17,500.00"), "15: the printed receipt shows the previous advance (₹3,000.00) and the total available (₹17,500.00)");
  await page.screenshot({ path: `${S}/shot-receipt-two-modes.png` });
  const overflow = await page.evaluate(() => [...document.querySelectorAll(".receipt-main")].some((m) => m.scrollHeight > m.clientHeight + 1));
  ok(!overflow, "10: nothing on the A5 receipt is cut off");

  // phone: the receipt page does not scroll sideways
  const phone = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const p2 = await phone.newPage();
  await p2.goto(B);
  await p2.fill('input[autocomplete="username"]', "owner");
  await p2.fill('input[type="password"]', PASSWORD);
  await p2.click('button:has-text("Log in")');
  await p2.waitForSelector("text=Today's rates");
  await p2.goto(`${B}/#/payments/${multiPaymentId}`);
  await p2.waitForSelector("text=Payment modes on this receipt");
  ok(!(await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "phone: the two-mode receipt page does not scroll sideways");
  await phone.close();
}

// ---------------------------------------------------------------- 2, 12, 13: old gold from the settlement page
{
  const name = `Gold Seller ${uniq}`;
  const customerId = await newCustomer(name);
  const inv = await newInvoice(customerId, name, [line(2_000_000, 28_572_000, "Silver set")]);
  await page.goto(`${B}/#/invoices/${inv.id}`);
  await page.waitForSelector(`h1:has-text('${inv.invoiceNo}')`);
  await page.click('button:has-text("Settlement")');
  await page.waitForSelector("text=Balance due");
  await page.click('button:has-text("Add old gold receipt")');
  await page.waitForSelector("h1:has-text('New old gold receipt')");
  await page.waitForSelector(`text=${name}`);
  // 12 rows (the old limit was 10)
  for (let i = 1; i <= 12; i++) {
    if (i > 1) await page.click('button:has-text("Add row")');
    await page.fill(`[aria-label="Description row ${i}"]`, `Old Gold ${i}`);
    await page.fill(`input[aria-label="Gross g row ${i}"]`, "10.000");
    await page.fill(`input[aria-label="Rate row ${i}"]`, "5,000");
  }
  ok((await page.locator('[aria-label="Description row 1"]').evaluate((el) => el.tagName)) === "TEXTAREA", "6: the old gold description is a bigger box too");
  ok(await page.locator('button:has-text("Add row")').isEnabled(), "12: the 12th row was added (the limit is now 50), and more can follow");
  // 10 g x 91.60% x 5,000 = 45,800 a row, x 12 = 5,49,600
  await page.waitForSelector("text=Final amount");
  const body = flat(await page.locator("body").innerText());
  ok(body.includes("5,49,600.00"), "12: twelve rows add up: ₹5,49,600.00");
  const payNumbersBefore = (await api("GET", "/api/payments?kind=old_gold")).body.items.filter((p) => p.receiptNo).length;
  await page.click('button:has-text("Save receipt")');
  // 13: back on the invoice's settlement page, not on the old gold receipt
  await page.waitForSelector("text=Received against this invoice", { timeout: 15000 });
  ok(page.url().endsWith(`#/invoices/${inv.id}`), "13: after saving, the invoice's own page opens (not the receipt)");
  ok(await page.locator('dt:has-text("Balance due")').isVisible(), "13: and it is the settlement page");
  const note = flat(await page.locator("body").innerText());
  ok(/Old gold receipt OGP-\d{4} saved\./.test(note), "13: it says which old gold receipt was saved");
  ok((await page.locator("td:has-text('OGP-')").count()) >= 1 && note.includes("₹5,49,600.00"), "13: the settlement shows the old gold line and the new amount received");
  const payNumbersAfter = (await api("GET", "/api/payments?kind=old_gold")).body.items.filter((p) => p.receiptNo).length;
  ok(payNumbersAfter === payNumbersBefore, "2: old gold used on an invoice made no payment receipt");
  ok(note.includes("adjusted against this invoice"), "2: the settlement note says the old gold was adjusted against the invoice");

  // 10, 12: print the receipt with its 12 rows
  const link = await page.locator('a:has-text("Open the receipt")').getAttribute("href");
  await page.goto(`${B}/${link}`);
  await page.waitForSelector("h1:has-text('OGP-')");
  const ogpNo = (await page.locator("h1").first().innerText()).trim().split(/\s/)[0];
  await openPrint(`/print/old-gold/${link.split("/").pop()}`, ogpNo);
  const pdf = await saveAsPdf("feedback-old-gold-12-rows");
  const t = textOf(pdf);
  let all = true;
  for (let i = 1; i <= 12; i++) if (!new RegExp(`Old Gold ${i}(?!\\d)`).test(t)) all = false;
  ok(all, "12: all 12 old gold rows are printed");
  ok(t.includes("5,49,600.00") && isA4Portrait(pdf), `10: the total is printed, on A4 paper holding A5 blocks (${pagesOf(pdf)} sheet${pagesOf(pdf) > 1 ? "s" : ""})`);
  ok(t.includes("Sheet 1 of") || pagesOf(pdf) === 1, "12: when the rows need more than one A5 block, each says 'Sheet n of m'");
  const clipped = await page.evaluate(() => [...document.querySelectorAll("[data-receipt-main]")].some((m) => m.scrollHeight > m.clientHeight + 1));
  ok(!clipped, "12: no row or total is cut off on the A5 blocks");
  await page.screenshot({ path: `${S}/shot-old-gold-12-rows.png` });

  // 2: an old gold receipt kept as an advance does get a PAY- receipt
  const adv = await api("POST", "/api/old-gold", { date: today, customerId, treatment: "advance", rows: [{ description: "Old Gold", grossMg: 25000, lessMg: 2020, karat: "22K", purityBps: 7526, rateKgPaise: 1480000000 }] });
  ok(adv.status === 201 && /^PAY-\d{4}$/.test(adv.body.payment?.receiptNo ?? ""), "2: old gold turned into an advance gets a payment receipt " + (adv.body.payment?.receiptNo ?? ""));
}

// ---------------------------------------------------------------- 9: another customer's advance on this invoice
{
  const lenderName = `Lender ${uniq}`;
  const borrowerName = `Borrower ${uniq}`;
  const lenderId = await newCustomer(lenderName);
  const borrowerId = await newCustomer(borrowerName);
  const adv = await api("POST", "/api/payments", { date: today, customerId: lenderId, mode: "upi", reference: `L-${uniq}`, amountPaise: 1_000_000, purpose: "advance" });
  const inv = await newInvoice(borrowerId, borrowerName, [line(10000, 28_572_000)]);
  await page.goto(`${B}/#/invoices/${inv.id}`);
  await page.waitForSelector(`h1:has-text('${inv.invoiceNo}')`);
  await page.click('button:has-text("Settlement")');
  await page.waitForSelector("text=Balance due");
  await page.click('button:has-text("Use an advance")');
  ok(await page.locator("text=This customer has no advance left.").isVisible(), "9: the customer's own advance list is empty, as before");
  await page.check("text=Use another customer's advance");
  await pickCustomer(lenderName);
  await page.waitForSelector(`text=Advance of ${lenderName}`);
  await page.waitForSelector(`input[aria-label="Use from ${adv.body.payment.receiptNo}"]`);
  const prefilled = await page.locator(`input[aria-label="Use from ${adv.body.payment.receiptNo}"]`).inputValue();
  ok(Math.round(Number(prefilled) * 100) === inv.payablePaise, `9: the lender's advance is offered, filled with what the invoice owes (${prefilled})`);
  await page.screenshot({ path: `${S}/shot-other-customer-advance.png` });
  await page.click('div[role="dialog"] button:has-text("Apply")');
  await page.waitForSelector("text=Advance applied to the invoice.");
  const st = flat(await page.locator("body").innerText());
  ok(st.includes(`money of ${lenderName}`) && st.includes(`of ${lenderName} used on this invoice`), "9: the settlement says whose money was used");
  ok(st.includes("₹0.00"), "9: and the balance due is nil");
  const lender = await api("GET", `/api/customers/${lenderId}/ledger`);
  const borrower = await api("GET", `/api/customers/${borrowerId}/ledger`);
  ok(lender.body.outstandingPaise === 0 && lender.body.advanceHeldPaise === 1_000_000 - inv.payablePaise, "9: the lender owes nothing and their advance went down by the invoice amount");
  ok(borrower.body.outstandingPaise === 0 && borrower.body.advanceHeldPaise === 0, "9: the borrower owes nothing and holds no advance");
}

// ---------------------------------------------------------------- 8, 10: a bill with many items
{
  const name = `Many Items ${uniq}`;
  const customerId = await newCustomer(name);
  const lines = Array.from({ length: 14 }, (_, i) => line(1000 + i, 28_572_000, `Bangle ${i + 1}`));
  const inv = await newInvoice(customerId, name, lines);
  await openPrint(`/print/invoice/${inv.id}`, inv.invoiceNo);
  await page.selectOption("select", "first");
  const fit = await page.evaluate(() => {
    const mains = [...document.querySelectorAll("[data-front-main]")];
    const feet = [...document.querySelectorAll(".front-foot")];
    return {
      sheets: mains.length,
      clipped: mains.some((m) => m.scrollHeight > m.clientHeight + 1),
      overlapsFooter: mains.some((m, i) => m.getBoundingClientRect().bottom > feet[i].getBoundingClientRect().top + 1),
    };
  });
  ok(!fit.clipped && !fit.overlapsFooter, `8: 14 items: nothing is cut off and nothing runs into the footer (${fit.sheets} sheet${fit.sheets > 1 ? "s" : ""})`);
  const pdf = await saveAsPdf("feedback-invoice-14-items");
  const t = textOf(pdf);
  let each = true;
  for (let i = 1; i <= 14; i++) if ((t.match(new RegExp(`Bangle ${i}(?!\\d)`, "g")) ?? []).length !== 1) each = false;
  ok(each, "8: every one of the 14 items is printed exactly once");
  ok(t.includes(`${(inv.payablePaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`) && t.includes("Settlement and Payment Record"), "8: the total and the settlement back page are there");
  ok(isA4Portrait(pdf) && pagesOf(pdf) % 2 === 0, "8: A4 portrait sheets, each with its back");
  await page.screenshot({ path: `${S}/shot-invoice-14-items.png` });
}

ok(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
