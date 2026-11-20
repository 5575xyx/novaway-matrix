CREATE TABLE `super_agent_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `task_id` text NOT NULL,
  `kind` text NOT NULL,
  `source` text NOT NULL,
  `content_hash` text,
  `measured` text,
  `time_captured` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `super_agent_run` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `super_agent_evidence_run_idx` ON `super_agent_evidence` (`run_id`,`time_captured`);
