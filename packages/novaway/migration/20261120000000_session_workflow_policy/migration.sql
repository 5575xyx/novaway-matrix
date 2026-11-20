CREATE TABLE `session_workflow_policy` (
  `session_id` text PRIMARY KEY NOT NULL REFERENCES `session`(`id`) ON DELETE CASCADE,
  `turn_id` text NOT NULL,
  `route` text NOT NULL,
  `phase` text NOT NULL,
  `route_locked` integer NOT NULL DEFAULT 1,
  `escalation_reason` text,
  `question_calls` integer NOT NULL DEFAULT 0,
  `question_budget` integer NOT NULL DEFAULT 1,
  `verification_status` text NOT NULL DEFAULT 'not_required',
  `delivery_status` text NOT NULL DEFAULT 'not_started',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE INDEX `session_workflow_policy_turn_idx` ON `session_workflow_policy` (`turn_id`);
CREATE TABLE `session_workflow_event` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE CASCADE,
  `turn_id` text NOT NULL,
  `type` text NOT NULL,
  `route` text NOT NULL,
  `phase` text NOT NULL,
  `payload` text,
  `created_at` integer NOT NULL
);
CREATE INDEX `session_workflow_event_session_idx` ON `session_workflow_event` (`session_id`, `created_at`);
