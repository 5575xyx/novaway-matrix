CREATE TABLE `goal` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`parent_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`success_criteria` text,
	`deadline` integer,
	`progress` real DEFAULT 0 NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `goal_session_idx` ON `goal` (`session_id`);
--> statement-breakpoint
CREATE INDEX `goal_status_idx` ON `goal` (`status`);
--> statement-breakpoint
CREATE INDEX `goal_parent_idx` ON `goal` (`parent_id`);
--> statement-breakpoint
ALTER TABLE `todo` ADD `goal_id` text;
