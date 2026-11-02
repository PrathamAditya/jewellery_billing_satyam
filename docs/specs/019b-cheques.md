# 019b: Cheque tracking (Received, Deposited, Cleared, Bounced)

Status: DRAFT for owner approval (Wave 2). Not built. Build only after the owner approves this spec.
Depends on: 015 (payments and allocations), 019 (ledger), 004 (permissions)
Open questions used with defaults: Q85 to Q88 (listed in `docs/open-questions.md`). Owner answer [23] (`docs/owner-answers-2026-11-01.md`) is the base for the statuses and the bounce rule.

## 1. Goal
A cheque is recorded as a payment with mode `cheque`, and its progress is tracked: it is received, deposited at the bank, cleared, or bounced. A bounce reverses the payment, so the invoice's balance goes back up. The record and its history stay, so the owner can see what happened and when.

## 2. Rules

**Status and history**
- C1. Only payments with mode `cheque` have a cheque status. A status is set when the payment is created (`received`) and changed only by the actions in section 3. Every change is written as an event row; nothing is edited or deleted (CLAUDE.md rule 4).
- C2. Statuses and the allowed moves: `received` to `deposited`, `deposited` to `cleared`, and `received` or `deposited` or `cleared` to `bounced`. `bounced` is final. Any other move is refused (409 `invalid_cheque_move`). Moving to the status you are already in is refused (409) and writes nothing.
- C3. Deposited and cleared change no money: the allocations stay as they are, and the balances do not move. They are for tracking only.

**Bounce**
- C4. Bounce is one action, in one database batch:
  1. the event row `bounced` is written with the reason (required, up to 300 characters);
  2. every non-reversed allocation of the payment is reversed (spec 015 M3), with reverse reason `Cheque bounced`, so each invoice's balance goes back up and the payment's remaining goes to zero;
  3. the payment is marked voided (`voided_at`, `voided_by`, `void_reason` = `Cheque bounced: <reason>`), so it stops counting as advance held (spec 015 M5). The payment row is kept, and it prints with the VOID stamp.
  4. an audit row `cheque_bounced` lists the payment, the reversed allocations and the reason.
- C5. A bounce is refused (409 `has_refunds`) while the payment has non-reversed refunds, as with voiding (spec 015 M7). The refund must be reversed first.
- C6. Once bounced, nothing reverses it. If the money is paid again, the owner records a new payment (cash, UPI or a new cheque). The bounced payment and its history stay.
- C7. No bounce charge is added to the customer's balance (default for Q85). A charge would be an invoice line, which is a separate decision.

**Details of the cheque**
- C8. Recorded on the payment at creation (all optional except the amount and the number in `reference`): `chequeBank` (up to 100 characters), `chequeDate` (a business date, may be later than today for a post-dated cheque), `chequeDrawer` (name of the person who signed, up to 100 characters). Stored on the payment row, and never printed on the receipt except as the reference line the receipt already shows.
- C9. Creating a cheque payment whose number matches another cheque payment that is not voided returns a warning `duplicate_cheque_number` (like the cash warning in spec 015 R5). It never blocks.

**Who can do what**
- C10. Recording a cheque and marking it deposited or cleared: `payments.create` (owner, manager, staff, as spec 004 gives it). Bounce: `payments.void` (owner only), because it reverses money (default for Q86).

**Reading**
- C11. Payment page: the status, the cheque details, and the event history (who, when, reason). Actions shown only when allowed for the current status and the user's permission.
- C12. Payments list: a filter for cheque status (all, pending = received or deposited, cleared, bounced). The Payments page shows a line with the pending cheques: count and total amount.
- C13. Ledger and settlement: a cheque line shows `Cheque <number> (<status>)` in the reference column. A bounced payment shows as voided there, as spec 019 already treats voided payments.
- C14. Receipt print (spec 014): a cheque receipt prints the cheque details it has. A bounced receipt prints with the VOID stamp. The receipt does not print the cheque status.

## 3. Data and API

**Data**
- Migration `0019_cheques.sql`:
  - `payments`: add `cheque_bank`, `cheque_date`, `cheque_drawer` (all nullable text).
  - new table `cheque_events` (append-only, no delete, same triggers as other business tables): `id`, `payment_id`, `status` (`received`, `deposited`, `cleared`, `bounced`), `at`, `by`, `reason` (nullable), standard columns.
  - index on `(payment_id, at)`.
- No existing row changes. Existing cheque payments (if any were recorded as mode `cheque` before 019b) get one `received` event in the migration, dated from their creation.

**API** (all under `/api/payments`):
- `POST /` (spec 015): accepts `chequeBank`, `chequeDate`, `chequeDrawer` when mode is `cheque`; the response includes `chequeStatus` and `chequeEvents`.
- `POST /:id/cheque` `{ status: "deposited" | "cleared" | "bounced", reason? }`: the moves in C2 and C4. Returns the payment.
- `GET /?mode=cheque&chequeStatus=pending|cleared|bounced|all`: list filter.
- Permission map: `POST /api/payments/:id/cheque` maps to `payments.create` for deposited and cleared, and to `payments.void` for bounced (the route checks the status in the body, so the handler also enforces it).

## 4. Screens
- **Payment page (PC):** a "Cheque" card: number, bank, cheque date, drawer, status, and the event list. Buttons "Mark deposited", "Mark cleared", "Mark bounced" (bounced asks for a reason and warns that the invoices will be re-opened). Hidden on phone (view only, decision D5).
- **Payments list:** the status filter, and the pending line described in C12.
- **New payment form:** when mode is cheque, the three cheque boxes appear.

## 5. Edge cases
- A cheque used as an advance and then allocated to invoices: a bounce reverses every allocation, so each invoice is re-opened, and any advance use in settlement (spec 017) is reversed as well.
- A cheque bounced after the invoice was printed: the printed bill is not changed, and the invoice page shows the balance due again. The owner decides what to tell the customer.
- A cheque bounced on a payment that was never allocated (plain advance): the advance is simply removed, and the customer's advance held goes down.
- Two bounces in a row for the same payment: the second is refused (C2, bounced is final).
- Deposited and cleared on the same day: allowed; the dates come from the event times.
- Phone: status can be seen, not changed.

## 6. Test cases
- Moves: received to deposited to cleared works; cleared to deposited, bounced to anything, and same-status moves are refused with the codes in C2.
- Deposited and cleared leave allocations and balances unchanged (C3).
- Bounce of a payment allocated to two invoices: both balances go back up, the payment is voided with the reason, the audit row names the reversed allocations, and the outstanding total rises by exactly the allocated amount (C4).
- Bounce with a live refund is 409 and writes nothing (C5). After reversing the refund it works.
- A bounced payment cannot be bounced again or reversed; a new payment can be made (C6).
- A non-cheque payment cannot take a cheque status (C1). A cheque payment needs no cheque details (they are optional).
- Staff can deposit and clear, cannot bounce; owner can bounce (C10).
- Duplicate number gives the warning and saves (C9).
- Ledger: a bounced cheque nets to zero in the customer's ledger, with the bounce as a reversal line (spec 019 section 6 style test).
- Browser (`e2e/cheques.mjs`): record a cheque on an invoice, deposit, clear, record a second cheque and bounce it, see the invoice balance go back up, the pending total, and the phone view read-only.

## 7. Out of scope
Re-presenting a bounced cheque, bank reconciliation or bank statement import, post-dated cheque reminders, bounce charges (Q85), cheque printing, electronic cheque clearing, NACH or ECS mandates.

## 8. Defaults used (owner may change later)
- Q85 (bounce charge): none. The customer's balance rises only by the reversed allocations.
- Q86 (who marks what): recording, deposited and cleared for anyone with `payments.create`; bounced for the owner (`payments.void`).
- Q87 (fields): number, bank, cheque date and drawer name, all optional except the number in `reference`.
- Q88 (moves): bounce allowed from any state before bounced (including after cleared, because banks sometimes return a cheque after clearing); no un-bounce.

## 9. Acceptance checklist
- [ ] Owner approves this spec (and answers or accepts Q85 to Q88)
- [ ] C1 to C14 implemented and tested
- [ ] Migration 0019 applied locally and in CI on an empty database and on seeded rows
- [ ] Browser test `e2e/cheques.mjs` added to `run-all`, and the full suite passes
- [ ] Earlier tests (015, 017, 019) still pass
