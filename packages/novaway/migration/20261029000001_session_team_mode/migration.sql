ALTER TABLE `session` ADD `team_mode` text;
--> statement-breakpoint
ALTER TABLE `session` ADD `team_ids` text;
--> statement-breakpoint
ALTER TABLE `team` ADD `auto_eligible` integer DEFAULT 0 NOT NULL;
