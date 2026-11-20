ALTER TABLE `super_agent_run` ADD COLUMN `checkpoint_id` text;
--> statement-breakpoint
ALTER TABLE `super_agent_event` ADD COLUMN `event_id` text;
--> statement-breakpoint
ALTER TABLE `super_agent_event` ADD COLUMN `protocol_version` text NOT NULL DEFAULT 'sa.event.v1';
--> statement-breakpoint
ALTER TABLE `super_agent_event` ADD COLUMN `idempotency_key` text;
--> statement-breakpoint
UPDATE `super_agent_event` SET `event_id` = 'legacy:' || CAST(`id` AS TEXT) WHERE `event_id` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `super_agent_event_id_idx` ON `super_agent_event` (`event_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `super_agent_event_idempotency_idx` ON `super_agent_event` (`run_id`,`idempotency_key`);
--> statement-breakpoint
CREATE TABLE `super_agent_checkpoint` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `reason` text NOT NULL,
  `event_sequence` integer NOT NULL,
  `state_version` integer NOT NULL,
  `snapshot_json` text NOT NULL,
  `time_created` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `super_agent_run` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `super_agent_checkpoint_run_idx` ON `super_agent_checkpoint` (`run_id`,`time_created`);
