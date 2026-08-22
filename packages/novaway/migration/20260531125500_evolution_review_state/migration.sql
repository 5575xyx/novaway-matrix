CREATE TABLE `evolution_review_state` (
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
CREATE INDEX `evolution_review_state_project_idx` ON `evolution_review_state` (`project_id`);
