# jewellery_billing_satyam

Web billing, inventory and business management system for one gold and silver jewellery showroom. It is jewellery retail software, not a generic GST app.

Read first: `docs/decisions.md` (locked choices and open questions), `docs/tech-stack.md`, `docs/roadmap.md`, `docs/requirements.md` (the owner's full requirements).

## How we work

- One feature at a time. Write the spec in `docs/specs/`, wait for the owner to approve it, then build, test and commit. No code before approval.
- Do not decide anything listed under "Open" in `docs/decisions.md`. Put it in the spec as a question.
- Unanswered questions go in `docs/open-questions.md`, not in chat. Add each new one there with a safe default if work must continue, and keep building what is not blocked. The owner answers them in batches with the paper receipts. Only ask in chat when the owner's answer changes what to do next and there is no safe default.
- Keep commits small, one feature or step per commit, and push to the private GitHub repo.
- Reply to the owner in English.

## Rules that must never be broken

1. Money is integer paise, weight is integer milligrams. No floats in money or weight logic.
2. All rounding goes through the single rounding function in `packages/calc`. Round-off: below 50 paise rounds down, 50 paise or more rounds up.
3. Calculation code is pure and has table-driven tests.
4. No hard deletes. Edits create a new revision, and the original stays readable.
5. Saved invoices keep the rates, GST rates and calculations they were saved with. Changing today's rate never changes old invoices.
6. Reprinting never creates a transaction.
7. A payment, advance or old-gold amount is never counted twice. Partly used advances leave only the unused part available.
8. Do not change the invoice first page or the settlement page while building other features. Do not break earlier specs.
9. Print layouts: invoice A4 landscape, settlement on the back page, payment receipt and old-gold receipt A5 landscape. Internal calculation fields and UI controls must not print.
10. Never commit secrets, real customer data, GSTIN, or `.env` files.
