CREATE TABLE `goal_budget` (
	`goal_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`turns` integer DEFAULT 0 NOT NULL,
	`tokens` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goal`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `goal_budget_session_idx` ON `goal_budget` (`session_id`);
