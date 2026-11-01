CREATE TABLE `invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`line_no` integer NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`purity` text NOT NULL,
	`hsn` text NOT NULL,
	`gross_weight_mg` integer NOT NULL,
	`net_weight_mg` integer NOT NULL,
	`polish_mg` integer NOT NULL,
	`gold_rate_paise_per_kg` integer NOT NULL,
	`labour_rate_paise_per_kg` integer NOT NULL,
	`gst_rate_bps` integer NOT NULL,
	`chargeable_weight_mg` integer NOT NULL,
	`gold_amount_paise` integer NOT NULL,
	`labour_amount_paise` integer NOT NULL,
	`amount_paise` integer NOT NULL,
	`display_rate_paise_per_gram` integer NOT NULL,
	`inventory_item_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_lines_rev_line_unique` ON `invoice_lines` (`invoice_id`,`revision_no`,`line_no`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`invoice_no` text NOT NULL,
	`invoice_date` text NOT NULL,
	`customer_id` text,
	`customer_name` text NOT NULL,
	`customer_name_search` text NOT NULL,
	`customer_mobile` text,
	`customer_address` text,
	`customer_pan` text,
	`tax_mode` text NOT NULL,
	`reverse_charge` integer DEFAULT 0 NOT NULL,
	`remarks` text,
	`rates_json` text NOT NULL,
	`input_json` text NOT NULL,
	`taxable_paise` integer NOT NULL,
	`tax_paise` integer NOT NULL,
	`total_before_round_off_paise` integer NOT NULL,
	`round_off_paise` integer NOT NULL,
	`payable_paise` integer NOT NULL,
	`calc_json` text NOT NULL,
	`revision_no` integer DEFAULT 1 NOT NULL,
	`voided_at` text,
	`voided_by` text,
	`void_reason` text,
	CONSTRAINT "invoices_tax_mode_valid" CHECK("invoices"."tax_mode" IN ('intra', 'inter')),
	CONSTRAINT "invoices_payable_whole_rupees" CHECK("invoices"."payable_paise" >= 0 AND "invoices"."payable_paise" % 100 = 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_invoice_no_unique` ON `invoices` (`invoice_no`);--> statement-breakpoint
CREATE INDEX `invoices_date_idx` ON `invoices` (`invoice_date`,`created_at`);--> statement-breakpoint
CREATE INDEX `invoices_customer_idx` ON `invoices` (`customer_id`);--> statement-breakpoint
CREATE INDEX `invoices_name_search_idx` ON `invoices` (`customer_name_search`);--> statement-breakpoint
CREATE INDEX `invoices_mobile_idx` ON `invoices` (`customer_mobile`);