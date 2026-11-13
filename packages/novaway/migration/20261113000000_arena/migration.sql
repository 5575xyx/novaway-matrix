CREATE TABLE `arena_run` (
	`id` text PRIMARY KEY NOT NULL,
	`task` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`winner` text,
	`verified` integer DEFAULT false NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `arena_run_created_idx` ON `arena_run` (`created_at`);
--> statement-breakpoint
CREATE TABLE `arena_contender` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`contender_id` text NOT NULL,
	`status` text NOT NULL,
	`session_id` text,
	`directory` text,
	`text` text,
	`diff` text,
	`usage` text,
	`error` text,
	`duration_ms` integer,
	`verdict` text,
	`score` real,
	FOREIGN KEY (`run_id`) REFERENCES `arena_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `arena_contender_run_idx` ON `arena_contender` (`run_id`);
