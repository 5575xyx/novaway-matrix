CREATE TABLE `memory_relation` (
  `id` text PRIMARY KEY NOT NULL,
  `memory_id` text,
  `project_id` text,
  `session_id` text,
  `source` text NOT NULL,
  `source_type` text,
  `relation` text NOT NULL,
  `target` text NOT NULL,
  `target_type` text,
  `confidence` real DEFAULT 0.7 NOT NULL,
  `valid_from` integer,
  `valid_to` integer,
  `last_confirmed_at` integer,
  `origin_message_id` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`memory_id`) REFERENCES `memory_entry`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `memory_relation_memory_idx` ON `memory_relation` (`memory_id`);
--> statement-breakpoint
CREATE INDEX `memory_relation_project_idx` ON `memory_relation` (`project_id`);
--> statement-breakpoint
CREATE INDEX `memory_relation_session_idx` ON `memory_relation` (`session_id`);
--> statement-breakpoint
CREATE INDEX `memory_relation_source_idx` ON `memory_relation` (`source`);
--> statement-breakpoint
CREATE INDEX `memory_relation_target_idx` ON `memory_relation` (`target`);
--> statement-breakpoint
CREATE INDEX `memory_relation_relation_idx` ON `memory_relation` (`relation`);
--> statement-breakpoint
CREATE INDEX `memory_relation_valid_to_idx` ON `memory_relation` (`valid_to`);
