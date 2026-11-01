CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`customer_no` text NOT NULL,
	`name` text NOT NULL,
	`name_search` text NOT NULL,
	`mobile` text,
	`alt_mobile` text,
	`address` text,
	`city` text,
	`pincode` text,
	`pan` text,
	`aadhaar` text,
	`notes` text,
	`voided_at` text,
	`voided_by` text,
	`void_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_customer_no_unique` ON `customers` (`customer_no`);--> statement-breakpoint
CREATE INDEX `customers_name_search_idx` ON `customers` (`name_search`);--> statement-breakpoint
CREATE INDEX `customers_mobile_idx` ON `customers` (`mobile`);--> statement-breakpoint
CREATE INDEX `customers_pan_idx` ON `customers` (`pan`);--> statement-breakpoint
CREATE UNIQUE INDEX `customers_pan_active_unique` ON `customers` (`pan`) WHERE "customers"."pan" IS NOT NULL AND "customers"."voided_at" IS NULL;