CREATE TABLE `orchestrator_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`tasks` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `orchestrator_plan_session_idx` ON `orchestrator_plan` (`session_id`);
--> statement-breakpoint
CREATE INDEX `orchestrator_plan_status_idx` ON `orchestrator_plan` (`status`);
