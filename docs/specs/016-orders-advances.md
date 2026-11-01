# 016: Orders and advances

Status: Approved (Wave 1, owner approved in advance 2026-11-01), not built
Depends on: 015
Open questions used with defaults: Q76 (order references)

## 1. Goal
A customer's order (`ORD-0001`) can collect several advances, each with its own receipt, including advances written in the old paper booklets. At final billing the owner can use any of them, and only the amount used is taken. If the order is cancelled, the remaining advance is either moved to the customer's account or refunded, and the history is kept.

## 2. Rules (money model in spec 015, read it first)
- R1. **Orders** `orders`: `order_no` (series `ORD`, resets each 1 April, spec 003 format `ORD-0001`) with `fy` and `serial`, `customer_id` (required), `description` (up to 300), `expected_date` (optional, any date), `status` (`open`, `closed`, `cancelled`), `remarks`, `header_json`, standard columns. An order is created from the customer page, from the Orders screen, or while receiving an advance ("New order" in the advance dialog). Default for Q76: an order is created on its own, with or without an advance, and it never restarts apart from the yearly series.
- R2. **Advances against an order:** a payment of kind `advance` with `orderId`. Many per order, each with its own `PAY-` receipt, shown on the order page with remaining amounts (owner answer 19).
- R3. **Opening advances (old booklets):** `POST /api/payments` with `purpose: "opening_advance"`: customer, amount, the original date, `reference` (the old booklet receipt number) and remarks, optional `orderId`. Kind `opening_advance`, no `PAY-` number, flagged as not newly received: excluded from "received today" figures and from collection reports, but included in the customer's advance held and available for adjustment.
- R4. **Using advances.** At final billing, any advance-like payment of the customer with remaining money (advance, opening advance, remaining of invoice payments and old gold payments) can be allocated to an invoice in parts (spec 017). Advances of the invoice's linked order are listed first. Only the allocated amount is deducted, the rest stays available.
- R5. **Link invoice to order:** `invoices.order_id` (nullable, added here). Setting it is optional on the invoice form and invoice page. It only affects the order of suggestions and the order page; it never changes amounts.
- R6. **Close an order** (`POST /api/orders/:id/close`): marks it completed. Remaining advances stay in the customer's account (nothing is lost).
- R7. **Cancel an order** (`POST /api/orders/:id/cancel`, needs `advances.cancel`) with `{ resolution: "transfer" | "refund", refundAmountPaise?, refundMode?, refundReference?, refundDate?, remarks }` (owner answer 20):
  - `transfer` (default): the order becomes `cancelled`, remaining advances stay as customer advance, no longer tied to an open order (the payments keep `order_id` for history).
  - `refund`: `refundAmountPaise` (default: the whole remaining of the order's advances, at most that) is refunded across the order's advances (oldest first) as refund rows; any rest stays as customer advance. Modes `cash`, `upi`, `bank_transfer`, `cheque`.
  Cancelled orders cannot receive new advances.
- R8. **Refunds** `payment_refunds`: `id`, `payment_id`, `amount_paise` (more than 0, at most the payment's remaining), `mode`, `reference`, `refund_date`, `remarks`, standard columns, reversal fields. `POST /api/payments/:id/refunds` (`payments.refund`) refunds an advance directly, `POST /api/refunds/:id/reverse` `{ reason }` undoes it. A refund reduces remaining (spec 015 M2). Refund history appears on the payment, the order and the customer ledger.
- R9. **History:** the order page lists, in time order, creation, each advance, each refund, close or cancel (from audit rows and refund rows), with who and when, plus the current remaining total.
- R10. **Customer advances list** `GET /api/customers/:id/advances`: payments with remaining more than 0, with receipt number, order number, date, amount, remaining, source (`advance`, `opening_advance`, `old_gold`, `invoice_payment`).
- R11. Voiding an advance is spec 015 M7 (refused while refunds exist).

## 3. Data
New tables `orders`, `payment_refunds` (no-delete triggers). New column `invoices.order_id`. `payments.order_id` exists from spec 015. API: `GET/POST /api/orders`, `GET /api/orders/:id`, `POST /api/orders/:id/close|cancel`, `POST /api/payments/:id/refunds`, `POST /api/refunds/:id/reverse`, `GET /api/customers/:id/advances`. Permissions: `advances.view|create|cancel`, `payments.refund`.

## 4. Screens
- **Orders** list and **order page** (customer, description, expected date, status, advances table with receipt numbers and remaining, refunds, history, buttons Receive advance, Close, Cancel).
- **Receive advance** uses spec 015's dialog with the order choice, and a second tab "Old booklet advance" for opening advances (date, old receipt number).
- **Cancel dialog:** shows the remaining amount, a choice "Keep as customer advance" or "Refund", refund amount, mode, reference, remarks.
- **Customer page** gets an "Advances" section from R10.

## 5. Edge cases
- Advances A (₹10,000) and B (₹5,000) on one order, invoice of ₹12,000 uses ₹10,000 from A and ₹2,000 from B: A remaining 0, B remaining ₹3,000.
- Cancel with refund of ₹3,000 when remaining is ₹4,000: refund ₹3,000, ₹1,000 stays as customer advance.
- A refund larger than remaining is 400.
- Cancelling an order whose advances were partly used: only the remaining can be moved or refunded.
- Opening advance dated years ago: allowed, no receipt number, reference free text.

## 6. Test cases
- Order numbers `ORD-0001`, `ORD-0002`, restart on 1 April, unique per `(fy, order_no)`.
- Two advances on one order get `PAY-0001` and `PAY-0002`, the second receipt's snapshot has previous remaining equal to the first's remaining.
- Opening advance: no receipt number, appears in customer advances, excluded from "received on date X" totals (assert a helper `receivedOnDate` used by the dashboard later), usable in an allocation.
- Partial use (section 5 first case) leaves exactly the unused amounts and cannot be used twice (a second allocation larger than remaining is 400).
- Cancel transfer: status cancelled, remaining unchanged and listed under customer advances. Cancel refund with a partial amount: refund rows created oldest first, remaining reduced, history lists everything.
- Refund and reverse refund restores remaining. Refund over remaining is 400. A voided payment with refunds is refused.
- Close keeps advances. A cancelled order refuses new advances (409).
- Permissions: staff can create orders and advances, cannot cancel or refund (403).
- Idempotent creates (order and refund).
- Browser (`e2e/orders.mjs`): create an order, receive two advances (one old booklet), cancel with a partial refund, see history, phone read-only.

## 7. Out of scope
Order items and weights, delivery tracking, SMS reminders, cheque tracking (Wave 2), cash-closing integration of refunds (spec 032).

## 8. Defaults used
Q76: orders are created explicitly and may have no advance, they follow the yearly `ORD` series, an invoice may optionally link to one.

## 9. Acceptance checklist
- [ ] R1 to R11 implemented and tested
- [ ] Migrations applied locally and by CI
- [ ] Browser test passes, earlier tests green
