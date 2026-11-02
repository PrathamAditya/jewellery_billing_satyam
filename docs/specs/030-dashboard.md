# 030: Dashboard

Status: Built 2026-11-02 on branch `spec-030-031-dashboard-reports` (Wave 2). Automated checks pass; owner review pending. Built with the defaults for Q140 to Q145.
Depends on: 013 (invoices, payable), 015 (payments and allocations), 019 (ledger summary), 019b (pending cheques), 019c (pending-rate sales), 019d (credit notes, through the ledger summary), 004 (permissions)
Open questions used with defaults: Q140 to Q145 (section V of `docs/open-questions.md`). Owner answer [42] (`docs/owner-answers-2026-11-01.md`) and decision D27 are the base. Q49 (which five numbers come first) is still open; all tiles are shown.

## 1. Goal
When the owner or staff open the app, the Home screen shows how the day and the year are going: today's sales, money received today, what customers owe, advances held, advances taken today, cheques still with the bank, sales waiting for their rate, and a month-by-month summary for this financial year and the last one. Nothing on the dashboard can be changed from it.

## 2. Rules
- D1. **Read-only.** `GET /api/dashboard` writes nothing: no row, no audit row, no number is allocated. Reading it twice gives the same figures until money moves.
- D2. **India business dates.** "Today" is `indiaDate(now)`. The financial year runs 1 April to 31 March. The response carries `asOf` (today).
- D3. **Today's sales.** Invoices with `invoice_date` = today, not voided, with rate status fixed. The amount is the stored payable (spec 013 R6). Count of those invoices.
- D4. **Sales waiting for the rate.** Count of pending-rate sales (spec 019c) that are not voided, any date. A pending sale adds no amount anywhere on the dashboard.
- D5. **Payments received today.** Payments with `receipt_date` = today, not voided, all modes (cash, UPI, card, cheque, bank transfer, old gold settlement, at-sale payments). The total is the sum of their amounts, and each mode is listed with its own amount.
- D6. **Outstanding.** The same figure as `GET /api/ledger/summary` (spec 019 R5 and R6): what customers owe on invoices and opening balances, less allocations and credit applications. The dashboard calls the same code (`ledgerTotals`), so the two cannot disagree. Also the count of customers who owe money.
- D7. **Advances held.** The same figure as the ledger summary: remaining money of live payments (spec 015 M2 and M5). Credit notes held (019d) are not in it; they are shown on the ledger.
- D8. **Advances taken today.** Payments of kind `advance` dated today, not voided. Opening advances (spec 019 R2) and old gold receipts are not new money and are left out. An advance taken against a pending-rate sale is an advance and is included.
- D9. **Cheques not yet cleared.** Count and total of cheque payments that are not voided and whose latest status is `received` or `deposited` (spec 019b C12). Any date.
- D10. **Monthly summary.** Two financial years: the current one first, then the previous one. Twelve months each, April first. Sales per month = payable of fixed, non-voided invoices by invoice date. Received per month = amounts of non-voided payments by receipt date, all modes. Months with no activity show 0.
- D11. **Permissions.** The route needs `dashboard.view` (owner, manager, staff and viewer have it). Inside the response, the sales section (today's sales, sales waiting for the rate, monthly sales) needs `invoices.view`; the money section (received today, outstanding, advances, cheques, monthly received) needs `payments.view`. A section the user may not see is `null`, and the screen hides its tiles. A user with `dashboard.view` and neither section gets the route with both sections `null`.
- D12. **Customer balances.** Outstanding and advances are customer balances, but they follow D11 (`payments.view`) and not `ledger.view`, so a user who can take payments sees them on the Home screen. Q140 records this choice.

## 3. Data and API
- **No new table.** Migration `0022_dashboard_permission.sql` is data-only: it adds `dashboard.view` to the stored permission lists of the four default roles (owner, manager, staff, viewer). Roles are stored in the database (spec 004), so the code's default list alone would not reach existing installations. This is the one change to existing rows; it is recorded here because the draft said "no migration".
- `GET /api/dashboard` returns `DashboardResponse` (`packages/shared/src/dashboard.ts`): `asOf`, `sales` (`todayPaise`, `todayCount`, `pendingRateCount` or null), `money` (`receivedTodayPaise`, `receivedTodayByMode`, `outstandingPaise`, `customersWithOutstanding`, `advancesHeldPaise`, `advancesTakenTodayPaise`, `pendingChequeCount`, `pendingChequePaise` or null), and `monthly` (two entries of `fy`, `from`, `to`, `months[{ month, salesPaise, receiptsPaise }]`, a value null where the permission is missing).
- Shared helpers extracted, same behaviour: `ledgerTotals` and `customerBalances` (`apps/api/src/ledger/routes.ts`), `pendingCheques` (`apps/api/src/payments/routes.ts`). The existing routes call them.
- Permission map: `GET /api/dashboard` maps to `dashboard.view`.

## 4. Screens
- **Home (PC and phone):** below the business banner and today's rates, a dashboard section headed "Dashboard, as on <date>". Tiles: Today's sales, Payments received today (with the split by mode), Outstanding, Advances held, Advances taken today, Cheques not yet cleared, Sales waiting for the rate. Two monthly tables, the current year and the previous year, with a yearly total.
- Tiles are a two-column grid on a phone and three on a PC. No sideways scroll at 390 px. The dashboard does not auto-refresh; it reads again when Home is opened.
- Android: the same read-only view (decision D5).

## 5. Edge cases
- Nothing today: every money tile shows zero, not a blank.
- A bill saved at 23:59 on 1 April in India is dated 1 April (India date, not UTC).
- A voided invoice or a voided payment disappears from today's figures and from the month they were in.
- A pending-rate sale fixed today: it counts as a sale on its invoice date (spec 019c R14). Until fixed it is only in "Sales waiting for the rate".
- A cheque bounced (019b) drops out of the pending cheques at once.
- A user without `payments.view` gets `money: null`: the outstanding and advance figures are not computed or sent to them.

## 6. Test cases
Unit and API (`apps/api/test/dashboard.test.ts`, clock 2 Nov 2026 11:30 IST), one test per tile with known data:
- Today's sales = payable of the bill dated today (`todayCount` 1). A voided invoice dated today is not counted.
- Receipts today: cash at sale ₹1,000.00, UPI advance ₹5,000.00, cheque advance ₹2,500.00 = ₹8,500.00 with the mode split. A voided advance of ₹700.00 is not counted.
- Outstanding equals `GET /api/ledger/summary` and equals the bill of today less the cash at sale, plus the October bill, plus the February bill of the previous year; two customers owe money.
- Advances held ₹7,500.00 (UPI ₹5,000.00 plus cheque ₹2,500.00); advances taken today ₹7,500.00.
- Pending cheques: one, ₹2,500.00.
- A pending-rate sale: count 1, and it adds nothing to today's sales or to outstanding.
- Monthly: the current year lists 12 months from 2026-04; October shows the October bill, November the bill of the day; the previous year shows February.
- Permissions: a role with `invoices.view` and `dashboard.view` gets the sales section and `null` for money; a role without `dashboard.view` gets 403; the default roles (owner, staff, viewer) get 200.
- Read-only: the audit log has the same number of rows after two reads.

Browser (`e2e/dashboard.mjs`): the owner's Home screen shows the tiles; a bill of 9.800 g silver and a ₹1,000.00 advance saved through the API make today's sales, receipts, advances and outstanding rise by exactly those amounts after a reload; each tile shows the formatted figure; two monthly tables; no sideways scroll at 390 px.

## 7. Out of scope
Stock value and low-stock alerts (inventory, specs 020 and 021), old gold purchase totals, purchases, karigar outstanding, customer statements, charts, live refresh, the choice of the five numbers (Q49), and printing the dashboard.

## 8. Defaults used (owner may change later)
- Q140: sales tiles need `invoices.view`; money tiles need `payments.view`; the route needs `dashboard.view`.
- Q141: "Payments received today" counts every mode, including the old gold settlement and payments at sale.
- Q142: "Advances taken today" counts kind `advance` only (no opening advances, no old gold).
- Q143: "Sales waiting for the rate" counts every open pending sale, not only today's.
- Q144: the monthly summary lists both financial years, all twelve months, by invoice date (sales) and receipt date (received); credit notes are not netted.
- Q145: outstanding and advances use the ledger summary definition; the dashboard does not show the five-number short list yet (Q49).

## 9. Acceptance checklist
- [x] D1 to D12 implemented in `apps/api/src/dashboard/routes.ts`
- [x] Migration `0022_dashboard_permission.sql` applied locally and in tests (data only)
- [x] `apps/api/test/dashboard.test.ts` (13 tests)
- [x] Browser test `e2e/dashboard.mjs` added to `run-all` and passes
- [ ] Owner reviews the tiles and the five numbers (Q49)
- [ ] Migration 0022 applied to the remote database by the owner (`npm run db:migrate:remote -w @jewellery/api`), not run from here
