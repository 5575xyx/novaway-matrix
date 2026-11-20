CREATE TABLE `super_agent_event_outbox` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `event_id` text NOT NULL,
  `run_id` text NOT NULL,
  `sequence` integer NOT NULL,
  `type` text NOT NULL,
  `payload_json` text NOT NULL,
  `status` text NOT NULL,
  `attempts` integer NOT NULL DEFAULT 0,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `super_agent_run` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `super_agent_event_outbox_event_idx` ON `super_agent_event_outbox` (`event_id`);
--> statement-breakpoint
CREATE INDEX `super_agent_event_outbox_pending_idx` ON `super_agent_event_outbox` (`run_id`,`status`,`id`);
