CREATE TABLE `super_agent_approval` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `task_id` text NOT NULL,
  `reason` text NOT NULL,
  `scope` text NOT NULL,
  `status` text NOT NULL,
  `decided_by` text,
  `decision_reason` text,
  `time_expires` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `super_agent_run` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `super_agent_approval_run_idx` ON `super_agent_approval` (`run_id`,`time_updated`);
--> statement-breakpoint
CREATE TABLE `super_agent_input` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `task_id` text NOT NULL,
  `prompt` text NOT NULL,
  `status` text NOT NULL,
  `answer` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `super_agent_run` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `super_agent_input_run_idx` ON `super_agent_input` (`run_id`,`time_updated`);
