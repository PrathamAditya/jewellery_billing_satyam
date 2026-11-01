// Spec 014: printing. Opens each print view in Chrome, saves it as a PDF, and checks the page count, the page size and the printed figures.
import { execFileSync } from "node:child_process";
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
const hosts = new Set();
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && !/40[0-9]/.test(m.text()) && errors.push("console: " + m.text()));
page.on("request", (r) => hosts.add(new URL(r.url()).host));
const ok = (cond, msg) => {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) process.exitCode = 1;
};
const uniq = Date.now().toString().slice(-6);
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // India date (CLAUDE.md: never the browser date)

const pagesOf = (file) => Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file]).toString())[1]);
// Size in points, within 1 pt: A4 is 595 x 842 and the PDF rounds it to 594.96 x 841.92.
const isA4Portrait = (file) => {
  const [, w, h] = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(execFileSync("pdfinfo", [file]).toString());
  return Math.abs(Number(w) - 595) < 1 && Math.abs(Number(h) - 842) < 1;
};
// Reading order (not -layout): the left and right columns would otherwise interleave the wrapped words.
const textOf = (file) => execFileSync("pdftotext", [file, "-"]).toString().replace(/\s+/g, " ");

async function openPrint(route, marker) {
  // Leave the print view first, so each print starts from its defaults (the copy choice is kept while on the same view).
  await page.goto(`${B}/#/`);
  await page.waitForSelector("text=Today's rates");
  await page.goto(`${B}/#${route}`);
  await page.waitForFunction((m) => document.querySelector(".print-stage")?.innerText.includes(m), marker, { timeout: 15000 });
}
async function saveAsPdf(name) {
  await page.waitForLoadState("networkidle");
  const file = `${S}/${name}.pdf`;
  await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  return file;
}

await page.goto(B);
await page.fill('input[autocomplete="username"]', "owner");
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Log in")');
await page.waitForSelector("text=Today's rates");

// The documents are made through the app's own API, as the logged-in owner (the browser sends the session and the Origin header).
const api = (method, path, body) =>
  page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    },
    { method, path, body },
  );

const customer = await api("POST", "/api/customers", { name: `Print Test ${uniq}` });
ok(customer.status === 201, "customer for the print checks is saved");
const customerId = customer.body.customer?.id;
const customerName = `Print Test ${uniq}`;

// One line of 10 g at ₹20,031.33 per gram: taxable ₹2,00,313.30, GST 3%, round-off +₹0.30, total ₹2,06,323.00 (spec 012b example A).
const line = (netMg, goldPaisePerKg, description = "Gold Chain") => ({
  description,
  purity: "22K916",
  hsn: "7113",
  grossWeightMg: netMg + 2345,
  netWeightMg: netMg,
  polishBps: 0,
  goldRatePaisePerKg: goldPaisePerKg,
  labourRatePaisePerKg: 0,
});
const invoiceBody = (lines) => ({ invoiceDate: today, customerId, customerName, taxMode: "intra", remarks: null, lines });

const inv = await api("POST", "/api/invoices", invoiceBody([line(10000, 2003133000)]));
ok(inv.status === 201 && inv.body.payablePaise === 20632300, `reference invoice saved at ₹2,06,323.00 (${inv.status})`);
const invNo = inv.body.invoiceNo;

const long = await api("POST", "/api/invoices", invoiceBody(Array.from({ length: 20 }, (_, i) => line(1000 + i, 1000000000, `Bangle ${i + 1}`))));
ok(long.status === 201, "20-line invoice saved");

const voided = await api("POST", "/api/invoices", invoiceBody([line(5000, 1000000000)]));
const voidRes = await api("POST", `/api/invoices/${voided.body.id}/void`, { reason: "print check" });
ok(voidRes.status === 200, "voided invoice made for the print check");

const pay = await api("POST", "/api/payments", { date: today, customerId, mode: "cash", amountPaise: 1700000, purpose: "against_invoices", invoiceId: inv.body.id, allocation: "auto" });
ok(pay.status === 201 && pay.body.payment?.id, `₹17,000 received against the reference invoice (${pay.status}) ${JSON.stringify(pay.body).slice(0, 300)}`);

const og = await api("POST", "/api/old-gold", {
  date: today,
  customerId,
  rows: [{ description: "Old Gold", grossMg: 22980, lessMg: 0, karat: "22K", purityBps: 7526, rateKgPaise: 1480000000 }],
  treatment: "direct_payment",
  directPaise: 25596200,
  advancePaise: 0,
  invoiceAdjustPaise: 0,
  payoutMode: "upi",
  payoutReference: `UPI${uniq}`,
});
ok(og.status === 201 && og.body.finalPaise === 25596200, `old gold receipt saved at ₹2,55,962.00 (${og.status}) ${JSON.stringify(og.body).slice(0, 300)}`);
if (!pay.body.payment?.id || !og.body.id) throw new Error("payment or old gold receipt was not saved; see the lines above");

// ---- invoice ----
await openPrint(`/print/invoice/${inv.body.id}`, invNo);
await page.selectOption("select", "first");
await page.emulateMedia({ media: "print" });
ok(!(await page.locator(".print-toolbar").isVisible()), "the toolbar is hidden when printing");
// Reset the emulation: page.pdf() must render with the print styles (its own print media), not a forced screen media.
await page.emulateMedia({ media: null });
const f1 = await saveAsPdf("print-invoice-shop-copy");
ok(pagesOf(f1) === 2, `one-line invoice, one copy: 2 pages (got ${pagesOf(f1)})`);
ok(isA4Portrait(f1), "invoice pages are A4 portrait");
const t1 = textOf(f1);
for (const s of [invNo, "2,00,313.30", "3,004.70", "+ ₹ 0.30", "2,06,323.00", "Rupees Two Lakh Six Thousand Three Hundred Twenty Three Only.", "1,89,323.00"]) {
  ok(t1.includes(s), `printed: ${s}`);
}

await openPrint(`/print/invoice/${inv.body.id}`, invNo);
const fBoth = await saveAsPdf("print-invoice-both-copies");
ok(pagesOf(fBoth) === 4, `both copies (the default): 4 pages, shop then customer (got ${pagesOf(fBoth)})`);

await openPrint(`/print/invoice/${long.body.id}`, long.body.invoiceNo);
await page.selectOption("select", "first");
const fLong = await saveAsPdf("print-invoice-20-lines");
ok(pagesOf(fLong) === 4, `20 lines: front, blank back, front, settlement back (got ${pagesOf(fLong)})`);
ok(textOf(fLong).includes("Bangle 20"), "the 20th line is printed on the second page");

await openPrint(`/print/invoice/${voided.body.id}`, voided.body.invoiceNo);
await page.selectOption("select", "first");
// The stamp is rotated, so the PDF holds it as outlines, not text: check the page itself.
ok((await page.locator(".print-stage .void-stamp").count()) === 1, "voided invoice prints the VOID stamp");
ok(pagesOf(await saveAsPdf("print-invoice-voided")) === 2, "voided invoice keeps its two-sheet layout");

// ---- receipts ----
await openPrint(`/print/payment/${pay.body.payment.id}`, "Payment Receipt");
const fPay = await saveAsPdf("print-payment-receipt");
ok(pagesOf(fPay) === 1, `payment receipt: one A4 sheet (got ${pagesOf(fPay)})`);
const tp = textOf(fPay);
ok(tp.includes("17,000.00") && tp.includes("Payment Against Invoice"), "payment receipt prints the amount and the payment type");

await openPrint(`/print/old-gold/${og.body.id}`, "Old Gold Purchase");
const fOg = await saveAsPdf("print-old-gold-receipt");
ok(pagesOf(fOg) === 1, `old gold receipt: one A4 sheet (got ${pagesOf(fOg)})`);
const to = textOf(fOg);
// Labels are uppercased by the stylesheet, so compare in lower case.
for (const s of ["2,55,962.27", "- ₹ 0.27", "2,55,962.00", "amount in words"]) ok(to.toLowerCase().includes(s.toLowerCase()), `old gold receipt prints: ${s}`);

// ---- the one write a print makes ----
const logged = await api("POST", `/api/invoices/${inv.body.id}/print-event`, { copy: "SHOP COPY" });
ok(logged.status === 200 && logged.body.ok === true, "the print event is recorded");

// ---- phone: the preview fits the width, no sideways scroll ----
await page.setViewportSize({ width: 390, height: 844 });
await openPrint(`/print/invoice/${inv.body.id}`, invNo);
const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
ok(fits, "the print preview on a 390 px phone does not scroll sideways");

ok([...hosts].every((h) => h === new URL(B).host), "print pages load nothing from another host (fonts ship with the app)");
ok(errors.length === 0, "no browser errors" + (errors.length ? `: ${errors.join(" | ")}` : ""));

await browser.close();
