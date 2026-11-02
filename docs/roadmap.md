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
| Spec | Name |
|------|------|
| 041 | Offline-first showroom PC, local data, Sync Now, no duplicates. The design is written early in Wave 1 because it affects every module (see risk below). |
| 040 | Android install and phone screens with create and edit by role |
| 023 | Karigar job work (issue, receive, wastage, labour, balance) |
| 025 | Monthly stock reconciliation |
| 050 | Backups: daily to the cloud with versions, manual download, restore. Moved here from Wave 1 by the owner on 2026-11-02. Local PC copy needs Q81. |
| 052 | Data integrity checks |
| 053 | Print verification on the Brother DCP-T830DW |
| 011b | Live IBJA reference rates (needs a provider and key, O10), can move earlier if decided |
| 024 | Refining and testing, later phase, design must leave room (D23) |

## Wave 4: downloadable cross-platform version (after launch)
The same billing software as a desktop app, installed on Windows, macOS or Linux and run on the user's own PC, with no cloud needed. The cloud version keeps running. Full plan: `docs/wave4-plan.md`. Nothing here is built; each spec needs its own draft and the owner's approval first.

| Spec | Name |
|------|------|
| 080 | Database adapter: D1-compatible wrapper over local SQLite; the whole API test suite runs on it first |
| 081 | Local server entry: API and web app on 127.0.0.1, data folder per OS |
| 082 | Local migration runner: applies and records migrations, backs up the database before an upgrade |
| 083 | Desktop shell (Electron): own window, starts and stops the local server, sends no data anywhere |
| 084 | Installers and code signing: Windows first, then macOS (signed, notarised) and Linux |
| 085 | First-run setup: business details, bank details, owner login, number settings, logo |
| 086 | Local backup and restore to a folder the owner picks; restore keeps a copy of the current data (answers Q81 for desktop) |
| 087 | Updates: signed packages, checked at start-up, installed only when the owner agrees |
| 088 | Recovery code shown at setup, to reset the owner password without a command line |
| 089 | Packaged-app tests: the browser suite against the installed app on each platform, plus install, upgrade and uninstall |
| 090 | Local network access over HTTPS for phones and other PCs (optional, only if the owner chooses it, Q112) |

## Risks to watch
- **Offline-first is the biggest risk.** Today the server recalculates and numbers every invoice, so a PC without internet cannot save one. The calculation code is already shared, so the PC can compute locally. What still has to be designed is local storage, issuing numbers while offline (default in Q82: the PC is the numbering authority), conflict-free sync and "Sync Now". A short design spec (041) should be written in Wave 1, and the first proof built early, so later modules are made offline-ready.
- **Users and roles touch every screen**, so spec 004 comes before the payments modules, not after.
- **Local PC backup** cannot be done by a browser alone (Q81).
- **Four months of testing needs a stable build.** Changes during testing are fixes only, and each fix is tested against the reference documents.

## Notes
- **Invoice items and stock:** invoice lines carry a nullable `inventory_item_id` (spec 013). Spec 021 turns on automatic stock reduction without changing invoice calculations or layout.
- **Settlement (017)** is a new design built from the reference page, so it gets the most test cases: advances partly used, old gold plus payments, later payments, partial settlement, never counting a payment twice.
- Order inside a wave can change if an open question (`docs/open-questions.md`) demands it.
