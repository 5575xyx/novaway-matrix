CREATE TABLE `super_agent_budget_reservation` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `requested_json` text NOT NULL,
  `settled_json` text,
  `status` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `super_agent_run` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `super_agent_budget_reservation_run_idx` ON `super_agent_budget_reservation` (`run_id`,`time_updated`);
