CREATE TABLE `memory_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`session_id` text,
	`target` text NOT NULL,
	`scope` text NOT NULL,
	`content` text NOT NULL,
	`summary` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`importance` real DEFAULT 0.5 NOT NULL,
	`source` text NOT NULL,
	`origin_message_id` text,
	`created_by` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	`time_archived` integer,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `memory_entry_project_idx` ON `memory_entry` (`project_id`);
--> statement-breakpoint
CREATE INDEX `memory_entry_session_idx` ON `memory_entry` (`session_id`);
--> statement-breakpoint
CREATE INDEX `memory_entry_target_scope_idx` ON `memory_entry` (`target`,`scope`);
--> statement-breakpoint
CREATE INDEX `memory_entry_archived_idx` ON `memory_entry` (`time_archived`);
--> statement-breakpoint
CREATE TABLE `memory_review_candidate` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`session_id` text,
	`target` text NOT NULL,
	`scope` text NOT NULL,
	`content` text NOT NULL,
	`summary` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`importance` real DEFAULT 0.5 NOT NULL,
	`reason` text NOT NULL,
	`source_message_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	`time_applied` integer,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `memory_review_candidate_project_idx` ON `memory_review_candidate` (`project_id`);
--> statement-breakpoint
CREATE INDEX `memory_review_candidate_session_idx` ON `memory_review_candidate` (`session_id`);
--> statement-breakpoint
CREATE INDEX `memory_review_candidate_status_idx` ON `memory_review_candidate` (`status`);
--> statement-breakpoint
CREATE INDEX `memory_review_candidate_source_idx` ON `memory_review_candidate` (`source_message_id`);
--> statement-breakpoint
CREATE TABLE `memory_review_state` (
	`session_id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`last_reviewed_message_id` text,
	`last_reviewed_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_review_state_project_idx` ON `memory_review_state` (`project_id`);
