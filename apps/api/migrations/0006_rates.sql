CREATE TABLE `rates` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`rate_date` text NOT NULL,
	`kind` text NOT NULL,
	`price_paise_per_kg` integer NOT NULL,
	CONSTRAINT "rates_price_positive" CHECK("rates"."price_paise_per_kg" > 0),
	CONSTRAINT "rates_kind_valid" CHECK("rates"."kind" IN ('gold_24k995', 'gold_22k916', 'silver'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rates_date_kind_unique` ON `rates` (`rate_date`,`kind`);--> statement-breakpoint
CREATE INDEX `rates_kind_date_idx` ON `rates` (`kind`,`rate_date`);