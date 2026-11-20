CREATE TABLE `super_agent_operation` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `instruction_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `status` text NOT NULL,
  `lease_until` integer NOT NULL,
  `time_started` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `result_json` text,
  `reason` text,
  FOREIGN KEY (`run_id`) REFERENCES `super_agent_run` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `super_agent_operation_idempotency_idx` ON `super_agent_operation` (`run_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `super_agent_operation_run_idx` ON `super_agent_operation` (`run_id`,`time_updated`);
--> statement-breakpoint
CREATE INDEX `super_agent_operation_lease_idx` ON `super_agent_operation` (`status`,`lease_until`);
