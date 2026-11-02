# 023: Karigar job work (issue, receive, wastage, labour, balance)

Status: Draft for owner review (Wave 3). Built on branch `spec-023-karigar` with the defaults below, so the owner can react to a working build. Owner has not approved the draft yet. Open question Q80 is answered by the defaults in section 8 (`docs/open-questions.md` section AA lists the new questions Q200 to Q209).
Depends on: 021 (stock movements), 021b (places: the seeded Karigar place), 022 (raw gold and silver stock, karigar-made purchases), 004 (permissions), 001 (database, audit)
Owner answers used: [39] karigar-made jewellery, [40] karigar jobs (metal issued, finished goods received, wastage, labour, balance, job-wise and karigar-wise history, partial returns, several deliveries per job), [41] design must leave room for refining and testing later (owner answers 2026-11-01, `docs/owner-answers-2026-11-01.md`). Requirements section 10 (Karigar Management).

## 1. Goal
The shop gives raw gold or silver to a karigar (craftsman) against a job number. The karigar returns finished pieces and the metal he did not use. What is missing is wastage, and the karigar's labour is owed by the shop. The software keeps, for each job and for each karigar, the metal still with him (in milligrams, per purity), the wastage, the labour owed and what has been paid. Metal never leaves the stock records: it moves between the shop's places and the Karigar place (spec 021b), using the raw stock table of spec 022.

## 2. Rules

**Karigars**
- K1. A karigar is a party with a name (required, up to 100 characters) and an optional phone (up to 15 digits and spaces). Optional remarks (up to 300 characters). Created with `karigar.edit`. No delete; no edit screen in this spec (a wrong karigar is corrected by the owner in a later spec). Test data uses fake names and phone numbers only.

**Jobs**
- K2. A job is a document with a number `JOB-0001`, allocated from the series `JOB` for the financial year of the job date, in the same database batch as the job (a failed save uses no number). Numbers restart on each 1 April, as the other document series do.
- K3. Opening a job takes: karigar, job date (business date), source place (an active place, default Showroom), labour basis (`gram` or `piece`), labour rate in paise (per gram or per piece; 0 is allowed), wastage allowance in basis points (0 to 1000, default 200 = 2.00%, Q200), and at least one issue line: metal, purity, weight in whole milligrams (more than 0). Gold purities are 22K916, 24K995, 18K750, 14K and 24K999; silver is silver. A job's labour basis, rate, allowance and source place never change after it is opened.
- K4. Each issue line moves raw metal: the source place goes down, the Karigar place goes up, by the same weight, with the same metal and purity (spec 022 raw stock table). If the source place has less than that, the save is refused (409 `raw_stock_short`) and nothing is written.
- K5. While the job is open, more issue lines may be added later (several deliveries per job, owner answer [40]). Each delivery follows K4 and K3's rules for lines.
- K6. A return takes lines of two kinds: `finished` (purity, pieces at least 1, weight in mg, and the purity tested on the piece, which must equal the purity of the line) and `remainder` (purity and weight in mg: metal given back unused). Partial returns are allowed, any number of times. A return line may not be more than what the karigar still holds on the job for that purity (409 `return_exceeds_holding`, message naming the grams still held). Movement: finished weight goes down from the Karigar place (the metal is now jewellery), remainder goes down from the Karigar place and up at the source place.
- K7. Labour is accrued at each finished line, once, at the rate of the job: `gram` basis = weight (mg) x rate per gram / 1000, rounded to the paisa half up (BigInt, `packages/calc`); `piece` basis = pieces x rate. Remainder lines carry no labour. Labour is not charged on the wastage.
- K8. A tested purity that differs from the line's purity is refused (409 `purity_mismatch`). A purity change is not recorded in this spec (Q206).
- K9. Wastage is the metal not accounted for: for each purity, issued minus finished minus remainder, which equals the metal still held when the karigar is done. Wastage is recognised only when the job is closed. A gain is impossible (a return cannot exceed what is held, K6).
- K10. Closing a job (`close`, one batch): for each purity still held, the held weight is written as a `wastage` entry and taken off the Karigar place, but only when it is within the allowance: held mg <= allowance, where allowance = issued mg x wastage basis points / 10000, rounded half up. A purity over the allowance refuses the close (409 `wastage_over_allowance`, naming the purity, the held and allowed grams) and writes nothing. A job holding nothing closes cleanly. Closing writes an audit row.
- K11. A closed job is never edited. No new issue, return, labour or wastage entry may be added to it (database trigger `job_closed`). The job row itself changes once, from open to closed. A correction is a new entry (kind `adjust`, with a reason). The `adjust` kind is in the table; no screen or route for it is built in this spec (Q209).

**Payments to the karigar**
- K12. A payout is recorded on the karigar, not on a job (so it can settle labour owed on closed jobs too). Amount in paise (more than 0), mode `cash`, `upi`, `bank_transfer` or `cheque`, a business date, optional reference (up to 60 characters: UPI reference, bank UTR, cheque number) and optional remarks. Recorded with `karigar.edit`.
- K13. A payout may not be more than the karigar's labour payable (409 `payout_over_balance`, naming the amount still owed). Overpaying is refused, not recorded as a credit. The check is also a database trigger.
- K14. A payout does not appear in the daily cash closing (spec 032) in this spec (Q204).

**Balances (append-only entries, nothing is edited or deleted)**
- K15. Metal balance of a karigar per metal and purity = issued - finished returned - remainder returned - wastage (+ any `adjust` weight). Per job the same, for that job only. The karigar place of the raw stock (spec 021b `loc-karigar`) holds the same total as all karigars' metal balances added together (an invariant of K4 to K10; tested).
- K16. Labour balance of a karigar in paise = labour accrued (K7) - payouts (K12) (+ any `adjust` amount). Never negative (K13).
- K17. A karigar's statement lists every entry (job, kind, date, metal, purity, weight, pieces, labour, payment) with a running metal balance and the labour balance. A job's statement lists its own entries and its totals per purity: issued, finished, remainder, wastage, held, allowance.

**Who and what is recorded**
- K18. Permissions: `karigar.view` (owner, manager, staff, viewer) reads karigars, jobs, statements and balances. `karigar.edit` (owner and manager only) creates karigars, opens and adds to jobs, records returns, closes jobs and records payouts. Phone: read only (decision D5; the buttons that change are hidden).
- K19. Every save, close and payout writes an audit row (`karigar_job_open`, `karigar_issue`, `karigar_return`, `karigar_close`, `karigar_payout`, `karigar_create`) in the same batch as its change.
- K20. Money is integer paise and weight is integer milligrams. Every calculation is in `packages/calc/src/karigar.ts` (pure, with table tests).

## 3. Data and API

**Data**: migration `0031_karigar_jobs.sql` (hand-written, with the standard columns, `--> statement-breakpoint` separators, same triggers as the other business tables):
- `karigars`: name, phone, remarks. No delete trigger.
- `karigar_jobs`: `job_no` (`JOB-0001`), `fy`, `serial`, `karigar_id`, `job_date`, `source_location_id`, `labour_basis`, `labour_rate_paise`, `wastage_bps`, `remarks`, `status` (`open` or `closed`), `closed_at`, `closed_by`, `close_remarks`. Unique `(fy, job_no)`. No delete. Update allowed only from `open` to `closed`, and only the status and close columns change (trigger `job_locked`).
- `karigar_job_entries` (append-only, triggers refuse update and delete): `karigar_id`, `job_id` (null for payouts), `kind` (`issue`, `return`, `wastage`, `labour`, `payout`, `adjust`), `entry_date`, `at`, `actor`, `part` (`finished` or `remainder`), `metal`, `purity`, `weight_mg`, `pieces`, `tested_purity`, `basis`, `rate_paise`, `amount_paise`, `payment_mode`, `reference`, `location_id`, `reason`. A CHECK per kind gives the required columns. Triggers: an entry on a closed job is refused (`job_closed`); an entry must name the job's own karigar (`invalid_job_entry`); a return or wastage may not take a job's holding below zero (`return_exceeds_holding`); a payout may not take the karigar's labour payable below zero (`payout_over_balance`).
- `raw_metal_movements` gets one nullable column `karigar_entry_id` (ALTER ADD COLUMN, null by default) to link each raw movement to its karigar entry.
- No change to existing rows. The seeded `loc-karigar` place (spec 021b) is used as it is.

**Numbers**: the series `JOB` is not stored in a table of its own: `number_series` takes a new row `('JOB', fy)` through the same `INSERT ... ON CONFLICT` as the other series, and the prefix `JOB-` is in the SQL, as for purchases (`PUR-`). The number settings (spec 003) are not changed. `NUMBER_SERIES` in `packages/calc` and the integrity check of spec 052 (I10) list `JOB`.

**Permissions**: migration `0031` adds `karigar.view` and `karigar.edit` to the `roles` rows: owner and manager get both; staff and viewer get `karigar.view`. `packages/shared/src/permissions.ts` adds both names at the end of the list and to the default roles (staff gets `karigar.view`).

**API** (all under `/api/karigar`):
- `GET /karigars`, `POST /karigars`, `GET /karigars/:id` (karigar, labour balance, metal balances per purity, job list), `GET /karigars/:id/statement`.
- `POST /karigars/:id/payouts` (K12, K13).
- `GET /jobs?karigarId=&status=`, `POST /jobs` (open with issue lines, K3, K4), `GET /jobs/:id` (job, issues, returns, labour, wastage, totals per purity, statement).
- `POST /jobs/:id/issues` (K5), `POST /jobs/:id/returns` (K6, K7, K8), `POST /jobs/:id/close` (K10).
- Permission map: GET routes `karigar.view`, every POST `karigar.edit`. Each route is listed in `apps/api/src/auth/permissionMap.ts` (the permissions test fails otherwise).
- Every POST accepts an optional client `id` and is idempotent (same id and content returns the first result; same id with other content is 409), as the other create endpoints.

## 4. Screens
- **Karigars list** (`#/karigar`): name, phone, metal still with the karigar (per purity, in grams), labour owed. "New karigar" (PC only).
- **Karigar page** (`#/karigar/:id`): phone, balances, jobs (open and closed), the statement with the running balance, and a payout form (PC only: amount, mode, reference).
- **New job** (`#/karigar/jobs/new?karigar=:id`, PC only): karigar, job date, source place, labour basis and rate, wastage allowance in percent, and issue lines (metal, purity, grams).
- **Job page** (`#/karigar/jobs/:id`): job number, karigar, status, issue lines, the returns, labour, wastage, the totals per purity and the statement. PC only, while open: add issue, record return, close (close asks to confirm and shows the held grams and the allowance).
- Phone (390 px): every list and page reads, the forms and buttons are hidden, no sideways scroll.

## 5. Edge cases
- Issue more metal than the source place holds: refused, nothing written (K4).
- A return of metal the karigar does not hold on that job (for example a second return of the same grams): refused (K6).
- A job closed with metal still held beyond the allowance: refused, and the owner records the remaining return first (K10).
- Labour rate 0: labour lines of 0 paise are written, so the statement still shows the pieces.
- Two karigars on the same day: each job has its own balance; the Karigar place total is the sum.
- A karigar-made purchase (spec 022) for the finished pieces: recorded afterwards with its item lines and no `metal_used` line, because the metal left the stock when it was issued (Q205).
- Interrupted save: nothing is written; the id retries as a replay (classifyReplay).

## 6. Test cases
Unit (`packages/calc/src/karigar.test.ts`): labour per gram and per piece with the half-up rounding (exact paise values), allowance rounding, wastage formula, payout balance, refusal of negatives.

API (`apps/api/test/karigar.test.ts`), one test per rule:
- Issue reduces the shop's raw stock at the source place and raises the Karigar place by the same weight (K4).
- A return within the allowance closes cleanly: the held grams are written as wastage, the job is closed, and the Karigar place returns to its previous total (K9, K10).
- Wastage beyond the allowance is refused with 409, nothing is written, and the job stays open (K10).
- Labour per gram: finished 97.000 g at ₹150 per gram gives ₹14,550.00; labour per piece: 3 pieces at ₹200 give ₹600.00 (K7).
- A payout reduces the labour balance; a payout above the balance is refused (K12, K13).
- A closed job is not editable: return, issue, labour and wastage on it are refused, and the job row cannot be updated (K11).
- The statement balances to zero metal and zero labour once the job is closed and the labour is paid (K15, K16, K17).
- Staff and viewer can read and get 403 on every change; the owner and manager can change (K18).
- Job numbers restart each financial year and are unique (K2).
- The permission map covers every new route (`permissions.test.ts`).

Browser (`e2e/karigar.mjs`, appended last in `e2e/run-all.mjs`): buy raw 22K gold through the API, open a job from the karigar page, record a partial return and a remainder, close the job, pay the labour, and see both balances at zero; phone: read only, no sideways scroll.

## 7. Out of scope
Refining and purity testing (Q43, later; the job rows leave room for them). Purity changes on a return (Q206). Adjustment screen for corrections (Q209). Karigar GST and TDS on labour (Q207). Payouts in the daily cash closing (Q204). Creating item U Nos. from the returned pieces (use the karigar-made purchase, Q205). Karigar edit screen. Reports of karigar outstanding in CA reports (report 43 is in spec 031).

## 8. Defaults used (owner may change later)
- Q80 (wastage allowance): a percentage of the issued metal, typed per job, default 2.00% (200 basis points), 10.00% at most. Wastage is recognised at close, not at each return (Q200).
- Q80 (labour basis): per gram of the finished weight, or per piece, chosen per job; the rate is typed per job and fixed for it (Q201).
- Q80 (account): the karigar account runs in both weight (metal held, per purity) and money (labour owed); no value is put on the metal (Q202).
- Wastage formula and rounding: issued minus finished minus remainder; the allowance rounds half up; a held amount equal to the allowance is within it (Q203).
- Payouts: karigar-level, four modes, refused above the labour owed (Q204).

## 9. Acceptance checklist
- [ ] Owner approves this draft and the defaults for Q200 to Q209.
- [ ] K1 to K20 implemented and tested as in section 6.
- [ ] Migration 0031 applied on an empty database in every test (SQLite and D1 backends).
- [ ] `npm run typecheck`, `npx vitest run`, `npm run build` clean; browser suite `e2e/run-all.mjs` passes with `e2e/karigar.mjs` last.
- [ ] `docs/specs/README.md` row for 023 updated; Q80 status in `docs/open-questions.md` set to DEFAULT.

Status line: draft built on branch `spec-023-karigar`, owner review pending.
