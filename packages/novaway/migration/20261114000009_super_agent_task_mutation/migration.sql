CREATE TABLE `super_agent_task_mutation` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `run_id` text NOT NULL,
  `graph_version` integer NOT NULL,
  `task_id` text NOT NULL,
  `from_status` text,
  `to_status` text NOT NULL,
  `before_json` text,
  `after_json` text NOT NULL,
  `time_created` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `super_agent_run` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `super_agent_task_mutation_run_idx` ON `super_agent_task_mutation` (`run_id`,`id`);
--> statement-breakpoint
CREATE INDEX `super_agent_task_mutation_task_idx` ON `super_agent_task_mutation` (`run_id`,`task_id`,`id`);
