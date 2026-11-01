# Decisions

Locked decisions are changed only by editing this file in a commit that says why.

## Locked

| # | Topic | Decision | Date |
|---|-------|----------|------|
| D1 | Baseline | Fresh build. No v84 reference file exists. Settlement behaviour is designed from `requirements.md` section 7 and pinned down in its own feature spec. | 2026-11-01 |
| D2 | Customer | One showroom (single client). No tenant/shop ID in the schema. | 2026-11-01 |
| D3 | Hosting | Cloudflare Workers (+ static assets) and D1. | 2026-11-01 |
| D4 | Offline | PWA with a local queue (IndexedDB outbox). Client-generated IDs make sync idempotent. | 2026-11-01 |
| D5 | Android v1 | View-only dashboard: dashboard, recent invoices and payments, invoice search, customer balances, inventory. All billing and printing is on PC. | 2026-11-01 |
| D6 | Users | One owner login. Every record still carries `created_by` / `updated_by` so roles can be added later without a migration. | 2026-11-01 |
| D7 | Old gold (CA pending) | Build the receipt, the amount calculation and all four settlement cases now. Stock inward and GST/ledger posting sit behind a clearly marked setting until the CA decides. | 2026-11-01 |
| D8 | E-invoice | Not needed. Normal GST invoice only. The invoice model stays e-invoice-ready (GSTIN, HSN, tax split per line). | 2026-11-01 |
| D9 | Repo | `jewellery_billing_satyam`, private, on GitHub account PrathamAditya. | 2026-11-01 |
| D10 | Printing | Browser print with CSS `@page`. PDF export may come later as its own feature. | 2026-11-01 |
| D11 | Numbering | Financial-year series, reset each 1 April: `INV/2026-27/0001`, `PR/2026-27/0001`, `OG/2026-27/0001`. | 2026-11-01 |
| D12 | Workflow | One feature at a time: spec, user approves, build, test, commit. No code before the spec is approved. | 2026-11-01 |

## Open (must be answered before the spec that needs it)

| # | Question | Blocks spec | Who |
|---|----------|-------------|-----|
| O1 | HSN 9988 job-work calculation: what exactly is the "specified job-work calculation"? Provide a worked example (inputs and expected amount, GST and display rate). | Invoice calculation engine | Owner |
| O2 | Is "Polish / wastage" entered as a percentage of net weight or as grams? Is it per line? | Invoice calculation engine | Owner |
| O3 | Old gold: accounting and GST treatment, and which inventory bucket it lands in. | Old gold (stock/GST posting only) | CA |
| O4 | Showroom details for the invoice header: legal name, address, GSTIN, phone, bank details, terms text, BIS logo file, logo/branding. | Invoice print layout | Owner |
| O5 | Brother printer model, and whether it does automatic duplex. | Print layouts | Owner |
| O6 | Offline invoice numbering: reserve number blocks while online, or use an offline-only series? | Offline queue and sync | Decide in that spec |
| O7 | Login method for the single owner: password plus session cookie, or Cloudflare Access? | Auth | Closed 2026-11-01: own login, username + password + session cookie (spec 002) |
| O8 | GST registration facts: composition vs regular scheme, state code for CGST/SGST vs IGST. | Invoice calculation engine | Owner / CA |
