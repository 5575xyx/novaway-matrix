CREATE TABLE `background_job` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`output` text,
	`error` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `background_job_status_idx` ON `background_job` (`status`);
