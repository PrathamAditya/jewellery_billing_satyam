# 011: Daily gold and silver rates

Status: Building (owner approved 2026-11-01, with the two proposed defaults in section 8)
Depends on: 000, 001, 002
Open questions: none block this spec. Section 8 has the owner's answers and two points to confirm. Adds O9 (blocks 012 and 018) and O10 (blocks 011b) to `docs/decisions.md`.

## 1. Goal
The owner types the day's rates: 24K995 gold, 22K916 gold and silver, per kg or per gram, and sees both figures. Every later feature asks "what is the applicable rate for this date?" and gets one clear answer. Invoices use only the rate the owner typed. Past rates are kept forever, and changing a rate never touches an invoice that was already saved (the saved invoice keeps its own copy, see CLAUDE.md rule 5).

Live IBJA rates fetched from the internet are a separate spec (011b). They will be shown as a reference and can pre-fill the typing box, but they never go onto an invoice unless the owner saves them as the day's rate.

## 2. Rules

**What is stored**
- R1. Three rate kinds: `gold_24k995`, `gold_22k916`, `silver`. No other kinds in this spec (see O9).
- R2. One rate per kind per business date (India date). The business date is `YYYY-MM-DD`.
- R3. Every rate is stored as whole paise **per 1 kg** (`price_paise_per_kg`), for gold and silver alike. The owner may type it **per kg or per gram** (a switch on each row). Typing is in rupees, commas and a rupee sign allowed (`1,20,00,000` or `₹ 12,000`). Per kg allows up to 2 decimals. Per gram allows up to 3 decimals, which is always an exact number of paise per kg (`150.123` per gram is `₹1,50,123` per kg). The conversion uses whole-number arithmetic with no floats, and more decimals than allowed are rejected, never rounded.
- R4. A price must be greater than 0 and at most ₹10,00,00,000 per kg (₹1,00,000 per gram). Anything else is rejected with a clear message.
- R5. The screen always shows both figures for each rate, per kg and per gram (`₹12,000.00 per gram`, `₹1,20,00,000 per kg`). The per-gram figure is display only and is shown with 2 to 3 decimals. How later specs turn a price into an amount is decided in spec 012: they multiply weight in mg by the price and divide by 1,000,000 mg, and round once with the single rounding function.

**Dates**
- R6. A rate can be saved for today or any earlier date. Future dates are rejected. Past dates are allowed (to enter old data) and the screen asks "This is not today's date. Save anyway?".
- R7. "Today" always means the India date, never the browser or server date.

**Applicable rate**
- R8. The applicable rate for a kind on a date is the rate saved for that exact date. If there is none, it is the most recent rate saved for an earlier date, marked `carriedForward: true` with its `rateDate`. If nothing exists on or before that date, there is no applicable rate (`null`). This is the only lookup later features use (see "To confirm (1)" in section 8).
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
- `rate_date` (`YYYY-MM-DD`), `kind` (one of R1, checked), `price_paise_per_kg` (integer, `CHECK (price_paise_per_kg > 0)`)
- unique `(rate_date, kind)`, and an index on `(kind, rate_date)` for the "latest before" lookup.

The unit is one constant in `packages/shared` (used by the screens and the API, and later by `packages/calc`): `RATE_UNIT_MG = 1_000_000` (1 kg). The typing, conversion and display helpers live beside it and are tested.

API (all under `/api/rates`):
- `GET /applicable?date=YYYY-MM-DD` (date defaults to today): the three applicable rates per R8.
- `GET /?before=YYYY-MM-DD&limit=30`: saved rows grouped by date, newest first, starting from today (or the day before `before`), with a cursor for older ones.
- `PUT /:date/:kind` body `{ price: "12,000", unit: "gram" | "kg", reason?, confirmLargeChange? }`: create or edit. 201 on create, 200 on edit or no-op.
- `GET /:date/:kind/history`: the earlier values with who changed them and when.

## 4. Screens and printing
**PC: Rates page** (new "Rates" link in the top bar)
- Top card "Rates for today (date)": three rows (24K995, 22K916, Silver). Each row has an input with a "per gram | per kg" switch, both figures shown live as the owner types, and either "saved today" or "from 1 Nov (not set today)".
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
- Price typed with spaces or a rupee sign: `₹ 12,000` is accepted (symbol and commas removed), anything else non-numeric is rejected.
- More decimals than R3 allows is rejected, not rounded.
- The typo guard compares with the applicable rate, so the first rate ever has nothing to compare with and never prompts.
- Clock near midnight: the date comes from the server in India time, so a page left open overnight still saves for the real date unless the owner picked a date.

## 6. Test cases
Entry conversion (R3, R4):

| Kind | Typed | Unit | Stored `price_paise_per_kg` |
|------|-------|------|-----------------------------|
| gold_24k995 | `12,000` | gram | 1,200,000,000 |
| gold_24k995 | `1,20,00,000` | kg | 1,200,000,000 |
| gold_22k916 | `₹ 11,000.5` | gram | 1,100,050,000 |
| silver | `150` | gram | 15,000,000 |
| silver | `150.123` | gram | 15,012,300 |
| silver | `1,50,123` | kg | 15,012,300 |
| silver | `1,50,123.45` | kg | 15,012,345 |
| silver | `150.1234` | gram | rejected (more than 3 decimals) |
| silver | `1,50,000.555` | kg | rejected (more than 2 decimals) |
| gold_22k916 | `0` or `-5` or `abc` | either | rejected |
| gold_22k916 | `1,00,00,001` | kg | rejected (above the limit) |
| gold_22k916 | `1,00,001` | gram | rejected (above the limit) |

Applicable rate (R8, R9), with gold_24k995 saved as ₹12,000 per gram on 2026-11-01 and ₹12,200 per gram on 2026-11-04:

| Asked for | Result |
|-----------|--------|
| 2026-10-31 | `null` |
| 2026-11-01 | 1,200,000,000, `rateDate` 2026-11-01, `carriedForward` false |
| 2026-11-03 | 1,200,000,000, `rateDate` 2026-11-01, `carriedForward` true |
| 2026-11-04 | 1,220,000,000, `carriedForward` false |
| 2026-11-09 | 1,220,000,000, `rateDate` 2026-11-04, `carriedForward` true |

Other:
- Display (R5): 1,200,000,000 paise per kg shows `₹12,000.00 per gram` and `₹1,20,00,000 per kg`. 15,012,300 shows `₹150.123 per gram`.
- Edit 24K995 for 2026-11-01 from 1,200,000,000 to 1,210,000,000: one revision holds 1,200,000,000, the audit row lists the old and new price and the reason, and `rate_date` and `id` are unchanged (R10).
- Save the same price again: no revision, no audit row (R10).
- 1,200,000,000 to 1,350,000,000 (+12.5%) without confirmation: 409 `needs_confirmation`, nothing saved. With `confirmLargeChange: true`: saved (R12). 1,200,000,000 to 1,320,000,000 (exactly +10%): saved without a prompt.
- A future date is 400. An invalid date such as `2026-02-30` is 400 (R6).
- Past date is accepted. "Today" is computed in India time: at 2026-11-01T19:00:00Z (00:30 on 2 Nov in India) saving for `2026-11-02` is accepted and `2026-11-03` is rejected (R7).
- History returns every earlier value, newest first, with who and when (R10, R11).
- `DELETE` on `rates` fails (R11, 001 R9).
- Every route is 401 without a session, and `created_by` is the user id (R13).
- Browser: switch a row between per gram and per kg and see both figures update, save three rates, see them on the home card, edit one with a reason and see it in the history, carried-forward warning appears the next day, phone view is read-only.

## 7. Out of scope
Rates for other purities (18K750, 14K, 24K999, others) and how old gold uses a rate (O9, and specs 012 and 018), converting a price into an invoice amount (spec 012), copying the rate onto a saved invoice (013), fetching live IBJA rates from a paid service and showing them (spec 011b, needs O10), separate buying and selling rates, rate change alerts or notifications, a rates report.

## 8. Owner answers (2026-11-01) and points to confirm
- Q1. Units: **both gold and silver in kg and gram**. Built as R3 and R5 (stored per kg, typed per kg or per gram, both shown). Gold is not typed per 10 g.
- Q2. Rates on invoices: **only the rate the owner types**. Live rates never go on an invoice by themselves.
- Q3. Live rates: **fetched from a paid IBJA rate service and displayed on the website**. This is spec 011b, not this spec, because it needs a provider and an API key first (O10).
- To confirm (1). **Today's rate not typed yet.** The owner asked to "display the fresh rate live" in that situation. Until 011b exists, this spec uses the last typed rate and shows an amber "Today's rate is not set" warning (R8). Once 011b exists, the live IBJA rate is shown next to that warning with a "Use this rate" button that fills the typing box. Invoices still do not use it until it is saved. Say if you want invoicing blocked instead.
- To confirm (2). **Changes during the day.** "Live rates daily" is read as one typed rate per kind per day. A change in the afternoon is an edit, the old value stays in the history, and earlier invoices keep what they used (R10). Say if you want a separate timed entry for every change.

## 9. Acceptance checklist
- [ ] R1 to R13 implemented and tested
- [ ] Migration applied locally, in CI and on the remote database
- [ ] Save, edit, history, typo guard and carried-forward warning work on the live site (PC), and view-only works on Android
- [ ] Nothing in specs 000, 001, 002 and 010 broke
- [ ] Owner approved the result
