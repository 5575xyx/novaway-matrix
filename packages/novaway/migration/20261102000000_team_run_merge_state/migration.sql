ALTER TABLE `team_run` ADD `merge_state` text DEFAULT 'unmerged' NOT NULL;
--> statement-breakpoint
ALTER TABLE `team_run` ADD `merged_at` integer;
