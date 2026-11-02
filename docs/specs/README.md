# Feature specs

Process for every feature:

1. Claude writes `NNN-name.md` from `_template.md`.
2. The owner reads it, edits it, and sets `Status: Approved`.
3. Claude builds it, tests it, and commits.
4. The owner checks the result, and the status becomes `Done`.

No code is written for a feature before its spec is Approved. All Wave 1 specs were approved in advance on 2026-11-01 (decision D12). Build order for Wave 1 is in `docs/wave1-plan.md`.

## Index

| Spec | Name | Status |
|------|------|--------|
| 000 | Project scaffold, CI, deploy | Done |
| 001 | Database foundation | Done (owner approved 2026-11-01) |
| 002 | Owner login | Done (owner approved 2026-11-01) |
| 010 | Customers | Done (owner approved 2026-11-01) |
| 011 | Daily gold and silver rates | Built, merged, owner check pending |
| 012 | Invoice calculation engine | Built, merged, owner check pending |
| 013 | Invoices (create, search, edit, void, history) | Built, merged, awaiting deploy and owner check |
| 012b | Job work 9988, polish percent, HSN categories | Built and merged, verified 2026-11-02, owner review pending |
| 003 | Settings, number formats, document headers | Built, checked on `spec-003-leftovers` (PR open, owner check pending); migration tests on old rows still to do |
| 004 | Users, roles and permissions | Built, owner review pending |
| 012c | Discounts, stones and diamonds | Built 2026-11-02, owner review pending |
| 015 | Payments and receipts (the money model) | Built, owner review pending |
| 016 | Orders and advances | Built, owner review pending |
| 018 | Old gold purchase | Built, owner review pending |
| 017 | Settlement | Built, owner review pending |
| 019 | Customer ledger and opening balances | Built, owner review pending |
| 019b | Cheque tracking (Received, Deposited, Cleared, Bounced) | Wave 2, built on PR #29, owner review pending |
| 051 | Audit history viewer (read-only, owner only) | Wave 2, built on branch `spec-051-032-audit-cash`, owner review pending |
| 032 | Daily cash closing (expected cash, count, difference, correction notes) | Wave 2, built on branch `spec-051-032-audit-cash`, owner review pending |
| 019d | Returns, exchanges and credit notes | Wave 2, built on branch `spec-019d-credit-notes`, owner review pending |
| 030 | Dashboard (Home screen, read-only) | Wave 2, built 2026-11-02 on `spec-030-031-dashboard-reports`, owner review pending |
| 031 | Reports in Excel and PDF (sales, payments, outstanding, GST by rate) | Wave 2, built 2026-11-02 on `spec-030-031-dashboard-reports`, owner review pending |
| 020 | Inventory items with individual U No. | Wave 2, built on branch `spec-020-021-inventory`, owner review pending |
| 020b | Bulk quantity items (Tilli and similar) | Wave 2, built on branch `spec-020-021-inventory`, owner review pending |
| 021 | Stock movements and automatic stock reduction on invoices | Wave 2, built on branch `spec-020-021-inventory`, owner review pending |
| 021b | Stock locations and transfers | Wave 2, built on branch `spec-020-021-inventory`, owner review pending |
| 022 | Purchases (finished, raw gold and silver, karigar-made) | Wave 2, built on branch `spec-020-021-inventory`, owner review pending |
| 019c | Credit sales with the rate fixed later (pending rate fixation) | Wave 2, built 2026-11-02 on `spec-019c-rate-fixation`, PR open, owner review pending |
| 014 | Printing (invoice, settlement, receipts) | Wave 1, built 2026-11-02 (PR open), waiting for the owner's printer check |
| 050 | Backups and restore | Wave 3 (moved from Wave 1 on 2026-11-02), approved, not built |
| 080 | Database adapter (D1-compatible over local SQLite) | Wave 4, planned, not started |
| 081 | Local server entry (API and web app on localhost) | Wave 4, planned, not started |
| 082 | Local migration runner with backup before upgrade | Wave 4, planned, not started |
| 083 | Desktop shell (Electron) | Wave 4, planned, not started |
| 084 | Installers and code signing (Windows, macOS, Linux) | Wave 4, planned, not started |
| 085 | First-run setup | Wave 4, planned, not started |
| 086 | Local backup and restore | Wave 4, planned, not started |
| 087 | Updates (owner approves) | Wave 4, planned, not started |
| 088 | Owner recovery code | Wave 4, planned, not started |
| 089 | Packaged-app tests | Wave 4, planned, not started |
| 090 | Local network access over HTTPS (optional) | Wave 4, planned, not started |

The full list is in `docs/roadmap.md`.
