# 019: Customer ledger and opening balances

Status: Approved (Wave 1, owner approved in advance 2026-11-01), not built
Depends on: 010, 013, 015, 016, 018
Open questions used with defaults: Q47 (what the owner looks at daily)

## 1. Goal
For any customer: every invoice, payment, advance movement, refund and old gold receipt in date order, with what they owe and what advance the shop holds for them. The owner can also enter opening balances from the old system: what customers owe, and advances held. Opening entries are not sales and not newly received money.

## 2. Rules (money model in spec 015)
- R1. **Opening receivable** `opening_balances`: `customer_id`, `amount_paise` (more than 0), `as_of_date`, `reference` (up to 60), `remarks`, standard and void columns. It counts as a debt of the customer. It appears in the ledger on its as-of date. It can be paid through allocations like an invoice (spec 015 M3, FIFO treats it as an open item dated by `as_of_date`). It is not a sale: it has no GST and is excluded from sales totals.
- R2. **Opening advance** is entered through spec 016 R3 (a payment of kind `opening_advance`). The Opening balances screen offers both entries side by side so the owner finds them in one place.
- R3. **Voiding** an opening receivable (`ledger.opening`, with a reason) is refused while it has non-reversed allocations.
- R4. **Ledger** `GET /api/customers/:id/ledger?from&to`: entries in date order (then creation order), each with `date`, `type`, `reference`, `description`, `debitPaise`, `creditPaise`, `outstandingAfterPaise`, `advanceAfterPaise`. Types and effects, all derived from stored rows, nothing stored:
  - `Invoice` (invoice date): outstanding + payable. Voided invoices show as `Invoice (voided)` with their effect removed from the date they were voided.
  - `Opening balance` (as-of date): outstanding + amount.
  - `Payment received` (receipt date): advance held + amount.
  - `Applied to {invoice or opening}` (allocation date, India date of `created_at`): advance held - x and outstanding - x. An at-sale payment shows both lines on the same date.
  - `Allocation reversed` (reversal date): the opposite of the allocation.
  - `Refund` (refund date): advance held - x. `Refund reversed` opposite.
  - `Payment voided` (void date): advance held - remaining at that time (allocations are reversed first by their own lines).
  - `Old gold purchase` (receipt date): an information line with the final amount; its money effect is on its payment line. A direct-payment receipt has no balance effect.
  When `from` is set, the first row is `Brought forward` with both balances at that date.
- R5. **Totals** for a customer: `outstandingPaise` = sum of due of non-voided invoices + due of opening receivables, `advanceHeldPaise` = sum of remaining of non-voided payments, `netPaise` = outstanding - advance held. Always equal to the last ledger row (tested). Shown on the customer page and in the customer list.
- R6. **Summary** `GET /api/ledger/summary`: `totalOutstandingPaise`, `totalAdvanceHeldPaise`, number of customers with outstanding, and the top 10 customers by outstanding. Used by the dashboard (Wave 2) and an Outstanding screen now.
- R7. **Outstanding list** `GET /api/ledger/outstanding?q&cursor`: customers with outstanding above 0, largest first, with oldest unpaid date and advance held.
- R8. The ledger never changes data, and dates and amounts printed on a customer statement are the stored ones. A printable statement is Wave 2 (031).
- R9. Permissions: `ledger.view` to read, `ledger.opening` to add or void opening balances.

## 3. Data
Table `opening_balances` with a no-delete trigger and `payment_allocations.opening_balance_id` (exists from 015). API: `POST/GET /api/opening-balances`, `POST /api/opening-balances/:id/void`, R4 to R7.

## 4. Screens
- **Customer page, Ledger tab** (replaces the "coming soon" placeholder): outstanding and advance chips, date range, the entries table with running balances, buttons Receive payment, Receive advance, Add opening balance.
- **Outstanding** screen (top bar "Outstanding"): list from R7 with search, click through to the ledger.
- **Opening balances** screen: add a customer's receivable or old advance (with remarks and reference), list with void.
- Customer list gets outstanding and advance columns.

## 5. Edge cases
- A payment larger than the invoices: the leftover shows in advance held and the ledger line says so.
- Reversing an old allocation re-opens the invoice's due and moves money back to advance held, visible as its own line.
- Ledger date filter shows a correct `Brought forward` row.
- A customer with only an opening advance shows advance held with outstanding 0.
- A voided customer's ledger is still readable.

## 6. Test cases
- Scenario table: invoice ₹1,00,000, payment ₹40,000 at sale, advance ₹30,000 later, advance used ₹30,000, then reversed: assert every ledger row's `outstandingAfterPaise` and `advanceAfterPaise` after each step (outstanding 100,000 -> 60,000 -> 60,000 -> 30,000 -> 30,000 / advance 0 -> 0 -> 30,000 -> 0 -> 30,000, in rupees).
- The last ledger row always equals `outstandingPaise` and `advanceHeldPaise` (property test over 200 random sequences, like spec 017 E).
- Opening receivable ₹25,000 and opening advance ₹10,000: balances shown, FIFO payment pays the opening receivable first when it is the oldest, neither appears in sales totals or in "received today".
- Void opening receivable refused with allocations, allowed after reversing them.
- `Brought forward` row for a date range equals the balances at that date.
- Summary and outstanding list against hand-computed data, order largest first, 5,000 customers under 200 ms.
- Old gold lines: direct-payment receipt shows an info line only, advance receipt moves advance held.
- Permissions (view for viewer, opening only for those with `ledger.opening`).
- Browser (`e2e/ledger.mjs`): the scenario above through the screens, opening balances, outstanding list, phone read-only.

## 7. Out of scope
Printable statements and PDF/Excel (031), interest, credit limits, SMS reminders, sales-ledger accounting for the CA beyond the reports in Wave 2.

## 8. Defaults used
Q47: the owner's daily views are the outstanding list, advances held, a customer's full history and the totals on the dashboard (Wave 2).

## 9. Acceptance checklist
- [ ] R1 to R9 implemented and tested, including the property test
- [ ] Migrations applied locally and by CI
- [ ] Browser test passes, earlier tests green
