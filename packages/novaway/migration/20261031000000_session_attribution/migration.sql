ALTER TABLE `session` ADD `employee_id` text;
--> statement-breakpoint
ALTER TABLE `session` ADD `run_id` text;
--> statement-breakpoint
CREATE INDEX `session_employee_idx` ON `session` (`employee_id`);
--> statement-breakpoint
CREATE INDEX `session_run_idx` ON `session` (`run_id`);
