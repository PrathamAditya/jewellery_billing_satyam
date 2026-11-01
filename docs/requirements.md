# Jewellery Billing, Inventory & Business Management Website

Original requirements as supplied by the owner on 2026-11-01. Kept verbatim as the source of truth. Where a later decision changes something (for example no v84 baseline, Android view-only in v1), `docs/decisions.md` wins.

## Complete Functional Requirements

### 1. Project Objective

Build a complete web-based billing and inventory management system for a gold and silver jewellery showroom.

The system must:

- Work on Windows PC and Android phones.
- Allow invoices to be generated and printed from the PC.
- Automatically synchronize saved invoices and other records to Android.
- Provide a mobile-friendly dashboard.
- Maintain a common database for all devices.
- Support GST billing, payments, advances, old-gold purchases, inventory and customer accounts.
- Be reliable and preserve historical transaction records.

*Important:* The system is specifically for jewellery retail. It should not be designed as a generic GST billing application.

---

# 2. Platform and Database Requirements

### 2.1 PC and Android

- Website must work on desktop and Android.
- Android dashboard should be responsive and easy to navigate.
- PC should have the full billing interface.
- Invoices generated on PC must automatically appear on Android.
- Payments, customer details, inventory and other records must be shared between devices.
- Changes made on one device must reflect on the other.
- Prefer an installable PWA (Progressive Web App).

### 2.2 Database

- Use a centralized database accessible from both devices.
- Do not depend on browser-only storage as the permanent database.
- Every invoice, payment receipt and old-gold receipt must have a unique ID.
- Maintain relationships between invoices, receipts, customers and inventory records.
- Prevent duplicate entries.
- Maintain transaction history.
- Provide automatic backup and data recovery.
- Preserve historical records even when a customer or transaction is edited.

### 2.3 Internet and Offline Functionality

- PC billing should ideally continue working during internet outages.
- Save transactions locally when offline and synchronize when internet returns.
- Prevent duplicate synchronization.
- Handle conflicts safely.

---

# 3. Main Modules

The website should contain the following modules:

1. Dashboard
2. Invoice / Sales Billing
3. Payment Receipt
4. Old Gold Purchase
5. Customer Management
6. Customer Ledger
7. Advance Payment Management
8. Inventory Management
9. Purchase Management
10. Karigar / Job Work Management
11. Gold and Silver Rate Management
12. Reports
13. Settings and Backup

---

# 4. Invoice / Sales Billing Module

### 4.1 Invoice Design

- A4 landscape invoice.
- Professional jewellery showroom invoice.
- BIS hallmark logo.
- Clearly highlight 22K (916) purity where applicable.
- Invoice should have a first page containing billing details and a second settlement page.
- Settlement details should print on the back side of the invoice when using duplex printing or on the corresponding second page.
- Maintain a professional, compact layout.

### 4.2 Customer Details

- Customer name.
- Mobile number.
- Address.
- PAN.
- Aadhaar, where required.
- Customer identification and search.
- Load existing customer details automatically.

### 4.3 Item Details

Each invoice item should support:

- Item description.
- HSN code.
- Gross Weight (GW).
- Net Weight (NW).
- Polish / wastage.
- Gold rate.
- Labour rate.
- Display rate.
- Amount.
- GST rate.

Gold rate and labour rate should be separately maintained internally.

### 4.4 Gold Purity

Support:

- 22K916
- 18K750
- 14K
- 24K995
- 24K999
- Other required purities.

### 4.5 Rate and Amount Calculations

- Normally, internal rate = Gold Rate + Labour Rate.
- Display Rate = Amount / (Net Weight + Polish).
- Amount = (Net Weight + Polish) × applicable rate.
- Provide separate Gold Rate and Labour Rate fields.
- Option to use the same rate for the first row and subsequent rows.
- This option must not appear on the printed invoice.

### 4.6 Labour and GST

Support:

- 3% GST for jewellery.
- 5% GST for applicable job-work transactions.
- HSN-based GST calculation.
- When HSN is 9988, apply the specified job-work calculation.
- For HSN 9988, display Rate should be the calculated display rate.
- Labour and GST calculations should be accurate and separately traceable.

### 4.7 Round-off

- Below 50 paise: round down to the nearest rupee.
- 50 paise or above: round up to the nearest rupee.

### 4.8 Invoice Management

- Save invoice.
- Edit invoice.
- Reprint invoice.
- Search by invoice number, customer name and mobile number.
- View invoice history.
- Load invoice for payment receipt and settlement.
- Maintain invoice date and invoice number.
- Preserve the original invoice calculations and transaction details.

---

# 5. Payment Receipt Module

### 5.1 Receipt Format

- A5 landscape.
- Print on A4 paper and tear/fold as required.
- Maximum two payment rows.
- Customer name and mobile number.
- Receipt number and date.
- Payment amount.
- Payment mode.
- Reference number.
- Signature area.

### 5.2 Payment Modes

- UPI
- Cash
- Card
- Cheque
- Bank transfer.

### 5.3 Payment Types

Support:

- Payment against invoice.
- Advance payment.
- Previous advance.
- Later payment.
- Payment received at the time of sale.
- Multiple partial payments.

### 5.4 Payment Linking

- Payment receipts must link to the relevant invoice or customer.
- Allow loading an existing invoice.
- Allow creating a blank payment receipt.
- Allow searching by customer name or receipt number.
- Payments received at the time of sale should also appear in the payment history.
- Do not create an unnecessary separate receipt serial number for payments already recorded directly in the invoice.

### 5.5 Advance Payments

- Multiple advance payments can belong to one order.
- Maintain a common order reference internally.
- Show individual payment receipt numbers on the frontend.
- Show remarks for partial advances.
- Previous advances recorded in the old booklet should be entered as opening/previous advances.
- Existing advance receipts should be linkable to an invoice that has not yet been saved.

---

# 6. Old Gold Purchase Module

### 6.1 Receipt Format

- A5 landscape.
- Customer details.
- Receipt number and date.
- Gross weight.
- Net weight.
- Purity.
- Rate.
- Amount.
- Payment/settlement details.

### 6.2 Purity Selection

- 22K gold.
- 24K gold.
- Support adding old gold to the appropriate inventory category after the accounting treatment is finalized.

### 6.3 Amount Calculation

Old gold amount:

Net Weight × Purity Percentage × Applicable Rate

### 6.4 Four Settlement Cases

The system must support four cases:

*Case 1: Direct payment to customer*

- Pay customer through bank transfer, UPI or cheque.
- No cash or card payment option for this workflow.

*Case 2: Transfer old-gold value to customer advance*

- The amount is added to the customer's advance balance.
- Generate/link the appropriate receipt.

*Case 3: Direct adjustment against invoice*

- Old-gold value is deducted from the invoice.
- Record the adjustment in the settlement.

*Case 4: Split settlement*

- Divide old-gold value between direct payment and customer advance or invoice adjustment.

### 6.5 Old Gold and Main Invoice Linking

This is particularly important.

When an old-gold receipt is entered from the main invoice:

- Do not change the first page of the invoice.
- Do not change the existing invoice item calculations.
- Do not redesign the invoice.
- Only transfer the old-gold receipt details and reference number to the settlement page.
- Recalculate the settlement automatically.
- The settlement page must retain its existing functionality.
- Old-gold receipt reference number must be visible in the settlement.

*The existing v84 settlement functionality is the reference for this behaviour.* (Superseded by decision D1: no v84 file exists, so this is built fresh from section 7.)

---

# 7. Settlement Module

The settlement page should calculate everything automatically.

It must support:

- Main invoice amount.
- GST.
- Old-gold adjustment.
- Payments received at the time of sale.
- Previous advances.
- New advance payments.
- Later payments.
- Outstanding balance.
- Settlement notes and remarks.

### Requirements

- Display invoice number, invoice date and customer name in the settlement header.
- Display all linked payment and old-gold receipt references.
- Automatically recalculate the balance when payments or adjustments are added.
- Show the amount received and remaining balance.
- Maintain settlement notes and remarks after saving.
- Do not clear settlement notes when clearing or resetting other form fields.
- Support partial settlements.

### Advance Adjustment Logic

- When an advance is used, deduct only the amount allocated to the invoice.
- The unused advance must remain available.
- The same advance must not be counted twice.
- An advance should appear in Payments Received and Available Advance Payments.
- Partial use should reduce only the allocated amount.

---

# 8. Customer Management and Ledger

Maintain a centralized customer database.

### Customer information

- Customer name.
- Mobile number.
- Address.
- PAN.
- Aadhaar, where required.
- Customer ID.

### Customer ledger

For each customer, show:

- All invoices.
- All payment receipts.
- Old-gold purchases.
- Advance payments.
- Advance adjustments.
- Outstanding balance.
- Payment history.
- Transaction dates.

A customer ID should allow loading customer information across invoice, payment receipt and old-gold purchase modules.

When an existing transaction is edited, create a new revision/record identity as appropriate while preserving the original transaction history.

---

# 9. Inventory Management

Maintain separate inventory categories:

1. 24K Gold
2. 22K Gold Ornaments
3. 18K Gold Ornaments
4. 14K Gold Ornaments
5. Diamond
6. Silver Ornaments

### Inventory requirements

- Stock inward.
- Stock outward.
- Current stock quantity.
- Gross weight.
- Net weight.
- Purity.
- Item code.
- Unique U No.
- Purchase cost.
- Selling price.
- Location.
- Stock history.

### Important automation

- When an invoice is saved, the corresponding inventory must reduce automatically.
- When a purchase is saved, inventory should increase according to the relevant item and quantity.
- Avoid entering the same item separately in multiple modules.
- Maintain proper stock movement history.

### U No. System

- Unique item identification.
- Standardized U No. format.
- First four characters represent the item code.
- Last two digits represent the serial number.
- Prevent duplicate U Nos.
- Support automatic U No. generation.

---

# 10. Purchase and Karigar Management

### Purchase Management

- Purchase entry.
- Supplier details.
- Item details.
- Quantity.
- Weight.
- Purity.
- Purchase rate.
- Purchase amount.
- GST.
- Stock inward.

### Karigar Management

- Record gold issued to karigar.
- Record ornaments received back.
- Track weight issued and received.
- Track labour charges.
- Track wastage and manufacturing loss.
- Track purity changes.
- Maintain outstanding gold with each karigar.
- Maintain job-work history.

### Refining and Testing

The system should eventually support:

- Gold sent for purity testing.
- Testing quantity.
- Test results.
- Refining.
- Gold loss.
- Refined quantity and purity.
- Gold balance after refining.

---

# 11. Gold and Silver Rate Management

Maintain daily rates.

Support:

- 24K995 rate.
- 22K916 rate.
- Silver rate.

Requirements:

- Save rates date-wise.
- Use the applicable rate when creating invoices.
- Preserve the historical rate on saved invoices.
- Changing today's rate must not change old invoices.

---

# 12. Dashboard and Reports

### Dashboard summary

- Today's sales.
- Monthly sales.
- Total sales.
- Payments received.
- Outstanding customer balances.
- Customer advances.
- Old-gold purchases.
- Inventory value.
- Low-stock alerts.

### Reports

- Daily sales report.
- Monthly sales report.
- Date-wise invoice report.
- GST report.
- Payment collection report.
- Payment mode report.
- Outstanding balance report.
- Customer ledger.
- Advance payment report.
- Old-gold purchase report.
- Inventory report.
- Purchase report.
- Karigar outstanding report.
- Stock movement report.

### Dashboard on Android

- All important figures should be visible on mobile.
- Show recent invoices.
- Show recent payments.
- Search invoices.
- Check customer outstanding balances.
- View inventory.
- Data must synchronize with PC automatically.

---

# 13. Printing Requirements

Printing is very important for this business.

- Invoice: A4 landscape.
- Settlement: second page/back side.
- Payment receipt: A5 landscape.
- Old-gold purchase receipt: A5 landscape.
- Support printing on A4 paper.
- Maintain correct margins and alignment.
- Do not print internal calculation fields or interface controls.
- Support the Brother printer.
- Reprinting must not create a new transaction.

---

# 14. Data Security and Backup

- Automatic database backup.
- Manual backup option.
- Restore backup.
- Transaction history.
- Prevent accidental deletion.
- User login and authentication.
- Access permissions if multiple employees use the system.
- Secure communication between PC and server.
- Prevent duplicate invoices and payments.
- Maintain reliable records of all changes.

---

# 15. Important Development Instructions

These instructions must be followed throughout development.

1. Do not unnecessarily change existing functionality.
2. Do not change the first page of the invoice when adding new modules.
3. Do not break the settlement page.
4. Use the existing v84 settlement behaviour as the baseline. (Superseded by D1.)
5. Keep invoice, payment receipt and old-gold purchase interconnected.
6. Do not calculate the same payment twice.
7. Do not duplicate inventory entries.
8. All financial calculations must be consistent.
9. Preserve historical transactions.
10. Test all printing layouts before final delivery.
11. Make PC and Android use the same underlying database.
12. Build the system in modules so that changes in one module do not break another.

---

# 16. Suggested Development Sequence

Build in this order:

*Phase 1: Core System*

- Database design.
- Customer management.
- Invoice module.
- Payment receipt module.
- Old-gold purchase module.
- Settlement linking.

*Phase 2: Inventory*

- Inventory categories.
- Purchase management.
- U No. generation.
- Automatic stock adjustment.
- Karigar management.

*Phase 3: Dashboard*

- Sales summaries.
- Payment summaries.
- Outstanding balances.
- Customer ledger.
- Reports.

*Phase 4: Cross-device Support*

- Android responsive dashboard.
- Shared database.
- Automatic synchronization.
- Login and permissions.
- Offline support.

*Phase 5: Reliability*

- Backup and recovery.
- Audit history.
- Testing.
- Printing verification.
- Data integrity checks.

---

# 17. Decisions That Need Confirmation Before Development

Some things should not be assumed:

- Exact accounting and GST treatment of old-gold purchases: to be decided by the CA.
- Exact inventory accounting treatment of old gold: to be finalized with the CA.
- Whether employees need separate logins and permissions.
- Whether Android will initially be view-only or also support creating transactions.
- Exact offline synchronization architecture.

*Final objective:* Build a reliable jewellery showroom management system in which PC billing, Android dashboard, customer accounts, payment receipts, old-gold purchases, settlement and inventory all work together using one shared database, without compromising the existing billing and printing workflows.
