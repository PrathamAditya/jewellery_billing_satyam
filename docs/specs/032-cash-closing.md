# 032: Daily cash closing

Status: Built (Wave 2) on branch `spec-051-032-audit-cash`, owner review pending. Built with the defaults for Q130 to Q138 (section 8), because the owner's answer to Q79 was open.
Depends on: 015 (payments and modes), 016 (refunds), 018 (old gold payouts), 021 (credit note payouts, spec 019d), 004 (permissions), 051 (audit viewer, for the audit rows)
Owner's wording (answer 44, `docs/owner-answers-2026-11-01.md`): opening cash, cash in, cash out, expected closing, counted cash, difference, remarks, history by date.
Open questions used with defaults: Q130 to Q138 (`docs/open-questions.md`, section V). Q79 is answered in part by them.

## 1. Goal
At the end of each day the owner, or a staff member with permission, counts the cash in the drawer and closes the day. The system works out the expected cash from the cash that really moved that day, then records the counted amount and the difference. A closed day is kept as it was saved; later changes show as a note.

## 2. Rules

**What counts as cash**
- K1. Only mode `cash` moves the drawer. UPI, card, cheque, bank transfer and old gold receipts (mode `old_gold`) never count (Q135).
- K2. Cash in: cash payments (advance, at-sale and invoice payments) dated the day, not voided. Opening advances are excluded (Q137).
- K3. Cash out: cash refunds (spec 016) dated the day, not reversed; cash credit note payouts (spec 019d) dated the day, not reversed; cash old gold payouts dated the day, not voided. Spec 018 refuses cash for old gold, so this line is zero until that changes.
- K4. The expected cash = opening cash + cash in - cash out.

**Opening cash and order**
- K5. The first closing types the opening cash: the cash in the drawer at the start of that day. It is 0 if not typed (Q136).
- K6. Every later closing opens with the counted cash of the last closed day. The screen shows where it comes from.
- K7. Days close in order. A day cannot be closed while an earlier day with cash entries is still open (409 `earlier_day_open`), and a day before the last closed day cannot be closed (409 `date_before_last_closing`).
- K8. Only a day that has ended (India time) can be closed (400 `date_in_future`). One closing per business date (409 `already_closed`).

**Counting**
- K9. Counted cash is whole paise, 0 or more. Difference = counted - expected (negative means short, positive means extra). A difference other than zero needs a reason (up to 300 characters); without it the save is refused (400, field `reason`).
- K10. A safe retry with the same id, date, counted cash and reason returns the first close (200). A different content with the same date is 409.

**Closed days**
- K11. A closed day cannot be edited or reopened. There is no route that changes a closing, and the table refuses an update or a delete (Q133, Q134).
- K12. A correction is a dated note on the closed day (`cash.close`). A note on a day that is not closed is refused (409 `day_not_closed`).
- K13. If cash for a closed day changes later (for example a receipt dated that day is entered after the close), the saved closing does not change. The day shows the figure it would have now and asks for a correction note (Q138).

**Who**
- K14. Closing a day and adding a correction note need `cash.close`: owner and manager by default (Q131). Staff and view-only can read the day and the history (`payments.view`).
- K15. Phone: read only. The count, the close button and the note box are hidden (decision D5).

## 3. Data and API

**Migration `0023_cash_closing.sql`**
- Table `cash_closings`: `id`, `business_date` (unique), `opening_paise`, `expected_paise`, `counted_paise`, `difference_paise`, `reason`, `totals_json` (the cash lines as they were at the close), `closed_by`, `closed_at`, standard columns. Checks: the difference is counted minus expected; a non-zero difference has a reason.
- Table `cash_closing_notes`: `id`, `business_date`, `note`, standard columns. A trigger refuses a note for a day that is not closed.
- Append-only triggers on both tables (no update, no delete), like the other business tables.
- Roles (data, not schema): `cash.close` is added to the owner and manager rows, in place. `audit.view` is removed from the manager and view-only rows (spec 051 A6). Both are done with `json_insert` and `json_each`, so changes made on the People screen are kept.

**API** (all under `/api/cash-closing`):
- `GET /?date=YYYY-MM-DD` (default today, India time), `payments.view`: the day's opening, cash lines and totals, expected (null while the first opening is untyped, or while an earlier day is open), the closing if any, the current figure for a closed day, the correction notes, `lastClosedDate`, `blockedByDate`, `canClose`.
- `GET /list?cursor=`, `payments.view`: closings newest first, 20 per page, with the number of notes.
- `POST /` `{ id?, date, countedPaise, openingPaise?, reason? }`, `cash.close`: closes the day (201, or 200 on a safe retry). `openingPaise` is allowed only for the first closing.
- `POST /:date/notes` `{ id?, note }`, `cash.close`: a correction note (201).
- Audit rows: `cash_closed` (entity `cash_closing`, detail with the figures) and `cash_closing_note`, in the same batch as the change.
- Shared types and the expected-cash arithmetic: `packages/shared/src/cashClosing.ts`.
- Permission map: GET routes to `payments.view`; both POST routes to `cash.close`.

## 4. Screen
- **Cash closing** page at `#/cash-closing`, linked from the top bar for users with `payments.view`.
- Day picker (default today). Summary: opening cash (with its source), cash received, cash refunded, credit note payouts in cash, old gold payouts in cash, expected cash.
- Cash list for the day: kind, reference, party, in, out. UPI and other modes are not listed.
- **Close this day** (PC, `cash.close`, day not closed): opening box (first closing only), counted box, the difference shown live ("Short: ₹x less than expected" / "Extra cash: ₹x more" / "agrees"), a reason box that appears when the difference is not zero, the close button. A line explains why a day cannot be closed yet.
- **Correction note** (PC, `cash.close`, day closed): a note box.
- **History**: every closing, newest first, with expected, counted, difference, who closed it and the number of notes. Click a row to open that day.
- Phone: the summary, list and history only.

## 5. Edge cases
- No cash on the day: expected is the opening cash alone; the day can be closed with a count equal to it.
- A payment voided after the close: the saved closing stays; the day shows the current figure and asks for a note.
- A cash refund reversed after the close: the same as a voided payment.
- A cash receipt dated an earlier day than the last close: that day cannot be closed (K7); it shows as a change on its own day (K13) if it was already closed.
- Two closes at the same moment: the database's unique date stops the second one (409); a double close is never saved.
- Old gold: no cash old gold payouts exist yet (spec 018), so the line is zero.

## 6. Test cases
- `apps/api/test/cashClosing.test.ts` (21 tests):
  - A day with a cash receipt, a cash refund, a cash credit payout, and UPI, card and bank transfer money: only the cash counts (K1 to K4).
  - A day with only UPI, card and bank transfer: no cash movement (K1).
  - A voided cash receipt and a reversed cash refund do not count (K2, K3).
  - The first closing types the opening; the difference is counted minus expected; a difference without a reason is refused (K5, K9).
  - A day that agrees needs no reason; the next day opens with the last count (K6).
  - One closing per date: a second close is refused and writes nothing (K8).
  - The counted amount must be whole paise and not negative (K9); a day that has not ended cannot be closed (K8).
  - Only the first closing takes an opening (K5, K6); a safe retry returns the first close (K10).
  - A closed day is not editable: no route, the table refuses update and delete (K11). A later cash entry leaves the saved closing and shows the change (K13). A correction note is added to a closed day only (K12).
  - A day before the last close is refused; an open earlier day with cash blocks the later day until it is closed (K7).
  - The list is newest first with its notes. Staff and view-only cannot close; manager can; owner can (K14). Owner and manager hold `cash.close`; manager and view-only lack `audit.view` (migration 0022).
- Browser (`e2e/cashClosing.mjs`): today's cash lists the cash advance and not the UPI payment; the live difference shows as short; a reason is needed; the day closes; a second close is refused; a correction note is added; phone shows no close button or note box and does not scroll sideways. A run on a database where today is already closed checks the closed view instead.

## 7. Out of scope
Opening cash counted per till or per staff member, a cash-in-transit or bank deposit record, reopening a closed day, a bank reconciliation, cash limits per day, printing the closing sheet, and the daily cash report in Excel (spec 031).

## 8. Defaults used (owner may change later)
- Q130 (one per day): one closing per business date; days close in order and only after they have ended (India time).
- Q131 (who): `cash.close` for the owner and manager; staff and view-only read only. Correction notes need the same permission.
- Q132 (count and difference): counted in paise, required; difference = counted minus expected; a reason (300 characters at most) when it is not zero.
- Q133 (edits): a closed day cannot be edited. A correction is a dated note on the day, shown with the closing.
- Q134 (reopening): not allowed. The owner adds a correction note.
- Q135 (which money is cash): only mode `cash`. Cash refunds and cash credit note payouts are cash out; cash old gold payouts are cash out when they exist. UPI, card, cheque, bank transfer, old gold receipts and held credit never count.
- Q136 (opening cash): the first closing types the drawer's cash at the start of the day (0 if not typed); later closings open with the last closed count. A day with cash entries must be closed before a later day.
- Q137 (historic money): an opening advance (money taken before the system went live) does not count in the day's cash.
- Q138 (changes after the close): the saved figures never change; the day shows the current expected figure and asks for a correction note.
- Q139 is the audit viewer's default (spec 051): owner only.

## 9. Acceptance checklist
- [x] K1 to K15 implemented and tested in `apps/api/test/cashClosing.test.ts` (21 tests)
- [x] Migration `0023_cash_closing.sql` applied to the local database; the role changes checked by a test
- [x] Browser test `e2e/cashClosing.mjs` added to `e2e/run-all.mjs`
- [ ] Owner review of Q130 to Q138

Status line: built on branch `spec-051-032-audit-cash`, owner review pending.
