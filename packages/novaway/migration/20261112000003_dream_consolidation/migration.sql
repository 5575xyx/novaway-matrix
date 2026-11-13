CREATE TABLE `dream_state` (
	`project_id` text PRIMARY KEY NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`last_run_at` integer,
	`cursor_at` integer,
	`lock_owner` text,
	`lock_expires_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `memory_consolidation` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`session_id` text,
	`op` text NOT NULL,
	`memory_id` text,
	`before` text,
	`after` text,
	`source` text DEFAULT 'dream' NOT NULL,
	`state` text DEFAULT 'prepared' NOT NULL,
	`note` text,
	`run_at` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `memory_consolidation_project_idx` ON `memory_consolidation` (`project_id`);
--> statement-breakpoint
CREATE INDEX `memory_consolidation_session_idx` ON `memory_consolidation` (`session_id`);
--> statement-breakpoint
CREATE INDEX `memory_consolidation_state_idx` ON `memory_consolidation` (`state`);
--> statement-breakpoint
CREATE INDEX `memory_consolidation_run_idx` ON `memory_consolidation` (`run_at`);
