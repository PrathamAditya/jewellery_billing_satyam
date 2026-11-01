# Open questions

One place for everything that is not answered yet. Claude adds to this file instead of asking in chat. When the owner brings the receipts and answers, we go through it top to bottom, move each answered item into `docs/decisions.md` (or the spec it affects), and tick it here.

Last updated: 2026-11-01 (owner's questionnaire answers and four reference PDFs added; see section M and `docs/owner-answers-2026-11-01.md`). Status: `OPEN` waiting for an answer, `DEFAULT` Claude chose a default so work is not blocked (change it if wrong), `DONE` answered.

How to answer: a photo of the paper document is the best answer. Write the answer next to the question or just say the number (for example "Q7: percentage, e.g. 2%"). Remove customer names, GSTIN, PAN and phone numbers from anything that goes into git. They are entered in the app's Settings, not in the repo.

---

## Answered on 2026-11-01 (owner's questionnaire)

These are closed. The details are in `docs/owner-answers-2026-11-01.md` and the locked decisions D13 to D28.

| Question | Answer |
|----------|--------|
| P1, P2, P3 (receipt, old gold, advance papers) | Four reference PDFs received (`docs/reference-formats.md`). Advance booklet itself not needed: advances follow answer 19. Customer papers are not to be shared. |
| P4, Q2 | Polish is a percentage of net weight, shown as a weight in the Wastage column. |
| P5, Q1 | HSN 9988 formula given (D13). |
| P6 | Labour is typed per gram on each row. |
| P7, Q3 | The gold rate is typed on every line. Only 24K995, 22K916 and silver have daily rates. |
| P9, Q33 | Intra-state CGST + SGST, inter-state IGST. |
| P10, P11, Q27 | The business details and bank details will be provided separately, bank details do print on the invoice. BIS logo is optional. |
| P13 | Fresh customer list, no import. |
| Q4, Q17 | Separate sequences for invoices, payment receipts and old gold, each reset on 1 April. The printed format follows the samples: see Q61. |
| Q5, Q35 | Round-off on the final total only. |
| Q7 | HUID not required. Purity must be visible. BIS logo optional. |
| Q9, Q34 | Not answered directly: the sample shows no reverse-charge line. Still for the CA. |
| Q19, Q20 | Cheque statuses, advances and cancellation are answered (D18). Details of cheque fields still open. |
| Q22 | Old gold: formula given, purity percentage and rate typed per receipt (D21). The old-gold payment-mode rule (Q24) is not answered. |
| Q28 | Printer is the Brother DCP-T830DW with automatic duplex. |
| Q29 | Plain paper, the whole design is printed. |
| Q32 | Regular scheme, not composition. |
| Q37 to Q44 | Item types, U No., stock counting, locations, purchases, karigar, refining are answered at the level of D23. Open details are in Q65 to Q69. |
| Q45, Q46, Q53 | Separate logins and roles, user activity history, Android can create and edit where allowed (D24). Detail is in Q67. |
| Q49, Q50 | Dashboard top five and the report list are answered (D27). |
| Q51 | Backups in the cloud and on the local PC, daily, with versions (D26). |
| Q52 | The PC works mostly offline (D25). |

## A. Please bring these papers

Each item says what to look for. One real example of each is enough, two if they differ.

| # | Bring | What I will read from it | Needed for |
|---|-------|--------------------------|------------|
| P1 | **Payment receipt book**: one page, plus a page with an advance and a page with a cheque or card payment if you have them | Layout, receipt numbering style, what is written in each row, payment modes in use, reference number field, what "two payment rows" looks like | Spec 015 (receipts) |
| P2 | **Old gold receipt book**: one page for a 22K and one for a 24K purchase | Layout, which purity names are written, the percentage or "touch" used, any melting or wastage deduction, the rate used, how the customer is paid | Spec 018 (old gold) |
| P3 | **Advance / order booklet**: a page with several advances on one order | How an order is referenced, how part advances and remarks are written, how an advance is later adjusted on the bill | Spec 016 (advances) |
| P4 | **An invoice with polish / wastage filled in** | Is it written as grams or percent, per line or on the bill, and how it changes the amount | Spec 012, 013 (O2) |
| P5 | **A job-work invoice (HSN 9988, 5% GST)** | The full calculation, line by line | Spec 012 (O1) |
| P6 | **A 22K916 gold invoice** with labour (making charge) | How the gold rate and labour are written, whether labour is per gram or percent or a fixed amount, how the display rate is worked out | Spec 012, 013 |
| P7 | **An 18K, 14K or 24K999 invoice** (if any exist) | Which rate was used for that purity | Spec 013 (O9) |
| P8 | **An invoice where old gold was adjusted**, and one with an advance adjusted | How the settlement is written on the bill | Spec 017 (settlement) |
| P9 | **An invoice to a customer from another state** (if any) | IGST layout | Spec 012 |
| P10 | **The BIS hallmark logo file** and the showroom logo, if any | Header artwork | Spec 014 (print) |
| P11 | **A bank statement page or cancelled cheque of the business account** (hide the account number if you like, tell me the last 4 digits) | Bank details that print on the bill, if they do | Spec 014 |
| P12 | **The current stock list** (Excel, notebook photo or the old software's export) | Categories, item codes, U No. style, weights, purity, location, cost and selling price | Specs 020 to 022 |
| P13 | **The customer list** (phone contacts, notebook, Excel) with any opening balances and old-booklet advances | Opening data to import | Specs 010, 016, 019 |

---

## B. Invoice and calculation (specs 012 to 014)

- **Q1. O1, HSN 9988 job-work calculation.** `OPEN`. What exactly is the "specified job-work calculation"? Needs one worked example from paper (P5): weight, rate, labour, 5% GST, and what number is printed as the display rate. Until then, lines with HSN 9988 are refused.
- **Q2. O2, polish / wastage.** `OPEN`. Is it typed as grams or as a percentage of net weight? Is it per line or for the whole bill? Does it appear as its own column on the printed bill (the paper bill has a "Wastage Polish" column)? (P4)
- **Q3. O9, which rate for which purity.** `OPEN`. The shop saves three rates: 24K995, 22K916 and silver. For 18K750, 14K, 24K999 and other purities, which rate is used, and is there a percentage on top (for example 18K = 75% of the 24K rate)? Give one example per purity. (P7)
- **Q4. Invoice number style.** `DEFAULT`. The paper book uses a plain running number (2761). The locked plan is a financial-year series (`INV/2026-27/0001`, decision D11). Do you want the new software to continue the running number from where the book stopped (for example start at 2762), or use the financial-year series? Default: financial-year series, with a settings field to start from any number.
- **Q5. Round-off on the bill.** `DEFAULT`. The paper bill kept the paise (total 2,884.06, customer paid 2,884.00 and the 0.06 was cleared in cash). The requirements say round the final amount to the rupee (below 50 paise down, 50 or more up). Default: always round to the rupee and show the round-off line. Is that what you want on every bill?
- **Q6. GST on several lines.** `DONE` (2026-11-01). Once per rate group on the total (spec 012, Q1).
- **Q7. HUID and hallmark.** `OPEN`. Do printed bills need the HUID number of each hallmarked piece, a hallmarking charge line, or the purity mark (916, 750) as a separate column? The requirements say "clearly highlight 22K (916)". How should that look?
- **Q8. Customer details on the bill.** `OPEN`. The paper bill has Name/Address and PAN. When is PAN required (for example above a limit)? When is Aadhaar needed? Should the bill print the customer's mobile number?
- **Q9. Reverse charge line.** `OPEN`. The paper bill has "Reverse Charge: Yes/No" and "GST Payable on Reverse Purchase". When does the shop use these (for example buying old gold from an unregistered person)? Should the new bill print them, and who decides Yes or No? (CA question, see section F.)
- **Q10. Same rate for first and next rows.** `OPEN`. The requirements describe an option to use the same rate for the first row and the following rows, never printed. Please describe how you use it on a real bill: which fields it copies and when you turn it on.
- **Q11. Description of goods.** `OPEN`. Is the description free text ("Silver Ornament") or picked from a list (Ring, Chain, Payal, ...)? Does it come from the inventory item (spec 021)?
- **Q12. Bill copies.** `OPEN`. The paper book is a triplicate (customer, office, spare). How many copies do you print, and are they marked "Original / Duplicate / Triplicate"?

## C. Rates (specs 011, 011b)

- **Q13. O10, live IBJA rates.** `OPEN`. Which paid provider (for example Surepass, price on request), what monthly cost is acceptable, and who creates the account and API key? IBJA updates twice a day (about 12:05 pm and 5:05 pm). Spec 011b is blocked until this is decided.
- **Q14. Shop rate versus IBJA.** `OPEN`. Does the showroom's selling rate differ from IBJA by a fixed margin (for example IBJA plus a premium)? If yes, the screen could show "IBJA rate + your margin" as a suggestion.
- **Q15. When today's rate is not typed.** `DEFAULT`. Use the last typed rate and show an amber warning. Say if invoicing should be blocked instead.
- **Q16. Changes during the day.** `DEFAULT`. One rate per kind per day, edit if it changes, the old value stays in history. Say if you want every change as a separate timed entry.

## D. Payments, advances, old gold, settlement (specs 015 to 018)

- **Q17. Receipt numbers.** `OPEN`. How are the receipt books numbered today (one running number, or separate for payment, advance and old gold)? The plan uses `PR/2026-27/0001` and `OG/2026-27/0001`. (P1, P2)
- **Q18. "Maximum two payment rows".** `OPEN`. Does one receipt show up to two payments (for example UPI plus cash)? What happens when there are three? (P1)
- **Q19. Cheque and card.** `OPEN`. Does the shop really take cheques and cards? Which details must be written (cheque number, bank, date, card last 4 digits)?
- **Q20. Advance on an order.** `OPEN`. What identifies an order today (customer name, a booklet number, a description)? Can an advance be refunded? What if the order is cancelled? (P3)
- **Q21. Opening advances.** `OPEN`. How many old-booklet advances need to be entered as opening balances, and is there a cut-off date? (P3, P13)
- **Q22. Old gold percentage.** `OPEN`. The requirement is "Net Weight x Purity Percentage x Applicable Rate". What is the percentage for each purity (for example 22K = 91.6% or something lower after the shop's deduction)? Is there a melting or wastage deduction? Which rate is the "applicable" one: the 24K995 rate, or the 22K916 rate? (P2)
- **Q23. Old gold, CA decisions (O3).** `OPEN`, CA. How is old gold bought from a customer treated in accounts and GST (purchase from an unregistered person, reverse charge, set-off against the new bill), and which stock bucket does it go into? The software builds the receipt and all four settlement cases now, with stock and GST posting switched off until the CA decides (decision D7).
- **Q24. Old gold payment modes.** `OPEN`. The requirement says no cash or card for paying the customer for old gold, only bank transfer, UPI or cheque. Is that rule from the CA or the owner, and is cash really never allowed?
- **Q25. Partial settlement and later payments.** `OPEN`. If a customer pays part now and the rest later, how is the balance tracked on paper today (a note on the bill, the ledger book)? Is there a credit limit per customer? What if a customer never pays: is there a write-off?
- **Q26. Interest.** `OPEN`. The bill says "Interest @ 24% if not paid within 7 days". Should the software ever calculate it, or only print the text?

## E. Showroom details and printing (spec 014)

- **Q27. O4, header details.** `OPEN`. Needed in Settings (not in git): GSTIN, PAN, the three phone numbers, bank details (if printed), the BIS logo file, the showroom logo, the signatory name. Already known from the invoice: name, address, state code 02, the "Specialist" line and the three terms. (P10, P11)
- **Q28. O5, printer.** `OPEN`. Brother printer model, and does it print on both sides automatically? The settlement page prints on the back of the bill.
- **Q29. Paper.** `OPEN`. Is the bill printed on plain A4 or on the pink pre-printed book paper? On plain paper the software prints the whole form. On pre-printed paper it prints only the filled-in values, which needs very exact alignment.
- **Q30. Language.** `OPEN`. English only on the bill, or also Hindi? Should amounts in words be printed ("Invoice Value in words" is on the paper bill)? English or Hindi?

## F. Questions for the CA

- **Q31.** Old gold: accounting and GST treatment, and stock bucket (same as Q23).
- **Q32.** Is the shop under the regular GST scheme (it looks like yes) and not composition? (O8)
- **Q33.** Sales to customers in other states: IGST 3% as expected? What is the place-of-supply rule you want printed?
- **Q34.** Reverse charge on purchases from unregistered persons: when does it apply, and what should the bill and the books show? (Q9)
- **Q35.** Is rounding the invoice total to the rupee fine for GST purposes, and should the round-off appear as its own line? (Q5)
- **Q36.** Records: how many years must bills and receipts be kept, and in what format should an audit copy be handed over?

## G. Inventory, purchases, karigar (specs 020 to 024)

- **Q37.** Inventory categories are fixed as 24K Gold, 22K, 18K, 14K, Diamond, Silver. Are there other things sold (coins, bars, utensils, pooja items, watches)? (P12)
- **Q38.** What does the unique U No. look like today (letters, digits, per item or per lot)? Is every ornament tagged and weighed individually?
- **Q39.** Is stock counted by piece, by weight, or both, for each category?
- **Q40.** Low-stock alerts: for which items and at what level?
- **Q41.** Purchase: from whom does the shop buy (wholesaler, karigar, old gold)? Are purchase bills recorded now? What should the software keep (supplier, bill number, weight, rate, GST)?
- **Q42.** Karigar and job work: how is gold given to a karigar and received back tracked today (weight in, weight out, wastage, labour)? One page of the register would settle this.
- **Q43.** Refining and testing: is it done in the shop or sent out, and should it be in the first release? (The roadmap marks it "later".)
- **Q44.** Locations: do items sit in one counter, several counters, a safe?

## H. Customers, accounts, people

- **Q45.** Employees: only the owner logs in today (decision D6). Will staff ever need their own login, and what should they be allowed to do (create bills but not edit rates, view only)? The database is ready for it.
- **Q46.** Does the owner want to see who created or changed each bill and rate (the software records it already)?
- **Q47.** Customer ledger (spec 019): which of these does the owner look at daily: outstanding balances, advances held, a customer's full history, today's collections?
- **Q48.** Should customers get an SMS or WhatsApp copy of the bill or a payment reminder? (Out of scope for now. Say if it matters.)

## I. Dashboard, reports, backup, offline

- **Q49.** Dashboard (spec 030): which five numbers should be on top when the app opens? Requirements list nine. Which are daily-must-see?
- **Q50.** Reports (spec 031): which reports does the CA or the owner actually ask for every month? The list has 14.
- **Q51.** Backups (spec 050): is a nightly copy to cloud storage enough, plus a "download everything" button? Who restores if something goes wrong?
- **Q52.** O6, offline: how often is the internet down at the showroom, and for how long? If a bill is made offline, is it acceptable that its number is allocated when it syncs, or must the number be printed on the bill at once?
- **Q53.** Android: decision D5 makes it view-only in version 1. Is there any single action that is needed on the phone from day one (for example "mark a payment received")?

## L. Added while drafting spec 013 (invoices)

- **Q55. Edit or credit note.** `DEFAULT`, CA. Once a bill has been handed to the customer, may the software edit it (every earlier version is kept and shown in history), or should a mistake be fixed with a credit note and a new bill? Default: editing is allowed with full history. Please ask the CA what the shop must do.
- **Q56. Walk-in customers.** `DEFAULT`. Can a bill be made with only a name and no saved customer (no mobile)? Default: yes. Is a mobile number compulsory above some bill amount?
- **Q57. Un-voiding.** `DEFAULT`. A voided bill cannot be brought back. A new bill is made instead. Is that how the paper book works (a cancelled bill stays in the book marked "Cancelled")?
- **Q58. Back-dated bills.** `DEFAULT`. A bill dated 1 March made today gets a number from the March financial year even if newer bills already have higher numbers. On the paper book numbers run in date order. Should back-dating be allowed at all, and by how many days?
- **Q59. Bill remarks.** `DEFAULT`. The remarks box on a bill is internal and is never printed. Does the shop ever write a note that must print on the customer's bill?
- **Q60. Who may edit or void a bill.** `DEFAULT`. Only the owner (the only login, D6). Say if anyone else should be able to.

## M. New questions from the owner's answers and the reference PDFs

**Documents and numbers**
- **Q61. Printed numbers.** `DEFAULT`. The samples show `INV-0001`, `PAY-0001`, `OGP-0001`, `ORD-0001`, and the owner says every sequence restarts on 1 April. So `INV-0001` appears again in each financial year. Default: print exactly that format, store the financial year with every number, and show the year in lists and searches when two documents share a number. Is it all right that the numbers repeat each year? The alternative is `INV-2026-27-0001`.
- **Q62. Customer reference.** `DEFAULT`. The old gold sample shows `C0001` (no hyphen), the customers already built show `C-0001`. Default: change to `C0001` everywhere. OK?
- **Q63. Invoice paper orientation.** `DONE` 2026-11-01: A4 **portrait**, as in the sample.
- **Q64. HUID line.** `DEFAULT`. The sample invoice has a `HUID` label under the item name, but HUID printing is not required. Default: leave the label out.
- **Q65. U No. format.** `OPEN`. The rule says four-character item code plus a two-digit serial, but the examples are `RING01` (4 + 2), `CHAIN01` (5 + 2) and `T00001` (4 + 2 only if the code is `T000`). Please state the rule exactly: how long is the item code, is it letters only, and what happens after serial 99 for one code?
- **Q66. v84 and the HTML file.** `OPEN`. Can the existing HTML billing file be shared (test data only)? It would show the settlement behaviour and every calculation exactly. Without it, the settlement page is built from the PDF sample and requirements section 7.

**Rules still to be given**
- **Q67. Roles and permissions.** `OPEN`. List the people types (owner, family, staff, accountant, others) and for each module whether they can view, create, edit, void or see reports, and whether they may see rates, customer balances and cost prices. Default until then: owner full access, everyone else view-only on invoices and customers.
- **Q68. Discounts.** `OPEN`. When a discount is on gold only, on labour only, or on the total: does GST apply after the discount (default: yes, tax on the discounted amount)? Is a total discount shared across lines in proportion to their amounts? Can the discount be negative (a surcharge)? Is there a limit above which it needs the owner?
- **Q69. Stones and diamonds.** `OPEN`. For the "separate" method: how are stone weight and stone amount entered (weight, rate per carat or a fixed amount), is the stone weight part of gross and not net, and what GST applies to the stone line? For the "combined" method: is it just one total amount against the combined weight?
- **Q70. Pending rate fixation (udhaar).** `OPEN`. When the customer takes jewellery with the rate not fixed: what is recorded on the invoice (weight and purity only)? Is the labour fixed at the sale or also at payment? On the payment day, which rate is used (the day's saved rate or one typed)? Is GST calculated and shown at payment time? Is an invoice number allocated at the sale or when the rate is fixed?
- **Q71. Returns and credit notes.** `OPEN`. Does a credit note have its own series (`CN-0001`, reset each year)? Is a return always at the original rate or at the day's rate? Is there a deduction for making charges on a return?
- **Q72. Old gold fields.** `DEFAULT`. The sample receipt has Gross, Less, Net, Purity %, Rate, Amount, round-off. Default: build exactly that, with net = gross - less, purity typed as a percentage with 2 decimals, and the amount rounded to the rupee as the final amount (original amount shown with paise, round-off shown). Can one receipt hold several rows (the sample has one)?
- **Q73. Payment modes.** `OPEN`. The samples show UPI and Old Gold. The requirements list UPI, Cash, Card, Cheque, Bank transfer. Is "Old Gold" and "Advance adjustment" a mode on receipts and the settlement page, and are there others (credit note, gift voucher)? Is there a rule for a UPI reference such as "Txn: DKJSDF" being compulsory?
- **Q74. Cash limit.** `OPEN`. What amount triggers the warning, and is it per receipt, per customer per day, or per invoice? (The law's limits differ.)
- **Q75. Cheque details.** `OPEN`. Fields to record on a cheque (number, bank, date, drawer name)? Who can mark Deposited, Cleared, Bounced? Is a bounce charge added to the customer's balance?
- **Q76. Order references.** `DEFAULT`. `ORD-0001` ties advances to an order. Default: an order is created when the first advance is taken (with an optional description and expected date), and a later invoice can be linked to it. Can an order exist without any advance? Do orders restart each financial year?
- **Q77. Copies.** `OPEN`. The sample says `SHOP COPY`. Is a customer copy printed as well (duplex means one sheet each)? Are copies labelled Original, Duplicate, and so on?
- **Q78. Stock reconciliation.** `OPEN`. When the monthly count differs: who approves the adjustment, is a negative difference treated as a loss, and does it need a reason code?
- **Q79. Daily cash closing.** `OPEN`. Is closing once a day by one person, and can a closed day be reopened? Which payments count as cash (cash receipts and cash paid out only)?
- **Q80. Karigar.** `OPEN`. Wastage allowed per job (a percentage of issued metal)? Is labour per gram or fixed per piece? Does the karigar account run in weight (fine gold) or in money or both?
- **Q81. Backups to the PC.** `OPEN`. A browser cannot save a file to the PC by itself every day. Options: (a) a small helper program on the PC (best, needs installing), (b) the app downloads a backup file to a folder when it is open each day, (c) a daily cloud backup you download weekly. Which do you want? (O14)
- **Q82. Offline numbering.** `DEFAULT`. When the PC is offline it keeps issuing numbers in order from its last known number, and phones create numbered documents only when online. Is that acceptable, or must phones also create documents offline? (O6)
- **Q83. Outside access.** `OPEN`. Access from outside the showroom over the internet: should it be limited (for example only the owner, only view, a second password or code)? The PC itself is expected to stay at the showroom.

**Timeline**
- **Q84. 1 December start of testing.** `OPEN`. Parallel testing is meant to start in about a month. Please see the proposed plan in `docs/roadmap.md`: the core billing, printing, payments, advances, old gold, customers, staff logins and backups can be ready for it, and inventory, karigar, reports and offline-first follow during the testing months. Is that the order you want, or is something else needed on the first day of testing?

## N. Defaults used in Wave 1

The agent building Wave 1 adds every default or interpretation it uses here (ID, what was assumed, spec affected). The list of planned defaults is in `docs/wave1-plan.md`.

(none yet)

## J. Defaults I chose without asking (tell me if any is wrong)

| # | Default | Where |
|---|---------|-------|
| D-a | Login: username `owner`, password at least 10 characters, session lasts 30 days from last use | spec 002 |
| D-b | Customers: only the name is required, Aadhaar is stored but shown masked, shared mobile numbers allowed with a warning, customer numbers `C-0001` never reset | spec 010 |
| D-c | Rates: typed per gram or per kg, stored per kg, one per day, more than 10% change asks for confirmation, no future dates | spec 011 |
| D-d | Calculation: tax once per rate group, rounded half up to the paisa, final payable rounded to the rupee | spec 012 |
| D-e | Phone screens are read-only | decision D5 |
| D-f | Nothing is ever deleted, only voided or edited with the old version kept | decision D12 / rule 4 |

## K. Things for the owner to check on what is already built

- **C1.** Spec 011 on the live site: open Rates, type three rates, edit one, look at the Home card. Then tell me it works so I can mark it Done.
- **C2.** Spec 012 (after it is deployed): on the Calculator screen, press "Fill with the Baba Jewellers example" and check it shows 2,800.06, 42.00, 42.00 and 2,884.06. Then type two or three more paper bills and compare every figure.
