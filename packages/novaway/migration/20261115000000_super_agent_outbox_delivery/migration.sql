ALTER TABLE `super_agent_event_outbox` ADD COLUMN `next_attempt_at` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `super_agent_event_outbox` ADD COLUMN `last_error` text;
