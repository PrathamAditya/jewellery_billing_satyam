# Decisions

Locked decisions are changed only by editing this file in a commit that says why.

## Locked

| # | Topic | Decision | Date |
|---|-------|----------|------|
| D1 | Baseline | Fresh build. No v84 reference file exists. Settlement behaviour is designed from `requirements.md` section 7 and pinned down in its own feature spec. The four reference PDFs (`docs/reference-formats.md`) now define the printed settlement page. The owner's answers still call v84 "the reference": the HTML file is requested in Q66. | 2026-11-01 |
| D2 | Customer | One showroom (single client). No tenant/shop ID in the schema. | 2026-11-01 |
| D3 | Hosting | Cloudflare Workers (+ static assets) and D1. | 2026-11-01 |
| D4 | Offline | PWA with a local queue (IndexedDB outbox). Client-generated IDs make sync idempotent. **Widened by D25 on 2026-11-01**: the showroom PC must be offline-first, not just queue writes. | 2026-11-01 |
| D5 | Android v1 | ~~View-only dashboard.~~ **Superseded 2026-11-01 by D24**: the owner wants Android to view and, where the role allows, create and edit. Until the permission system exists (spec 004), phone screens stay read-only. | 2026-11-01 |
| D6 | Users | ~~One owner login.~~ **Superseded 2026-11-01 by D24**: separate logins for owner, family and staff with role-based permissions. The `users.role` column and the `created_by` / `updated_by` ids already exist, so this needs no rewrite. | 2026-11-01 |
| D7 | Old gold (CA pending) | Build the receipt, the amount calculation and all four settlement cases now. Stock inward and GST/ledger posting sit behind a clearly marked setting until the CA decides. | 2026-11-01 |
| D8 | E-invoice | Not needed. Normal GST invoice only. The invoice model stays e-invoice-ready (GSTIN, HSN, tax split per line). | 2026-11-01 |
| D9 | Repo | `jewellery_billing_satyam`, private, on GitHub account PrathamAditya. | 2026-11-01 |
| D10 | Printing | Browser print with CSS `@page`. PDF export may come later as its own feature. | 2026-11-01 |
| D11 | Numbering | Separate series for invoices, payment receipts and old gold receipts, each reset every 1 April (confirmed by the owner, answer 18). **Printed format changes 2026-11-01** to the existing system's: `INV-0001`, `PAY-0001`, `OGP-0001`, plus `ORD-0001` for orders (see `docs/reference-formats.md`). The financial year is stored with each number, so the pair is unique. Pending the owner's confirmation in Q61. | 2026-11-01 |
| D12 | Workflow | One feature at a time: spec, user approves, build, test, commit. No code before the spec is approved. **Amended 2026-11-01:** the owner approved all Wave 1 specs in advance, with the defaults written in them, so Wave 1 is built in one run without waiting for approval per spec. Later waves go back to approval per spec. | 2026-11-01 |
| D13 | Job work HSN 9988 | Job-work amount = `((Net + Polish) x (Gold rate + Labour rate)) - (Net x Gold rate)`, GST 5%, display rate = amount / (Net + Polish). No other labour calculation. (Owner answer 4.) | 2026-11-01 |
| D14 | Polish | Entered as a percentage of net weight. `Polish weight = Net weight x percent`, shown in the Wastage column. (Owner answer 5.) | 2026-11-01 |
| D15 | HSN and GST | Only two categories: jewellery HSN 7113 at 3% and job work HSN 9988 at 5%. Regular GST scheme, Himachal Pradesh (code 02), CGST + SGST within the state, IGST outside it. HUID is not printed. BIS logo optional, purity always visible. (Answers 8, 12, 13, 14.) | 2026-11-01 |
| D16 | Labour, discounts, stones | Labour rate typed per gram per row. Discounts on gold, on labour and on the total, each fixed rupees or percent. Stones and diamonds billed either separately or combined, chosen per item. Rules for the last two are designed in spec 012c. (Answers 6, 9, 10.) | 2026-11-01 |
| D17 | Printing | Brother DCP-T830DW with automatic duplex, plain paper, whole design printed. Invoice on A4 with the settlement page on the back. Payment and old gold receipts A5 landscape on A4 to cut. **The invoice is A4 portrait** (owner, 2026-11-01, Q63, matching the sample PDF), with the settlement page on the back. (Answers 16, 17.) | 2026-11-01 |
| D18 | Payments | Several advances per order, each with its own receipt, opening advances from old booklets, only the used amount is deducted. One payment may cover several invoices (manual, else oldest first). Order cancellation: transfer to the customer's account or refund. Cheque statuses Received, Deposited, Cleared, Bounced with automatic reversal on a bounce. Cash limit is a configurable warning, never a block. (Answers 19 to 24.) | 2026-11-01 |
| D19 | Credit sales | Credit sale with the rate fixed later ("pending rate fixation", priced at the rate of the payment day) is a separate kind of sale from normal credit with a fixed amount. (Answer 22.) | 2026-11-01 |
| D20 | Returns | Credit note, or a new invoice adjusted against the old one, or old gold adjustment, chosen per case, always linked to the original invoice. (Answer 25.) | 2026-11-01 |
| D21 | Old gold | `Amount = Net weight x Purity % x Rate`. Purity percentage and rate are typed on each receipt, 22K and 24K, linked to an invoice or standalone. No stock or GST posting until the CA decides (confirms D7). (Answers 27 to 30.) | 2026-11-01 |
| D22 | Customers | Fresh customer list, no import. Shared mobile numbers allowed. PAN and Aadhaar optional. Opening balances in both directions, not counted as sales or payments. (Answers 31 to 34.) | 2026-11-01 |
| D23 | Inventory | Individual items with a unique U No. (pairs as one), bulk quantity items such as Tilli, configurable locations with transfers, monthly stock reconciliation, three purchase types, full karigar job workflow. Refining and testing later, but the design must leave room. (Answers 35 to 41.) | 2026-11-01 |
| D24 | Users and devices | Separate logins for owner, family and staff with role-based permissions and per-user activity history, the same permissions on PC and Android, Android can create and edit where the role allows. Access from outside the showroom. Supersedes D5 and D6. (Answers 45, 46, 48.) | 2026-11-01 |
| D25 | Offline-first | The showroom PC works fully without internet (invoices, receipts, old gold), keeps its data locally, synchronises when online, has a manual "Sync Now", and must not create duplicates or lose data. Widens D4. (Answer 47.) | 2026-11-01 |
| D26 | Backups | Automatic daily backups to the cloud and to the local PC, manual download, full restore, several versions. (Answer 49.) | 2026-11-01 |
| D27 | Reports and closing | Dashboard: today's sales, payments today, outstanding, advances, advances today, plus monthly summaries. CA reports in Excel and PDF filtered by date and financial year. Daily cash closing with history. (Answers 42 to 44.) | 2026-11-01 |
| D28 | Rollout | Four months of parallel testing next to the existing system from about 1 December 2026, full use from 1 April 2027. The old systems are not switched off until the new one is fully tested. (Answers 50 to 53.) | 2026-11-01 |

## Open (must be answered before the spec that needs it)

The full list, with the papers to bring, is in `docs/open-questions.md`.

| # | Question | Blocks spec | Who |
|---|----------|-------------|-----|
| O1 | HSN 9988 job-work calculation. **Closed 2026-11-01** by owner answer 4 (decision D13). The engine is updated in spec 012b. | Invoice calculation engine | Closed |
| O2 | Polish / wastage as grams or percent. **Closed 2026-11-01**: percentage of net weight (D14). | Invoice calculation engine | Closed |
| O3 | Old gold: accounting and GST treatment, and which inventory bucket it lands in. | Old gold (stock/GST posting only) | CA |
| O4 | Showroom details for the invoice header: legal name, address, GSTIN, phone, bank details, terms text, BIS logo file, logo/branding. **Partly answered 2026-11-01** from the client's invoice (name, address, state code, terms text, layout: see `docs/client-invoice-reference.md`). Still needed: GSTIN, PAN, phones and bank details (entered in Settings, never committed), BIS logo file, any logo. | Invoice print layout | Owner |
| O5 | Printer. **Closed 2026-11-01**: Brother DCP-T830DW, automatic duplex (D17). | Print layouts | Closed |
| O6 | Offline numbering. **Widened 2026-11-01** by D25 (offline-first PC). Proposed default: the showroom PC is the numbering authority while offline, phones create numbered documents only when online. To be confirmed in the offline design spec (041). | Offline and sync | Decide in 041 |
| O7 | Login method for the single owner: password plus session cookie, or Cloudflare Access? | Auth | Closed 2026-11-01: own login, username + password + session cookie (spec 002) |
| O8 | GST registration facts. **Closed 2026-11-01** by owner answer 12 (D15): regular scheme, Himachal Pradesh code 02, CGST + SGST within the state, IGST outside. | Invoice calculation engine | Closed |
| O9 | Which rate applies to other purities. **Closed 2026-11-01** in practice: the gold rate is typed on every line (labour separately), the daily rates only prefill 24K995, 22K916 and silver (as built in spec 013). Old gold has its own typed purity percentage and rate (D21). | Invoice calculation engine, old gold | Closed |
| O10 | Paid IBJA rate service for live reference rates: which provider (for example Surepass, price on request), the monthly cost the owner accepts, and an API key. IBJA publishes about 12:05 pm and 5:05 pm, so "live" means twice a day. The key is stored as a Cloudflare secret, never in git. | Live IBJA rates (011b) | Owner |
| O11 | The existing HTML billing system (answers 50 and critical instruction 3 call its settlement "v84"): can the HTML file be shared (with test data only) so its calculations and settlement behaviour are copied exactly? Decision D1 says no v84 file exists. | Settlement (017), print (014) | Owner |
| O12 | Roles and permissions: which roles exist (owner, family, staff, others?) and what each may do, module by module. | Users and roles (004) | Owner |
| O13 | Design of discounts and stones/diamonds (D16): how each is entered, which amounts they reduce, and how GST is worked out after them. Proposals are in spec 012c. | Spec 012c | Owner |
| O14 | How the automatic daily backup reaches the local PC (a browser cannot write files by itself). Options in spec 050. | Backups (050) | Owner |
