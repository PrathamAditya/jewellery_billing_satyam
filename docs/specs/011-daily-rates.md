# 011: Daily gold and silver rates

Status: Draft (needs owner approval)
Depends on: 000, 001, 002
Open questions: Q1 to Q3 in section 8. Adds O9 to `docs/decisions.md` (blocks 012 and 018, not this spec).

## 1. Goal
The owner enters the day's rates once: 24K995 gold, 22K916 gold and silver. Every later feature asks "what is the applicable rate for this date?" and gets one clear answer. Past rates are kept forever, and changing a rate never touches an invoice that was already saved (the saved invoice keeps its own copy, see CLAUDE.md rule 5).

## 2. Rules

**What is stored**
- R1. Three rate kinds: `gold_24k995`, `gold_22k916`, `silver`. No other kinds in this spec (see O9).
- R2. One rate per kind per business date (India date). The business date is `YYYY-MM-DD`.
- R3. The owner enters the rate in the unit shops quote it, and it is stored in that unit as whole paise: **gold per 10 g, silver per 1 kg** (proposed as decision D13, see Q1). Entry is in rupees with up to 2 decimals, commas allowed (`1,20,000` or `120000.50`) and is converted to paise with no floats. The unit is fixed per kind, not stored per row.
- R4. A price must be greater than 0 and at most ₹1,00,00,000 per unit. Anything else is rejected with a clear message.
- R5. For display only, the screen also shows the per-gram figure (`₹12,000.00 per gram`). It is never stored. How later specs turn a price into an amount is decided in spec 012: they multiply weight in mg by the price and divide by the unit in mg (10,000 mg or 1,000,000 mg), and round once with the single rounding function.

**Dates**
- R6. A rate can be saved for today or any earlier date. Future dates are rejected. Past dates are allowed (to enter old data) and the screen asks "This is not today's date. Save anyway?".
- R7. "Today" always means the India date, never the browser or server date.

**Applicable rate**
- R8. The applicable rate for a kind on a date is the rate saved for that exact date. If there is none, it is the most recent rate saved for an earlier date, marked `carriedForward: true` with its `rateDate`. If nothing exists on or before that date, there is no applicable rate (`null`). This is the only lookup later features use (see Q2).
- R9. A rate saved later for a past date does not change what was answered before. It only changes the answer for that date from then on, and saved invoices are not affected.

**Corrections**
- R10. Saving a rate for a date and kind that already has one is an edit. The earlier value is stored as a revision (001 R10) with an optional reason, and an audit row is written (001 R11). Saving the same price again changes nothing and writes nothing.
- R11. Rates are never deleted and not voided. A wrong entry is corrected by an edit, and the history shows every earlier value.
- R12. **Typo guard:** if a new price differs from the previous price of that kind by more than 10%, the API replies 409 `needs_confirmation` with both prices and the percentage. The screen asks the owner to confirm and then resends with `confirmLargeChange: true`. The previous price means the applicable rate for that date, before the change.

**Access**
- R13. All routes need a login (002). `created_by` and `updated_by` are the user id.

## 3. Data
New table `rates` (migration follows 001 conventions, including the no-delete trigger):
- standard columns (`id`, `created_at`, `created_by`, `updated_at`, `updated_by`)
- `rate_date` (`YYYY-MM-DD`), `kind` (one of R1, checked), `price_paise` (integer, `CHECK (price_paise > 0)`)
- unique `(rate_date, kind)`, and an index on `(kind, rate_date)` for the "latest before" lookup.

Units live in code (`packages/calc`): `RATE_UNIT_MG = { gold_24k995: 10_000, gold_22k916: 10_000, silver: 1_000_000 }`.

API (all under `/api/rates`):
- `GET /applicable?date=YYYY-MM-DD` (date defaults to today): the three applicable rates per R8.
- `GET /?from=&to=`: saved rows grouped by date, newest first (default: last 60 days), with a cursor for older ones.
- `PUT /:date/:kind` body `{ price: "1,20,000", reason?, confirmLargeChange? }`: create or edit. 201 on create, 200 on edit or no-op.
- `GET /:date/:kind/history`: the earlier values with who changed them and when.

## 4. Screens and printing
**PC: Rates page** (new "Rates" link in the top bar)
- Top card "Rates for today (date)": three rows (24K995, 22K916, Silver). Each shows the unit ("per 10 g"), an input, the per-gram figure, and either "saved today" or "from 1 Nov (not set today)".
- One Save button saves the rows that changed. Inline messages from R4. The typo-guard prompt (R12) and the past-date prompt (R6) appear before saving.
- Below it, a history table: date, 24K995, 22K916, silver. Clicking a cell opens that value's history and an Edit action with an optional reason.

**Home screen (PC and Android):** a small "Today's rates" card showing the three applicable rates, or "Today's rate is not set" in amber when any kind is carried forward. Tapping it opens the Rates page.

**Android (view-only, D5):** the Rates page is readable (today's rates and history). Inputs, Save and Edit are hidden.

**Printing:** none. Printed invoices will show the rate used (spec 014).

## 5. Edge cases
- First day ever: no rates, so the applicable answer is `null` for all three, and the home card says "No rates saved yet".
- Only gold entered for today: gold is "saved today", silver is carried forward and flagged.
- Entering yesterday's missing rate after today's invoices exist: allowed, saved invoices unchanged (R9).
- Two devices save the same date and kind at once: the later save is an edit, and the first value is kept as a revision.
- Price typed with spaces, a rupee sign or letters: `₹ 1,20,000` is accepted (symbol and commas removed), anything else non-numeric is rejected.
- More than 2 decimals (`1,20,000.555`) is rejected, not rounded.
- The typo guard compares with the applicable rate, so the first rate ever has nothing to compare with and never prompts.
- Clock near midnight: the date comes from the server in India time, so a page left open overnight still saves for the real date unless the owner picked a date.

## 6. Test cases
Entry conversion (R3, R4):

| Kind | Typed | Stored `price_paise` |
|------|-------|----------------------|
| gold_24k995 | `1,20,000` | 12,000,000 |
| gold_24k995 | `₹ 120000.50` | 12,000,050 |
| silver | `1,50,000` | 15,000,000 |
| silver | `150000.5` | 15,000,050 |
| gold_22k916 | `0` | rejected |
| gold_22k916 | `-5` | rejected |
| gold_22k916 | `1,20,000.555` | rejected |
| gold_22k916 | `abc` | rejected |
| gold_22k916 | `1,00,00,001` | rejected |

Applicable rate (R8, R9), with gold_24k995 saved as ₹1,20,000 on 2026-11-01 and ₹1,22,000 on 2026-11-04:

| Asked for | Result |
|-----------|--------|
| 2026-10-31 | `null` |
| 2026-11-01 | 12,000,000, `rateDate` 2026-11-01, `carriedForward` false |
| 2026-11-03 | 12,000,000, `rateDate` 2026-11-01, `carriedForward` true |
| 2026-11-04 | 12,200,000, `carriedForward` false |
| 2026-11-09 | 12,200,000, `rateDate` 2026-11-04, `carriedForward` true |

Other:
- Per-gram display: 12,000,000 paise per 10 g shows `₹12,000.00`. 15,000,050 paise per kg shows `₹150.00` (R5, display only).
- Edit 24K995 for 2026-11-01 from 12,000,000 to 12,100,000: one revision holds 12,000,000, the audit row lists the old and new price and the reason, and `rate_date` and `id` are unchanged (R10).
- Save the same price again: no revision, no audit row (R10).
- 12,000,000 to 13,500,000 (+12.5%) without confirmation: 409 `needs_confirmation`, nothing saved. With `confirmLargeChange: true`: saved (R12). 12,000,000 to 13,200,000 (exactly +10%): saved without a prompt.
- A future date is 400. An invalid date such as `2026-02-30` is 400 (R6).
- Past date is accepted. "Today" is computed in India time: at 2026-11-01T19:00:00Z (00:30 on 2 Nov in India) saving for `2026-11-02` is accepted and `2026-11-03` is rejected (R7).
- History returns every earlier value, newest first, with who and when (R10, R11).
- `DELETE` on `rates` fails (R11, 001 R9).
- Every route is 401 without a session, and `created_by` is the user id (R13).
- Browser: save three rates, see them on the home card, edit one with a reason and see it in the history, carried-forward warning appears the next day, phone view is read-only.

## 7. Out of scope
Rates for other purities (18K750, 14K, 24K999, others) and how old gold uses a rate (O9, and specs 012 and 018), converting a price into an invoice amount (spec 012), copying the rate onto a saved invoice (013), automatic fetching of market rates from the internet, separate buying and selling rates, rate change alerts or notifications, a rates report.

## 8. Questions for the owner
- Q1. **Units.** Is it right to enter gold per 10 g and silver per 1 kg, as most shops quote? This is the proposed decision D13. It replaces the earlier "rates are paise per gram" note, because a silver price per kg in whole rupees is not a whole number of paise per gram (₹1,50,123 per kg is ₹150.123 per gram). Storing the quoted price keeps every figure exact.
- Q2. **Missing rate.** When today's rate has not been entered yet, should invoicing use the last saved rate and show a warning (proposed, R8), or be blocked until today's rate is entered?
- Q3. **Same-day changes.** Is one rate per kind per day enough? If gold changes at 3 pm, the owner edits today's value and the earlier invoices keep what they used (proposed, R10). The alternative is a separate entry for every change with a time, which is more to enter and to read.

## 9. Acceptance checklist
- [ ] R1 to R13 implemented and tested
- [ ] Migration applied locally, in CI and on the remote database
- [ ] Save, edit, history, typo guard and carried-forward warning work on the live site (PC), and view-only works on Android
- [ ] Nothing in specs 000, 001, 002 and 010 broke
- [ ] Owner approved the result
