# Roadmap

Each line is one feature spec in `docs/specs/`, built and committed one at a time. Status is tracked in `docs/specs/README.md`. Re-planned on 2026-11-01 after the owner's questionnaire answers (`docs/owner-answers-2026-11-01.md`) and reference documents (`docs/reference-formats.md`).

## Dates that drive the order
- **About 1 December 2026:** four months of parallel testing begin next to the existing billing system (owner answers 51 to 53, decision D28).
- **1 April 2027:** the new system becomes the main one.
- The testing months only help if the core billing flow is ready on the first day. So the work is ordered in three waves, and each wave ends with something the owner can test with the real printer.

## Done
| Spec | Name |
|------|------|
| 000 | Scaffold, CI, deploy |
| 001 | Database foundation |
| 002 | Owner login |
| 010 | Customers |
| 011 | Daily gold and silver rates |
| 012 | Invoice calculation engine and Calculator screen |
| 013 | Invoices (save, search, edit with history, void) |

## Wave 1: ready for the first day of testing (target: end of November)
Everything needed to make a real bill, print it on the Brother, take the money and settle it.

| Spec | Name | Notes |
|------|------|-------|
| 012b | Job work 9988, polish percent, HSN categories | Answers 4, 5, 8 are complete. Written, ready to build. |
| 012c | Discounts, stones and diamonds | Needs Q68 and Q69, with safe defaults. |
| 003 | Settings: business details, bank details, terms, cash limit, number formats | The invoice header and footer come from here. GSTIN and bank details are typed in, never committed. |
| 004 | Users, roles and permissions | Staff and family testers need their own logins from day one (D24). Needs Q67, default role set meanwhile. |
| 014 | Invoice print (A4, duplex) and the settlement page on the back | From the reference PDF. Needs Q63. |
| 015 | Payments: receipts `PAY-`, modes, several invoices, oldest-first allocation, cash-limit warning | A5 receipt printing. |
| 016 | Orders and advances, opening advances, cancellation (transfer or refund) | `ORD-` references. |
| 018 | Old gold purchase `OGP-`, linked or standalone | A5 receipt, advance created as a `PAY-` receipt. |
| 017 | Settlement | Pulls in payments, advances and old gold, balance due. Needs Q66 if the HTML file arrives. |
| 019 | Customer ledger and opening balances | Both directions. |

## Wave 2: during testing (December and January)
| Spec | Name |
|------|------|
| 019b | Cheque tracking (Received, Deposited, Cleared, Bounced) with automatic reversal |
| 019c | Credit sales with the rate fixed later (pending rate fixation) |
| 019d | Returns, exchanges and credit notes |
| 020 | Inventory items, individual U No., pairs |
| 020b | Bulk quantity items such as Tilli |
| 021 | Stock movements, automatic reduction on invoice |
| 021b | Stock locations and transfers |
| 022 | Purchases: three types |
| 030 | Dashboard (today's sales, payments today, outstanding, advances, advances today, monthly summaries) |
| 031 | Reports in Excel and PDF, by date and financial year |
| 032 | Daily cash closing |
| 051 | Audit history viewer |

## Wave 3: before launch (February and March)
Built fastest first. Each spec gets a draft and the owner's approval before it is built.

| Spec | Name |
|------|------|
| 052 | Data integrity checks (fastest: checks on the stored data, no new screens) |
| 025 | Monthly stock reconciliation (uses the inventory and stock work from Wave 2) |
| 023 | Karigar job work (issue, receive, wastage, labour, balance); open question Q80 |
| 011b | Live IBJA reference rates; needs a provider and key (O10), so it waits until those are decided |
| 053 | Print verification on the Brother DCP-T830DW: a manual printer check by the owner, not a build |

## Downloadable desktop version: a separate project (moved 2026-11-02)
The downloadable cross-platform version is not part of this repository any more. It will be a separate project in its own repository, forked from this one. This repository is the final web-based product.

What moves to the desktop project: the Wave 4 plan (`docs/wave4-plan.md`), specs 083 to 090 (desktop shell, installers, first-run setup, local backup and restore, updates, recovery, packaged-app tests, optional network access). The local database adapter, local server and migration runner (specs 080 to 082) are already in this repository and are the base the desktop project starts from.

## Risks to watch
- **Offline-first is the biggest risk.** Today the server recalculates and numbers every invoice, so a PC without internet cannot save one. The calculation code is already shared, so the PC can compute locally. What still has to be designed is local storage, issuing numbers while offline (default in Q82: the PC is the numbering authority), conflict-free sync and "Sync Now". A short design spec (041) should be written in Wave 1, and the first proof built early, so later modules are made offline-ready.
- **Users and roles touch every screen**, so spec 004 comes before the payments modules, not after.
- **Local PC backup** cannot be done by a browser alone (Q81).
- **Four months of testing needs a stable build.** Changes during testing are fixes only, and each fix is tested against the reference documents.

## Notes
- **Invoice items and stock:** invoice lines carry a nullable `inventory_item_id` (spec 013). Spec 021 turns on automatic stock reduction without changing invoice calculations or layout.
- **Settlement (017)** is a new design built from the reference page, so it gets the most test cases: advances partly used, old gold plus payments, later payments, partial settlement, never counting a payment twice.
- Order inside a wave can change if an open question (`docs/open-questions.md`) demands it.
