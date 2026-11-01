# 010: Customers

Status: Done (live and owner approved 2026-11-01)
Depends on: 000, 001, 002
Open questions: none. The owner answered Q1 to Q3 on 2026-11-01 (section 8).

## 1. Goal
The owner can create, search, view and edit customers. Later features (invoice, receipt, old gold, ledger) pick a customer by searching here and load the details automatically. Editing never loses the old details.

This spec also builds the safe-retry create helper that spec 001 left for the first feature that needs it (see 001 R5).

## 2. Rules

**Fields**
- R1. A customer has: name (required), mobile, alternate mobile, address, city, PIN code, PAN, Aadhaar, notes. Only the name is required, because walk-in customers are common. Everything else may be blank.
- R2. Each customer has a short customer number `C-0001`, `C-0002`, and so on. It is shown on screen and in search. It never resets, is never reused, and does not depend on the financial year. The internal id stays the UUIDv7 from spec 001 R5.
- R3. Name is trimmed, inner spaces collapsed, and 2 to 100 characters. Mobile is stored as 10 digits. On input, spaces, dashes, a leading `+91`, `91` or `0` are removed. Anything that is not 10 digits after that is rejected with a clear message.
- R4. PAN is uppercased and must match `AAAAA9999A`. Aadhaar is 12 digits (spaces allowed on input, stored without them). PIN code is 6 digits.

**Duplicates**
- R5. Two customers may share a mobile number (a family often shares one phone), so the mobile is not unique. When saving a new customer whose mobile already belongs to someone else, the screen shows those customers first and asks "Use existing" or "Save as new anyway". The API reports the clash as a warning in the response and does not block, so the screen decides.
- R6. A PAN, if entered, is unique among customers that are not voided. A duplicate PAN is rejected with 409 and names the existing customer.
- R7. Creating with the same client id and the same content returns the existing record (200). The same id with different content returns 409 (001 R5).

**Search**
- R8. One search box matches, case-insensitively: customer number, any part of the name, any part of the mobile (3 or more digits), and the PAN. Results are sorted with exact matches first, then by name. Maximum 20 results per page, with a "next page" cursor.
- R9. Search must stay fast with 20,000 customers (indexes on name, mobile, PAN).

**Editing and history**
- R10. An edit stores the previous version in `record_revisions` (001 R10) with a short reason (optional text) and then updates the customer. The customer id and number never change. Every edit also writes an audit row (001 R11) in the same batch.
- R11. The history view shows each revision with date, who changed it, and which fields changed.
- R12. Saved invoices, receipts and old-gold receipts keep a copy of the name, mobile, address and PAN as they were when saved. Editing a customer later does not change those documents. (This spec only states the rule. The copy is made by the invoice spec, 013.)

**Void instead of delete**
- R13. A customer can be voided with a reason (001 R9). A voided customer is hidden from search by default, can be shown with a "Show voided" switch, and can be restored. A customer who has any invoice, receipt or advance cannot be voided. This check is added when those specs arrive and is tested in each of them.

**Privacy**
- R14. Aadhaar is shown masked (`XXXX XXXX 1234`) everywhere. The full number is shown only after pressing "Show", and each time it is shown an audit row is written. Aadhaar is never printed unless a later spec says so, and is never included in search, in logs, or in the audit `detail_json` (it is recorded only as "aadhaar changed").
- R15. All routes need a login (spec 002). `created_by` and `updated_by` carry the real user id.

## 3. Data
New tables (migration follows spec 001 conventions, including the no-delete trigger):
- `customers`: standard columns (`id`, `created_at`, `created_by`, `updated_at`, `updated_by`), `customer_no` (unique), `name`, `name_search` (lowercase copy for search), `mobile`, `alt_mobile`, `address`, `city`, `pincode`, `pan`, `aadhaar`, `notes`, `voided_at`, `voided_by`, `void_reason`.
- Indexes: `customer_no`, `name_search`, `mobile`, `pan` (unique where `pan` is not null and `voided_at` is null).
- Number allocation: a new series `C` in `number_series` with a fixed financial-year value `all`, so the number never resets. `allocateNumber` is extended for this one non-FY series, with its own test.

API (all under `/api/customers`):
- `POST /` create (with client id), `GET /` search or list, `GET /:id`, `PATCH /:id` edit, `GET /:id/history`, `POST /:id/void`, `POST /:id/restore`, `POST /:id/aadhaar/reveal`.

## 4. Screens and printing
**PC**
- Customers list with the search box on top, the results table (number, name, mobile, city), and a "New customer" button.
- Customer form (create and edit): the R1 fields, inline validation messages from R3 and R4, and the duplicate-mobile prompt from R5.
- Customer page: details, Edit, History tab, Void or Restore. A "Ledger" tab placeholder says "Coming with the ledger feature" and does nothing.
- Reusable customer picker component (search as you type, pick, or "Add new customer"). Spec 013 uses it. It is built and tested here on its own.

**Android (view-only, D5):** the list, search and customer page are readable and responsive. The Edit, New, Void and Restore buttons are hidden.

**Printing:** none.

## 5. Edge cases
- Walk-in customer with only a name: saved, no mobile prompts.
- Two customers named "Ramesh Kumar": allowed. They are told apart by number and mobile in search results.
- Mobile typed as `+91 98765 43210`: stored as `9876543210`.
- Pasted text with trailing spaces or line breaks: cleaned.
- Voided customer's PAN can be used again on a new customer. Restoring the old one then fails with 409 until the clash is resolved.
- Create sent twice by a flaky connection: one customer (R7).
- Offline: creating or editing a customer needs a connection in this spec. Offline queue and sync arrive in spec 041, and the client-generated id already makes that safe.
- Searching with only 1 or 2 digits: matches by name and number only, to avoid noisy results.

## 6. Test cases
Mobile cleaning (R3):

| Input | Stored |
|-------|--------|
| `9876543210` | `9876543210` |
| `+91 98765-43210` | `9876543210` |
| `098765 43210` | `9876543210` |
| `98765` | rejected: "Mobile must be 10 digits" |
| `1234567890` | accepted (format is not checked beyond 10 digits) |

Other:
- Name `"  ramesh   kumar "` is stored as `ramesh kumar` (case kept as typed) with `name_search = "ramesh kumar"` (R3).
- PAN `abcde1234f` is stored as `ABCDE1234F`. `ABCDE12345` is rejected (R4).
- Aadhaar `1234 5678 9012` is stored as `123456789012` and read back masked as `XXXX XXXX 9012` (R4, R14).
- Customer numbers: first customer is `C-0001`, second `C-0002`, and after 1 April the next is still `C-0003` (R2).
- Two new customers with the same mobile: the second response has `warnings: [{ code: "duplicate_mobile", customerIds: [...] }]` and both can be saved (R5).
- Two customers with the same PAN: the second gets 409 naming the first (R6).
- Same create sent twice with the same id: one row, second response 200 (R7). Same id with a different name: 409 (R7).
- Search by `C-0002`, by `kum`, by last 4 digits of the mobile, and by PAN each find the right customer. A 2-digit query does not search mobiles (R8).
- Search over 20,000 generated customers returns in under 200 ms locally (R9).
- Edit the address: one new revision holds the old address, the audit row lists only `address` as changed, and the customer number and id are unchanged (R10, R11).
- Edit with no actual changes: no revision and no audit row.
- Edit Aadhaar: the audit `detail_json` does not contain the number (R14).
- Reveal Aadhaar: returns the full number and writes one audit row (R14).
- Void with reason: hidden from default search, shown with the switch, restore brings it back. `DELETE` on `customers` fails (R13, 001 R9).
- Every route returns 401 without a session. `created_by` equals the logged-in user id (R15).
- The picker finds a customer by typing, and "Add new customer" returns the new customer to the caller (screens).

## 7. Out of scope
Customer ledger and balances (019), blocking void when documents exist (added in 013, 015, 016, 018), invoice-time snapshot copy (013), import from the old booklet or spreadsheet (a separate small feature if wanted), customer photos, birthdays and anniversary reminders, WhatsApp or SMS sending.

## 8. Owner answers (2026-11-01)
- Q1. Aadhaar: **store it, masked on screen** (as drafted in R1, R4, R14).
- Q2. Shared mobile numbers: **allowed, with a warning** (as drafted in R5).
- Q3. Customer numbers: **never reset** (`C-0001`, `C-0002`, as drafted in R2).

## 9. Acceptance checklist
- [x] R1 to R15 implemented and tested (136 tests in total, 55 of them new; search over 20,000 customers is under 200 ms)
- [x] Migrations 0004 and 0005 applied on the remote database
- [x] Create, search, edit, history, void, restore, Aadhaar reveal and the picker work in a real browser against a local Worker (PC), and the phone view is read-only with no sideways scroll
- [x] The same checked on the live site, after deploy (owner confirmed 2026-11-01)
- [x] Nothing in specs 000, 001 and 002 broke (their tests still pass)
- [x] Owner approved the result
