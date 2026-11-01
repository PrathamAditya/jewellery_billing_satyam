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
| 012b | Job work 9988, polish percent, HSN categories | Built on `wave-1`, verification and owner review pending |
| 003 | Settings, number formats, document headers | API and numbering built; settings screen and print-header snapshot tests still to do |
| 004 | Users, roles and permissions | Built, owner review pending |
| 012c | Discounts, stones and diamonds | Wave 1, approved, not built |
| 015 | Payments and receipts (the money model) | Built, owner review pending |
| 016 | Orders and advances | Built, owner review pending |
| 018 | Old gold purchase | Built, owner review pending |
| 017 | Settlement | Built, owner review pending |
| 019 | Customer ledger and opening balances | Built, owner review pending |
| 014 | Printing (invoice, settlement, receipts) | Wave 1, built 2026-11-02 (PR open), waiting for the owner's printer check |
| 050 | Backups and restore | Wave 3 (moved from Wave 1 on 2026-11-02), approved, not built |

The full list is in `docs/roadmap.md`.
