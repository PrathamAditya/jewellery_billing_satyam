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
- **Q44.** Locations: do items sit in one counter, several counters, a safe? Default used until you answer: the six places in Q165 (spec 021b).

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
- **Q79. Daily cash closing.** `DEFAULT: see Q130 to Q138 (spec 032)`. Earlier wording: `OPEN`. Is closing once a day by one person, and can a closed day be reopened? Which payments count as cash (cash receipts and cash paid out only)?
- **Q80. Karigar.** `OPEN`. Wastage allowed per job (a percentage of issued metal)? Is labour per gram or fixed per piece? Does the karigar account run in weight (fine gold) or in money or both?
- **Q81. Backups to the PC.** `OPEN`. A browser cannot save a file to the PC by itself every day. Options: (a) a small helper program on the PC (best, needs installing), (b) the app downloads a backup file to a folder when it is open each day, (c) a daily cloud backup you download weekly. Which do you want? (O14)
- **Q82. Offline numbering.** `DEFAULT`. When the PC is offline it keeps issuing numbers in order from its last known number, and phones create numbered documents only when online. Is that acceptable, or must phones also create documents offline? (O6)
- **Q83. Outside access.** `OPEN`. Access from outside the showroom over the internet: should it be limited (for example only the owner, only view, a second password or code)? The PC itself is expected to stay at the showroom.

**Timeline**
- **Q84. 1 December start of testing.** `OPEN`. Parallel testing is meant to start in about a month. Please see the proposed plan in `docs/roadmap.md`: the core billing, printing, payments, advances, old gold, customers, staff logins and backups can be ready for it, and inventory, karigar, reports and offline-first follow during the testing months. Is that the order you want, or is something else needed on the first day of testing?

## Q. Wave 2 questions for spec 019b (cheques), default used until you answer

- **Q85. Bounce charge.** `DEFAULT: none`. When a cheque bounces, should the bank's bounce charge be added to the customer's balance? Default: no. The balance only rises by the amount that was reversed.
- **Q86. Who marks what.** `DEFAULT: anyone who can take payments marks received, deposited and cleared; only the owner marks bounced`. Is that right, or should staff also be able to bounce?
- **Q87. Cheque fields.** `DEFAULT: number (required), bank, cheque date and drawer name (optional)`. Any other field you want on a cheque?
- **Q88. Moves.** `DEFAULT: a bounce is allowed from any state, including after cleared (banks sometimes return a cheque later); a bounced cheque cannot be un-bounced, the money is taken again as a new payment`. Is that right?

## R. Wave 2 questions for spec 019c (credit sales, rate fixed later), default used until you answer

- **Q89. Labour on a pending sale.** `DEFAULT: the labour rate per kg is typed and fixed at the sale; only the gold rate waits`. Should the labour rate also wait until the rate is fixed?
- **Q90. Which rate is used when fixing.** `DEFAULT: the applicable rate of the line's purity on the rate date (spec 011 R8, a carried-forward rate allowed and its date shown); a typed rate overrides it per line; a line with no rate (for example 18K750) must be typed`. Is that right?
- **Q91. Money paid before fixing.** `DEFAULT: recorded as the customer's advance linked to the sale (numbered PAY receipt); applied to the sale up to its payable when the rate is fixed; any excess stays as advance; nothing can be allocated to the sale before fixing`. Is that right, or should it be refused until the rate is fixed?
- **Q92. Fixed once or in parts.** `DEFAULT: once, for the whole sale, on one day; corrections afterwards are ordinary invoice edits with history`. Is that right?
- **Q93. Invoice number.** `DEFAULT: allocated when the sale is recorded (INV series, financial year of the sale date), not when the rate is fixed`. Q70 asked the same.
- **Q94. What a pending sale may contain.** `DEFAULT: customer required (no walk-in); HSN 7113 only; weight-priced lines only, no stones, combined totals or discounts`. Should job work (9988), stones or discounts be allowed on a pending sale?
- **Q95. Printing a pending sale.** `DEFAULT: weights, purity and labour rate are printed, and the amount block says "Rate and amount to be fixed when paid"; no GST, rate or payable is printed until fixed`. Is that right?
- **Q96. Outstanding.** `DEFAULT: a pending sale is not in the outstanding total or the FIFO order; it is listed in a separate "Pending rate" list with its weight and the money held against it`.
- **Q97. Voiding a pending sale with money held.** `DEFAULT: refused; fix the rate first, then correct it with an edit`. Is that right?
- **Q98. Date in the ledger.** `DEFAULT: a sale appears in the ledger on its invoice date, even if the rate is fixed later (the ledger is in date order)`.

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
| D-h | Discounts (Q68): GST on the discounted amount; gold, labour and total discounts shared by largest remainder, the total in proportion to the amount after the other two; no negative discount; no approval limit. Stones (Q69): stone amount typed as a fixed rupee amount; stone weight is information and part of gross; stone taxed at the line's rate; combined mode is one typed total. | spec 012c |
| D-g | Print: the invoice does not print an Aadhaar reference line (invoices do not store Aadhaar). The payment receipt has no order column yet (the receipt does not carry the order number). Discount rows wait for 012c. | spec 014 |

## K. Things for the owner to check on what is already built

- **C1.** Spec 011 on the live site: open Rates, type three rates, edit one, look at the Home card. Then tell me it works so I can mark it Done.
- **C2.** Spec 012 (after it is deployed): on the Calculator screen, press "Fill with the Baba Jewellers example" and check it shows 2,800.06, 42.00, 42.00 and 2,884.06. Then type two or three more paper bills and compare every figure.
- **C3.** Spec 014 (printing), on the Brother DCP-T830DW, after it is deployed: open an invoice, press Print, choose "Shop copy", set A4, two-sided, flip on the long edge, scale 100%, margins none. Check the settlement page lands on the back of the same sheet, the figures line up with the paper form, and the page does not shift. Then print one payment receipt and one old gold receipt with "Both" to check the cut line. Tell me what is off.

## S. Wave 2 questions for spec 019d (returns, exchanges, credit notes), default used until you answer

- **Q90. Kinds.** `DEFAULT: three kinds: credit (plain return), exchange (the credit is also adjusted against a new invoice for the new goods), old gold (the return is settled by an old gold receipt with invoice adjustment, spec 018)`. Is that right?
- **Q91. Amount and tax.** `DEFAULT: the return is typed per original invoice line as a taxable value (not above what that line still has); GST rate, tax mode and rounding follow the original invoice, and the total rounds to the rupee with a round-off line; a reason is required; the total can never exceed the bill less earlier credit notes`. Is that right?
- **Q92. Credit beyond the balance.** `DEFAULT: the credit is applied to the original invoice's balance on creation, up to that balance. The rest is held for the customer and can be applied to another bill of the same customer or paid back. It is not stored as a payment, so it does not count as money received`. Should the rest instead become an advance (a payment row)?
- **Q93. Payouts.** `DEFAULT: money paid back to the customer by cash, UPI, bank transfer or cheque (the modes of spec 016 refunds). A payout can be reversed with a reason`. Any other mode you want?
- **Q94. Who does what.** `DEFAULT: create a credit note: invoices.edit (owner and manager); apply held credit: payments.create (staff too); pay out and reverse a payout: payments.refund; void a credit note and reverse an application: payments.void`. Should staff be able to create a credit note at the counter?
- **Q95. Bill changes.** `DEFAULT: a bill with a live credit note cannot be voided (409), and an edit cannot take its total below what is already settled or credited`. Is that right?
- **Q96. Exchange order.** `DEFAULT: an exchange credit first reduces the original bill's balance, then the rest is applied to the replacement invoice (same customer, created first with the normal invoice screen). The customer pays only the difference`. Is that the way you want it?
- **Q97. Old gold return.** `DEFAULT: the old gold receipt must already exist (invoice adjustment against the original bill, same amount as the credit note). The credit note only records the return and links the two; it does not touch the balance again`. Is that right?
- **Q98. Where the credit shows.** `DEFAULT: credit applied to a bill counts as settled money on that bill (settlement page line "Credit note", balance due falls). Credit held is shown next to advance held, not inside it, and the customer's net figure is outstanding minus advance held minus credit held`. Is that right?
- **Q99. Stock.** `DEFAULT: stock is not updated in this spec (no stock table yet). The hook is in place and spec 021 puts returned goods back into stock`. Owner answer 25 said "stock updated": is it fine to wait for spec 021?
- **Q100. Dates.** `DEFAULT: the credit note date is between the original invoice date and today, and it takes its number from the financial year of its own date`. Is that right?
- **Q101. Print.** `DEFAULT: credit note printed A4 portrait, one copy, from the stored data only (a GST document, same sheet as the invoice). Layout to be checked against a paper sample`. Do you have a sample credit note from the old system?

## T. Wave 4 questions (downloadable version), default used until you answer

- **Q110. Platforms and order.** `DEFAULT: Windows first, then macOS and Linux`. Which computers do your customers use? Does Windows come first?
- **Q111. Desktop framework.** `DEFAULT: Electron`. It is large but mature, and it runs the same Node server as the cloud version. The alternative, Tauri, is smaller but needs more work to bundle the SQLite database. Is the size of the download a concern?
- **Q112. One PC or the whole shop network.** `DEFAULT: one PC first; network access (spec 090) later, only if you want it`. Will phones or other PCs need to open the same data? If yes, that changes the login and security work.
- **Q113. Cloud version alongside.** `DEFAULT: yes, both keep running from the same code`. Should the cloud version stay at your showroom, or move to the downloadable version when it is ready?
- **Q114. Certificates and distribution.** `DEFAULT: the developer buys the code-signing certificates and publishes the downloads on the website`. Who pays for and owns the certificates?
- **Q115. Updates.** `DEFAULT: checked at start-up; the owner is asked before any update is installed`. Should updates install by themselves?
- **Q116. Licence and price.** `DEFAULT: not decided; the first version has no licence check`. Is the software free, paid once per PC, or a yearly subscription? A licence check is a separate spec.
- **Q117. Data folder.** `DEFAULT: Documents/JewelleryBilling, changed at setup if wanted`. Is that location acceptable?
- **Q118. Local backup.** `DEFAULT: a copy after the last save of each day to a folder the owner picks, keeping the last 30 copies`. Is that enough, and which folder should it default to?
- **Q119. Support.** `DEFAULT: email, plus a remote session started by the developer only with the owner's permission`. How should customers get help once the software is installed?

## U. Wave 4 questions for spec 080, default used until you answer

- **Q120. SQLite inside the desktop app.** `DEFAULT: use Node's built-in node:sqlite. If it does not load inside Electron's bundled Node, spec 083 switches the same adapter (docs/specs/080-db-adapter.md) to better-sqlite3`. Do you accept a fallback package in the desktop build if the built-in one fails there?
- **Q121. Which test backend runs in CI.** `DEFAULT: npm test runs on SQLite (DB_BACKEND=sqlite); the D1 (Miniflare) suite runs with DB_BACKEND=d1 and is not yet a CI step`. Should CI run both suites, so the cloud D1 path keeps being tested? The default leaves CI unchanged in spec 080.

- **Q122. Local port.** `DEFAULT: 8765, set with JB_PORT`. The desktop app opens its own address; is 8765 acceptable, or do you want a different port?
- **Q123. Setup scripts until spec 082.** `DEFAULT: npm run local:migrate is temporary (spec 082 replaces it with the real runner); npm run local:owner stays`. Is it fine that the owner password is set from the environment variable OWNER_PASSWORD on the command line until the setup screen (spec 085) exists?
- **Q124. Data folder on Windows.** `DEFAULT: Documents/JewelleryBilling in the user's home folder; the setup screen (085) lets the owner change it`. Windows can move "Documents" under OneDrive. Should the default avoid a OneDrive folder, or is that fine?
- **Q125. Database journal mode.** `DEFAULT: WAL with a 5 second busy timeout`. WAL creates two extra files next to billing.sqlite (-wal and -shm). Is that acceptable for the owner's folder and for backups (spec 086)?
- **Q126. Node adapter package.** `DEFAULT: add @hono/node-server (2.1.5), the official Hono adapter for Node`. Do you accept one more package in the desktop build?
- **Q127. Browser test depends on an earlier rate (spec 081 run).** `DEFAULT: the local run saves the silver rate for 2026-02-03 (150.123) before the suite, because e2e/invoices.mjs expects a rate on or before that date and a fresh database has none; the test file is not changed`. Should the test use a date with its own rate (for example today's, which rates.mjs saves), so a fresh database needs no fixture?
- **Q175. Backup when an old database is recognised.** `DEFAULT: the runner makes a backup whenever it writes to a database that already has applied migrations, including the first run that only records the files of a database from the earlier temporary step (docs/specs/082-migration-runner.md, M13)`. Is a backup on that first run acceptable, even though no migration runs?
- **Q176. Backup name and how many are kept.** `DEFAULT: billing.sqlite.backup-<UTC time>-from-<version>.sqlite in the data folder, with <version> the last applied migration (for example 0018); the 5 newest backups of that kind are kept and older ones are deleted (M7, M10)`. Is 5 enough, and is the data folder the right place, or should copies go to a folder the owner picks (086)?
- **Q177. A database the runner cannot identify.** `DEFAULT: refuse and say why, change nothing, and never guess (M12). A migration that changes only rows cannot be told apart from one that did not run, so a database in that position is refused`. Is it acceptable that such a database needs help before the upgrade, rather than the runner choosing for you?
- **Q178. The owner command runs the upgrade too.** `DEFAULT: npm run local:owner runs the same runner (with the backup) before it sets the password, replacing the 081 refusal "run local:migrate first" (M16)`. Is that fine?
- **Q179. An empty data folder is migrated at start-up.** `DEFAULT: the server creates and migrates an empty data folder instead of refusing it, as spec 081 did (M17). The owner sees the same first start as a new install`. Is that fine for the desktop app?
## V. Wave 2 questions for specs 030 (dashboard) and 031 (reports), default used until you answer

- **Q140. Who sees which dashboard tiles.** `DEFAULT: the route needs dashboard.view (owner, manager, staff and viewer have it). Sales tiles need invoices.view; money tiles (received today, outstanding, advances, cheques) need payments.view`. Should customer balances (outstanding and advances) be shown to staff as well, or only to the owner and manager?
- **Q141. Payments received today.** `DEFAULT: every mode counts, including at-sale payments and old gold settlements`. Should old gold settled against a bill be left out of "received"?
- **Q142. Advances taken today.** `DEFAULT: payments of kind advance only (no opening advances, no old gold); an advance taken against a pending-rate sale is included`. Is that the right meaning of "advances received today"?
- **Q143. Sales waiting for the rate.** `DEFAULT: the count of every open pending-rate sale, not only today's`. Would you rather see the amount of weight waiting, or only the count?
- **Q144. Monthly summary.** `DEFAULT: twelve months of the current and previous financial year; sales by invoice date, received by receipt date; credit notes not netted off`. Should credit notes reduce the monthly sales?
- **Q145. Outstanding and advances on the dashboard.** `DEFAULT: the same figures as the ledger summary (spec 019), so the dashboard and the Outstanding screen always agree. Only the totals are shown; the five numbers you wanted first (Q49) are not yet ordered`. Which five numbers should be at the top?
- **Q146. Report kinds and periods.** `DEFAULT: four reports (sales register, payments register, outstanding by customer, GST summary by rate); a period is a financial year or an inclusive date range; "Paid" on the sales register includes credit notes applied; pending-rate sales and voided invoices are left out of the sales register and the GST summary`. Should the GST summary net off credit notes?
- **Q147. Excel format.** `DEFAULT: our own small writer, no library; money as numbers with Indian grouping up to crores; one sheet per file`. Does the CA need several sheets in one file, or formulas in the totals?
- **Q148. PDF format.** `DEFAULT: our own small writer; A4 landscape; built-in Helvetica, so money has no rupee sign and the headers say (Rs); characters outside plain ASCII print as ?`. Would the CA accept "Rs" in the PDF, or is a font with the rupee sign needed?
- **Q149. Report roles.** `DEFAULT: reports.view for owner and manager (as spec 004 has it); the viewer role keeps it because spec 004 gives viewers every view permission; staff do not have it. Outstanding is always the balance on the day the report is made`. Should the viewer role lose the reports, since they show customer balances and tax?
## X. Wave 2 questions for specs 032 (daily cash closing) and 051 (audit viewer), default used until you answer

- **Q130. One closing per day.** `DEFAULT: one closing per business date. A day can be closed only after it has ended (India time), and days close in order (no day before the last closed day)`. Is that right, or should an earlier day be closable later?
- **Q131. Who closes.** `DEFAULT: the owner and the manager (cash.close); shop staff and view-only can read the day and the history. A correction note needs the same permission`. Should staff be able to close the day at the counter?
- **Q132. Count and difference.** `DEFAULT: the counted cash is typed in rupees (stored in paise). Difference = counted minus expected (negative = short). A reason of up to 300 characters is required when the difference is not zero`.
- **Q133. A closed day.** `DEFAULT: a closed day cannot be edited. A correction is a dated note on that day, shown with the closing; the saved figures never change`. Is that right?
- **Q134. Reopening.** `DEFAULT: not allowed. The owner adds a dated correction note instead`. Is that right?
- **Q135. Which money is cash.** `DEFAULT: only mode cash. Cash refunds and cash credit note payouts are cash out; cash old gold payouts too (none can exist today, spec 018). UPI, card, cheque, bank transfer, old gold receipts and held credit never count`. Should credit note payouts in cash count as cash out, as they do here?
- **Q136. Opening cash.** `DEFAULT: the first closing types the opening cash in the drawer at the start of that day (0 if not typed); every later closing opens with the last closed count, so the drawer carries forward. A day with cash entries must be closed before a later day`. Is this how the shop counts the drawer?
- **Q137. Money taken before the system.** `DEFAULT: opening advances (money taken before the system went live, spec 015) do not count in a day's cash`. Is that right?
- **Q138. Changes after a close.** `DEFAULT: if cash for a closed day changes later (a receipt entered for that day after the close, or a voided payment), the saved closing stays as it was, and the day shows the current figure and asks for a correction note`. Is that right?
- **Q139. Audit history (spec 051).** `DEFAULT: the audit history is for the owner only (audit.view). Migration 0023 takes audit.view away from the stored manager and view-only roles, which migration 0012 had given them. The owner can give it back on the People screen`. Is that right?
## W. Wave 2 questions for specs 020 to 022 (inventory, purchases), default used until you answer

- **Q150. U No. format.** `DEFAULT: a 4-character item code plus a 2-digit serial from 01 to 99 that restarts for each code (RING01, RING02, EARR01). The owner's example CHAIN01 has 5 characters, so Chain uses the code CHAI (CHAI01). The example T00001 fits the rule as code T000 with serial 01. Typed U Nos. are checked against the same rule. What is the exact rule, and after serial 99: refuse a new item for that code, or allow 3 digits?`
- **Q151. Item types.** `DEFAULT: Ring RING, Chain CHAI, Earring EARR, Bangle BANG, Necklace NECK. The owner adds types with a 4-character code; a type is made inactive, never deleted`. Which other items do you sell (coins, bars, utensils, pooja items, watches; Q37)?
- **Q152. Purity and metal.** `DEFAULT: the invoice purity list (22K916, 24K995, 18K750, 14K, 24K999, silver, other); metal is gold or silver`. Is the same list right for stock?
- **Q153. Pairs.** `DEFAULT: one record per pair with pieces 1 to 10; the weights are for the whole pair`. Is that right for earrings and other sets?
- **Q154. Status moves.** `DEFAULT: any move except out of written off, which is final; a reason is always required`. Should some moves (for example written off) need the owner to approve?
- **Q155. Editing an item.** `DEFAULT: no edit of an item's details after it is saved; a wrong item is voided and entered again`. Do you want an edit screen with history, like customers, in a later spec?
- **Q156. Voiding.** `DEFAULT: only an item that is in stock or written off, with a reason; its U No. is kept on record and the automatic series never issues it again`. Is that right?
- **Q157. Bulk units.** `DEFAULT: the units pcs, pairs, sets and packets; Tilli is counted in pcs`. How is Tilli counted in the shop: by piece, by tray, or by weight?
- **Q158. Negative quantity.** `DEFAULT: refused, both on the screen and in the database; a correction is an adjustment with a reason`. Is that right?
- **Q159. Opening quantity.** `DEFAULT: entered when the bulk item is created, recorded as a received movement with the reason "Opening stock"`. Is that right?

- **Q160. Sale of an item not in stock.** `DEFAULT: refused. Only an individual item that is in stock and not voided can go on an invoice (sold, reserved, on memo, returned, written off and voided items are refused, with the line named). A bulk line needs enough quantity in stock.` Is that right, or may a reserved or on-memo item go on an invoice?
- **Q161. Bulk stock pool.** `DEFAULT: a bulk sale takes from the one quantity of the bulk item until locations are added (021b). Nothing is split by place yet.` Is one quantity per bulk item enough for now?
- **Q162. Returns and stock.** `DEFAULT: a return credit note (spec 019d) does not put goods back in stock by itself. The owner changes the item with the spec 020 status change and a reason, so the history shows it.` Should a credit note for returned goods restock automatically?
- **Q163. Voiding gives stock back.** `DEFAULT: a void gives back each item the invoice still holds (sold on this invoice) and each bulk quantity. An item the owner has since moved on (returned, or sold on another invoice) is left alone, and the void is not refused for it.` Is that right?
- **Q164. Editing an invoice.** `DEFAULT: only the difference moves stock. A kept item does not move, a removed item goes back to in stock, an added item is sold, and a bulk item moves by the change in its quantity. Each change has its own history or movement row with the reason.` Is that right, or should an edit that changes stock be refused and done by a void and a new invoice?

- **Q165. Stock places at start.** `DEFAULT: six places, seeded: Showroom (the default, cannot be made inactive), Display, Locker, Karigar, Testing centre, Refining centre. The owner adds, renames or makes inactive the others.` Are these the places you use, and is anything missing (for example a safe or a second counter)?
- **Q166. Transfer reason and who.** `DEFAULT: a reason is optional (up to 300 characters); anyone with inventory.edit (owner and manager) can make a transfer.` Should a transfer always need a reason, and should staff be able to move stock?
- **Q167. Bulk sale on an invoice.** `DEFAULT: an invoice sale takes from the Showroom balance until a place can be chosen on the invoice line. A sale Showroom cannot cover is refused, even when another place holds enough.` Is that right, or should the invoice line ask which place the goods come from?
- **Q168. Items that are not in stock.** `DEFAULT: only an item that is in stock and not voided can be transferred. Sold, reserved, on memo, returned, written off and voided items do not move; a sold item keeps the place where it was sold.` Should a reserved or returned item be movable?
- **Q169. Karigar place.** `DEFAULT: the Karigar location is a place name only for now. There is no karigar record or balance; spec 023 (karigar jobs) adds them. A place that still holds stock cannot be made inactive (added while building 021b, not asked before).` Is that right?
- **Q170. Purchase numbers.** `DEFAULT: PUR-0001, PUR-0002 and so on, one series for each financial year of the purchase date, starting again at 0001 on each 1 April (the same rule as the invoice series). The number is allocated in the same save as the purchase, so a failed save uses none.` Is that right, or should the financial year show in the number (PUR-2026-27-0001)?
- **Q171. GST and amounts on a purchase.** `DEFAULT: spec 022 calculates no GST and no payable total on a purchase. A purchase line may carry an optional amount that is typed in and stored for the record only.` Should the software calculate the purchase GST (input credit) and show it in the CA reports (requirements section 10 and report 43)? The CA decides the treatment.
- **Q172. Raw gold and silver.** `DEFAULT: a raw metal purchase adds raw stock by metal, purity and place, in milligrams. No item record and no U No. is made for raw metal.` Do you need the raw stock per bar or per lot, with its own number, or is the total by purity enough?
- **Q173. Jewellery made by a karigar.** `DEFAULT: a karigar name is required. Each finished piece becomes an individual item at the purchase place with its U No., and the shop metal used is recorded as raw stock going out, by metal, purity and place. That raw stock can never go below zero, and a save that would take it below zero is refused. Spec 023 (karigar jobs) may replace the metal part later.` Is that right, and is the metal used recorded on the purchase or on the karigar job?
- **Q174. Voiding a purchase.** `DEFAULT: a purchase can be voided only while everything it created or received is still untouched: each item is in stock and not voided, the bulk quantity is still at the place (not sold and not moved out of it), and the raw stock it added is not used. Otherwise the void is refused with 409 and nothing is written. A voided purchase keeps its lines and shows as void.` Should the owner be able to void a purchase after some of its items are sold, with a note instead?

## Z. Wave 3 questions for spec 025 (monthly stock reconciliation), default used until you answer

- **Q190. Opening moment.** `DEFAULT: the system figure is the stock at the moment the reconciliation is opened (not the 1st of the month, not a chosen date). A backdated opening is not built`. Should a count be able to start from the stock as at a past date?
- **Q191. Scope.** `DEFAULT: one place, or all active places. The hidden Missing place is never counted`. Is that right?
- **Q192. Pieces not found.** `DEFAULT: a piece not found is moved to the hidden place Missing by a transfer with the reason. Its status does not change. It cannot be sold while it is at Missing. A found piece is brought back by a reconciliation extra line`. Spec 020 has no missing status, and the status list cannot be changed without rebuilding the table. Do you want a visible Missing list, or a missing status in a later spec?
- **Q193. Sales during the count.** `DEFAULT: the difference is counted against the opening figure plus the movements since the opening, so a sale during the count is not a shortage`. Is that right?
- **Q194. Lines not counted.** `DEFAULT: the close is refused while any line is uncounted`. Should an uncounted line be treated as no change instead?
- **Q195. Reserved, on memo and returned pieces.** `DEFAULT: they are not in the system stock for the count. If one is found on the counter it is added as an extra line, and the close moves it to in stock`. Should they be counted as stock at their place?
- **Q196. Who closes.** `DEFAULT: anyone with reconciliation.edit (owner and manager), no second approval`. This answers Q78 for now. Should a negative difference need the owner's approval?
- **Q197. Extra pieces.** `DEFAULT: a found piece that is not in stock is put back in stock with a status history row and the reason, and moved to the counted place. A written-off piece is refused`. Is that right?
- **Q198. Reasons.** `DEFAULT: each adjustment gets an automatic reason naming the month and the count; the owner's note on a line is kept on the line`. Should the owner type a reason for each adjustment?
- **Q199. Bulk lines.** `DEFAULT: every bulk item gets a line at every place in scope, including those at zero, so that a surplus can be counted`. Is that right, or only items with a balance?
