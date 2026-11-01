CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`detail_json` text
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity`,`entity_id`,`at`);--> statement-breakpoint
CREATE TABLE `number_series` (
	`series` text NOT NULL,
	`fy` text NOT NULL,
	`last_no` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`series`, `fy`),
	CONSTRAINT "number_series_last_no_nonneg" CHECK("number_series"."last_no" >= 0)
);
--> statement-breakpoint
CREATE TABLE `record_revisions` (
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`reason` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	PRIMARY KEY(`entity`, `entity_id`, `revision_no`)
);
