CREATE TABLE `queue_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`queue_id` integer NOT NULL,
	`cycle` integer NOT NULL,
	`telegram_id` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`joined_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`queue_id`) REFERENCES `queues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`telegram_id`) REFERENCES `users`(`telegram_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `queue_entries_cycle_user_unique` ON `queue_entries` (`queue_id`,`cycle`,`telegram_id`);--> statement-breakpoint
CREATE INDEX `queue_entries_current_idx` ON `queue_entries` (`queue_id`,`cycle`);--> statement-breakpoint
CREATE TABLE `queues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject_key` text NOT NULL,
	`subject_name` text NOT NULL,
	`subject_abbrev` text NOT NULL,
	`subgroup` integer NOT NULL,
	`current_cycle` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`closed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `queues_subject_subgroup_unique` ON `queues` (`subject_key`,`subgroup`);--> statement-breakpoint
CREATE TABLE `rotations` (
	`subject_key` text NOT NULL,
	`subgroup` integer NOT NULL,
	`last_served_telegram_id` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`subject_key`, `subgroup`),
	FOREIGN KEY (`last_served_telegram_id`) REFERENCES `users`(`telegram_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`telegram_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`telegram_id`) REFERENCES `users`(`telegram_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`telegram_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`telegram_id` text PRIMARY KEY NOT NULL,
	`username` text,
	`first_name` text NOT NULL,
	`last_name` text,
	`display_name` text NOT NULL,
	`photo_url` text,
	`subgroup` integer,
	`rotation_order` integer,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_subgroup_rotation_unique` ON `users` (`subgroup`,`rotation_order`);