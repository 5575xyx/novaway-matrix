CREATE TABLE `evolution_candidate` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`session_id` text,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`reason` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`source_message_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	`time_applied` integer,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `evolution_candidate_project_idx` ON `evolution_candidate` (`project_id`);
--> statement-breakpoint
CREATE INDEX `evolution_candidate_session_idx` ON `evolution_candidate` (`session_id`);
--> statement-breakpoint
CREATE INDEX `evolution_candidate_kind_idx` ON `evolution_candidate` (`kind`);
--> statement-breakpoint
CREATE INDEX `evolution_candidate_status_idx` ON `evolution_candidate` (`status`);
--> statement-breakpoint
CREATE INDEX `evolution_candidate_source_idx` ON `evolution_candidate` (`source_message_id`);
