# Owner's answers to the requirements questionnaire (2026-11-01)

A condensed record of the owner's 53 answers and the "critical development instructions", with what each one changes. The owner's own words are kept where the wording matters. Numbers in brackets are the owner's question numbers. Locked decisions that follow are in `docs/decisions.md` (D13 onward). New questions raised by these answers are in `docs/open-questions.md` (section M).

## A. Documents
- [1, 2] The owner has the existing invoice, settlement, payment receipt, old gold receipt and advance booklet formats. Actual customer papers are not to be shared. Four reference PDFs were then shared: see `docs/reference-formats.md`.
- [3] Daily rates 24K995 and 22K916, entered and stored date-wise (spec 011, done).

## B. Invoice calculation
- [4] **HSN 9988 job work.** Labour / job-work amount = `((Net Weight + Polish Weight) x (Gold Rate + Labour Rate)) - (Net Weight x Gold Rate)`. GST 5%. Gold rate and labour rate are separate internal fields. Display rate = amount / (net + polish). For 9988 the display rate is the calculated rate. No other labour calculation.
- [5] **Polish** is a percentage: `Polish Weight = Net Weight x Polish %`. The calculated weight is shown in the Wastage column.
- [6] **Labour** rate is typed per gram, per invoice row. Nothing hard-coded.
- [7] **Display rate** = amount / (net + polish), calculated.
- [8] **HSN**: only two to start: jewellery (3%) and job work 9988 (5%). No other categories.
- [9] **Stones and diamonds**: both methods, chosen per item: separate gold and stone weights and amounts, or combined weight and total amount.
- [10] **Discounts** on the gold amount, on labour, and on the invoice total, each as a fixed amount or a percentage, chosen per transaction.
- [11] **Round-off** on the final total only: below 50 paise down, 50 or more up.
- [12] Regular GST scheme, Himachal Pradesh, state code 02. CGST + SGST within the state, IGST for other states.
- [13] HUID printing is not required.
- [14] Show purity (22K916, 18K750, 14K...) clearly. The BIS logo is optional.

## C. Header and printing
- [15] Header: legal name, address, GSTIN, phone, email, bank details (printed), terms and declaration. Details to be provided separately.
- [16] Printer **Brother DCP-T830DW**, automatic duplex. Page 1 invoice, page 2 settlement on the back of the same A4 sheet, correct orientation and alignment.
- [17] Invoice A4 landscape. Payment receipt and old gold receipt A5 landscape, printed on A4 to cut or tear. Plain paper, full design printed.
- [18] Separate sequences for invoices, payment receipts and old gold receipts, each reset every 1 April.

## D. Payments, advances, settlement
- [19] Several advances per customer order, each with its own receipt number, linked to one order. Old-booklet advances can be entered as opening/previous advances (not new receipts). At final billing both are available. Only the amount used is deducted, the rest stays in the customer's account.
- [20] Order cancellation: either move the remaining advance to the customer's account or refund it, user's choice, with history.
- [21] One payment can cover several invoices of the same customer: manual choice, else oldest first (FIFO), the rest becomes advance. Keep reference and allocation history.
- [22] **Credit sales (udhaar) with the rate fixed later**: no gold rate at the time of sale, the rate is fixed when the customer pays, the payable amount uses that day's rate. Recorded as "pending rate fixation", then the final amount is saved, with partial payments and several dates. Separate from normal credit sales with a fixed amount.
- [23] Cheques: Received, Deposited, Cleared, Bounced. A bounce reverses the payment entry and restores the outstanding balance, keeping the record and history.
- [24] Cash limit: a configurable warning, never a block.
- [25] Returns and exchanges: credit note, a new invoice adjusted against the old one, or old gold adjustment. Links to the original invoice, with stock and balances updated.
- [26] Free-text, editable settlement remarks.

## E. Old gold
- [27] `Amount = Net Weight x Purity Percentage x Applicable Rate`. No extra melting-loss or impurity deduction unless specified.
- [28] 22K and 24K. The buying rate is typed on each receipt, never fetched.
- [29] Accounting, GST and stock treatment: the CA decides. Nothing to be assumed until then.
- [30] Linked to an invoice, or standalone. Both give an old gold receipt and customer records.

## F. Customers
- [31] Automatic unique customer ID. Several customers may share a mobile number. Mobile is searchable, not an identifier.
- [32] PAN and Aadhaar optional.
- [33] Start with a fresh customer list. No import.
- [34] Opening balances: amounts customers owe, and advances held for customers. Not treated as new sales or payments, with remarks and reference.

## G. Inventory, purchase, karigar
- [35] Individual records for ornaments with a unique U No. per item or pair. Small bulk items such as Tilli are tracked by quantity without a U No. each. Weight, purity, item code, stock status.
- [36] U No.: the first four characters are the item code and the last two digits a serial that restarts for each item code. Examples given: `RING01`, `RING02`, `CHAIN01`, `CHAIN02`, `T00001`, `T00002`. No duplicates. (The examples do not all fit the rule. See Q65.)
- [37] Monthly physical stock check: system quantity and weight against counted, the difference, and adjustments with remarks and history.
- [38] Several stock locations, configurable, with transfers, location-wise reports and history. Examples: showroom, display, locker, karigar, testing centre, refining centre.
- [39] Three purchase types: finished jewellery from wholesalers, raw gold and silver, and jewellery made by karigars from the shop's own metal.
- [40] Karigar jobs: metal issued (weight, purity), finished goods received, wastage, labour charges, balance with the karigar, job-wise and karigar-wise history, partial returns and several deliveries per job.
- [41] Refining and purity testing later, but the design must let them be added without changing inventory and karigar records.

## H. Dashboard, reports, closing
- [42] Dashboard: today's sales, payments received today, total outstanding, total customer advances, advances received today. Also monthly sales and payment summaries.
- [43] CA reports in Excel and PDF: sales and GST, purchases, credit notes, payment collections, outstanding, advances, old gold. Filter by date and financial year.
- [44] Daily cash closing: opening cash, cash in, cash out, expected closing, counted cash, difference, remarks, history by date.

## I. Devices, staff, reliability
- [45] Windows PCs for billing and admin, several Android phones, one central database, sync everywhere, access from outside the showroom over the internet subject to permissions.
- [46] Owner, family members and employees each have a separate login, role-based permissions, and a user-wise activity history.
- [47] **Offline-first on the showroom PC**: invoices, receipts and old gold work with no internet, data kept on the PC, internet only to synchronise. A manual "Sync Now". No duplicates or loss when syncing.
- [48] Android access follows the login role. Viewing and, where permitted, creating and editing from Android. One permission system for PC and Android.
- [49] Backups to the cloud and to the local PC, automatic daily, manual download, full restore, several versions.
- [50] The new site eventually replaces the Excel inventory and the HTML billing system, only after full testing.

## J. Rollout
- [51 to 53] Four months of parallel testing next to the existing system (which stays primary), owner, family, staff and developer testing with their own logins, real printing on the Brother. **Full use from 1 April 2027**, so the four months of testing run from about **1 December 2026**.

## Critical instructions
1. Preserve the existing invoice calculations and print layout. 2. Do not change page 1 of the invoice unnecessarily. 3. The existing v84 settlement behaviour is the reference (decision D1 said no v84 file exists, see Q66). 4. An old gold receipt entered from the invoice only transfers its details and reference to the settlement page, which recalculates. 5. Do not break payment and advance linking. 6. No duplicate payments, advance adjustments or stock movements. 7. One properly designed database. 8. Test with real business scenarios. 9. Offline-first PC billing and reliable sync are essential. 10. Finish testing before replacing the old systems.
