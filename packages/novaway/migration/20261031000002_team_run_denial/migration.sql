CREATE TABLE `team_run_denial` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`tool` text NOT NULL,
	`action` text NOT NULL,
	`reason` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_run_denial_action` ON `team_run_denial` (`run_id`,`action`);
--> statement-breakpoint
CREATE INDEX `team_run_denial_run_idx` ON `team_run_denial` (`run_id`);
