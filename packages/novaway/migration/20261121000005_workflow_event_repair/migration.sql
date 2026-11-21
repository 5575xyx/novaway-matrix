CREATE INDEX IF NOT EXISTS `session_workflow_policy_turn_idx` ON `session_workflow_policy` (`turn_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `session_workflow_event` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE CASCADE,
  `turn_id` text NOT NULL,
  `type` text NOT NULL,
  `route` text NOT NULL,
  `phase` text NOT NULL,
  `payload` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `session_workflow_event_session_idx` ON `session_workflow_event` (`session_id`, `created_at`);
