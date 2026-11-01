CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`ip` text NOT NULL,
	`username` text
);
--> statement-breakpoint
CREATE INDEX `login_attempts_ip_at_idx` ON `login_attempts` (`ip`,`at`);--> statement-breakpoint
CREATE INDEX `login_attempts_at_idx` ON `login_attempts` (`at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`disabled_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);