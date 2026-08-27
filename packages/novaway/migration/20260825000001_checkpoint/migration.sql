CREATE TABLE `session_checkpoint` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`reason` text,
	`tags` text DEFAULT '[]',
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_checkpoint_session_idx` ON `session_checkpoint` (`session_id`);
--> statement-breakpoint
CREATE INDEX `session_checkpoint_created_idx` ON `session_checkpoint` (`created_at`);
--> statement-breakpoint
CREATE TABLE `session_checkpoint_state` (
	`session_id` text PRIMARY KEY NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`last_checkpoint_id` text,
	`last_checkpoint_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_checkpoint_state_updated_idx` ON `session_checkpoint_state` (`time_updated`);
