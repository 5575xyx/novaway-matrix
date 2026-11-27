CREATE TABLE `team_run_assignment` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `task_id` text NOT NULL,
  `employee_id` text,
  `session_id` text,
  `parent_assignment_id` text,
  `dispatch_id` text NOT NULL,
  `attempt` integer DEFAULT 1 NOT NULL,
  `status` text DEFAULT 'created' NOT NULL,
  `objective` text NOT NULL,
  `scope` text,
  `acceptance_ids` text,
  `worktree` text,
  `prompt_hash` text,
  `skill_manifest_hash` text,
  `permission_hash` text,
  `idempotency_key` text NOT NULL,
  `lease_until` integer,
  `last_heartbeat_at` integer,
  `heartbeat_misses` integer DEFAULT 0 NOT NULL,
  `report` text,
  `verification` text,
  `error` text,
  `delivered_at` integer,
  `accepted_at` integer,
  `started_at` integer,
  `reported_at` integer,
  `verified_at` integer,
  `cancelled_at` integer,
  `expired_at` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_run_assignment_dispatch_idx` ON `team_run_assignment` (`dispatch_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_run_assignment_idempotency_idx` ON `team_run_assignment` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `team_run_assignment_run_idx` ON `team_run_assignment` (`run_id`,`time_created`);
--> statement-breakpoint
CREATE INDEX `team_run_assignment_task_idx` ON `team_run_assignment` (`task_id`,`attempt`);
--> statement-breakpoint
CREATE INDEX `team_run_assignment_lease_idx` ON `team_run_assignment` (`status`,`lease_until`);
