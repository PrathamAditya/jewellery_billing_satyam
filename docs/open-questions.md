# Open questions

One place for everything that is not answered yet. Claude adds to this file instead of asking in chat. When the owner brings the receipts and answers, we go through it top to bottom, move each answered item into `docs/decisions.md` (or the spec it affects), and tick it here.

Last updated: 2026-11-01. Status: `OPEN` waiting for an answer, `DEFAULT` Claude chose a default so work is not blocked (change it if wrong), `DONE` answered.

How to answer: a photo of the paper document is the best answer. Write the answer next to the question or just say the number (for example "Q7: percentage, e.g. 2%"). Remove customer names, GSTIN, PAN and phone numbers from anything that goes into git. They are entered in the app's Settings, not in the repo.

---

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
