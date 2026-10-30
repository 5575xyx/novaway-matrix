CREATE TABLE `team_mission` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`directory` text NOT NULL,
	`goal` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`base_sha` text,
	`worktree` text,
	`branch` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_mission_number` ON `team_mission` (`number`);
--> statement-breakpoint
CREATE INDEX `team_mission_status_idx` ON `team_mission` (`status`);
--> statement-breakpoint
ALTER TABLE `team_run` ADD `mission_id` text;
--> statement-breakpoint
CREATE INDEX `team_run_mission_idx` ON `team_run` (`mission_id`);
