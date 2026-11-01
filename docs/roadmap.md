# Roadmap (proposal, awaiting approval)

Each line is one feature spec in `docs/specs/`, built and committed one at a time. Status is tracked in `docs/specs/README.md`.

Phases follow the requirements. Foundation work comes first, and rates come before invoices because invoices read rates.

## Phase 0: Foundation
- 000 Project scaffold, CI, and deploy to Cloudflare (empty app live)
- 001 Database conventions: units, ids, audit and revision framework, migrations
- 002 Owner login and session

## Phase 1: Core billing
- 010 Customers (create, search, edit with history)
- 011 Daily gold and silver rates (date-wise, historical rates preserved)
- 012 Invoice calculation engine (pure and heavily tested; needs O1, O2, O8)
- 013 Invoice create, save, search, edit (revision), void, history
- 014 Invoice print layout: page 1, A4 landscape
- 015 Payment receipts and payment modes (A5 landscape)
- 016 Advances (order reference, partial use, no double count)
- 017 Settlement page and its print page (back side)
- 018 Old gold receipt and four settlement cases (stock/GST posting off per D7)
- 019 Customer ledger

## Phase 2: Inventory
- 020 Inventory categories, items, U No. generation
- 021 Stock movements, and automatic reduction when an invoice is saved
- 022 Purchases and stock inward
- 023 Karigar and job-work management
- 024 Refining and testing (later)

## Phase 3: Dashboard and reports
- 030 Dashboard
- 031 Reports (daily and monthly sales, GST, payments and modes, outstanding, advances, old gold, inventory, purchases, karigar, stock movement)

## Phase 4: Cross-device
- 040 Android responsive layout and PWA install
- 041 Offline queue and sync (needs O6)

## Phase 5: Reliability
- 050 Backups and restore
- 051 Audit history viewer
- 052 Data integrity checks
- 053 Print verification on the real printer

## Notes

- **Invoice items and stock:** in 013, invoice lines get a nullable `inventory_item_id`. Spec 021 turns on the automatic stock reduction without changing invoice calculations or layout.
- **Android is view-only (D5):** sync in phase 4 is mostly reads, so conflict handling is only needed for PC offline writes.
- **Settlement (017)** is a new design, so it gets the most test cases: advances partly used, old gold plus payments, later payments, partial settlement.
- Order inside a phase can change if a dependency or an open question (O1 to O8) demands it.
