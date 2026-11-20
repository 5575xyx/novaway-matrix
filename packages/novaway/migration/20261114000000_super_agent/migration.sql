CREATE TABLE `super_agent_run` (
  `id` text PRIMARY KEY NOT NULL,
  `directory` text NOT NULL,
  `goal_json` text NOT NULL,
  `status` text NOT NULL,
  `graph_json` text NOT NULL,
  `budget_json` text NOT NULL,
  `usage_json` text NOT NULL,
  `failure_json` text,
  `completion_json` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `super_agent_run_directory_idx` ON `super_agent_run` (`directory`,`time_updated`);
--> statement-breakpoint
CREATE INDEX `super_agent_run_status_idx` ON `super_agent_run` (`status`);
--> statement-breakpoint
CREATE TABLE `super_agent_event` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `run_id` text NOT NULL,
  `sequence` integer NOT NULL,
  `type` text NOT NULL,
  `payload_json` text NOT NULL,
  `time_created` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `super_agent_run` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `super_agent_event_sequence_idx` ON `super_agent_event` (`run_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `super_agent_event_run_idx` ON `super_agent_event` (`run_id`,`time_created`);
--> statement-breakpoint
CREATE TABLE `super_agent_verification` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `task_id` text,
  `acceptance_id` text NOT NULL,
  `verifier_id` text NOT NULL,
  `verifier_version` text NOT NULL,
  `outcome` text NOT NULL,
  `measured` text,
  `evidence_json` text NOT NULL,
  `reason` text NOT NULL,
  `time_created` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `super_agent_run` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `super_agent_verification_run_idx` ON `super_agent_verification` (`run_id`,`time_created`);
